import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WsBridge } from './ws-bridge.js'
import { appendLog } from './logger.js'
import type { FeedbackRequest } from './types.js'

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
//  Configuration (all env-configurable)
// ---------------------------------------------------------------------------
const WS_PORT = parseInt(process.env.FEEDBACK_WS_PORT ?? '9399', 10)

/** How long the MCP tool blocks waiting for a GUI response (ms). */
const MAX_WAIT_MS = parseInt(
  process.env.FEEDBACK_MAX_WAIT_MS ?? String(30 * 60 * 1000), // default 30 min
  10,
)

/**
 * If the user doesn't respond within this many ms, auto-reply.
 * 0 = disabled (wait until MAX_WAIT_MS then return "user away").
 */
const AUTO_REPLY_TIMEOUT_MS = parseInt(
  process.env.FEEDBACK_AUTO_REPLY_TIMEOUT_MS ?? '0',
  10,
)

/**
 * Auto-reply text priority:
 * 1. FEEDBACK_AUTO_REPLY_TEXT env var (user override)
 * 2. pua-rules.md file content (default PUA methodology)
 * 3. "继续" fallback
 */
function loadAutoReplyText(): string {
  if (process.env.FEEDBACK_AUTO_REPLY_TEXT) return process.env.FEEDBACK_AUTO_REPLY_TEXT
  const candidates = [
    resolve(__dirname, '..', '..', 'pua-rules.md'),   // dev: mcp-server/src/../../pua-rules.md
    resolve(__dirname, '..', 'pua-rules.md'),          // release: server.mjs/../pua-rules.md
    resolve(__dirname, 'pua-rules.md'),                // same dir fallback
  ]
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf-8')
  }
  return '继续'
}

const AUTO_REPLY_TEXT = loadAutoReplyText()

// ---------------------------------------------------------------------------
//  Instance identity & GUI resolution
// ---------------------------------------------------------------------------
const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function resolveGuiPath(): string {
  if (process.env.FEEDBACK_GUI_PATH) return process.env.FEEDBACK_GUI_PATH
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const exeName = isWin ? 'loopy.exe' : 'loopy'

  // Release layout: server.mjs and loopy.exe are siblings
  const siblingPath = resolve(__dirname, exeName)
  if (existsSync(siblingPath)) return siblingPath

  // Dev layout: mcp-server/dist/ → ../../src-tauri/target/release/
  const devPath = resolve(__dirname, '../../src-tauri/target/release', exeName)
  if (existsSync(devPath)) return devPath

  if (isMac) {
    const appBundle = resolve(__dirname, '../../src-tauri/target/release/bundle/macos/Feedback MCP.app/Contents/MacOS/Feedback MCP')
    if (existsSync(appBundle)) return appBundle
  }

  return devPath
}

const GUI_EXE = resolveGuiPath()
let lastGuiLaunch = 0

function ensureGuiRunning() {
  if (bridge.isConnected()) return
  if (!existsSync(GUI_EXE)) return
  if (Date.now() - lastGuiLaunch < 5000) return

  lastGuiLaunch = Date.now()
  const child = spawn(GUI_EXE, [`--ws-port=${WS_PORT}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
}

// ---------------------------------------------------------------------------
//  Session pool
// ---------------------------------------------------------------------------
const sessionPool = new Map<string, boolean>()

function acquireSession(): string {
  for (const [sid, busy] of sessionPool) {
    if (!busy) {
      sessionPool.set(sid, true)
      return sid
    }
  }
  const newSid = `${INSTANCE_ID}::${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  sessionPool.set(newSid, true)
  return newSid
}

function releaseSession(sessionId: string) {
  sessionPool.set(sessionId, false)
}

// ---------------------------------------------------------------------------
//  MCP server & bridge
// ---------------------------------------------------------------------------
const bridge = new WsBridge(WS_PORT, INSTANCE_ID)
const server = new McpServer({
  name: 'loopy',
  version: '0.3.0',
})

server.tool(
  'loopy',
  'Show a feedback dialog to the user and wait for their response. Use this after completing a task to get user confirmation or additional instructions.',
  {
    project_directory: z.string().describe('The project directory path'),
    summary: z.string().describe('Summary of what was accomplished'),
    has_file_changes: z.boolean().optional().describe('Whether the AI made file changes that need accept/reject'),
  },
  async ({ project_directory, summary, has_file_changes }, extra) => {
    ensureGuiRunning()
    bridge.setProjectDirectory(project_directory)

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const sessionId = acquireSession()

    await bridge.ensureConnected()

    const request: FeedbackRequest = {
      id: requestId,
      sessionId,
      mcpConnectionId: INSTANCE_ID,
      summary,
      projectDirectory: project_directory,
      hasFileChanges: has_file_changes ?? false,
      timestamp: Date.now(),
      ...(AUTO_REPLY_TIMEOUT_MS > 0 && {
        autoReplyTimeout: AUTO_REPLY_TIMEOUT_MS,
        autoReplyText: AUTO_REPLY_TEXT,
      }),
    }

    bridge.sendRequest(request)
    bridge.showWindow()
    appendLog(project_directory, 'AI_REQUEST', summary)

    const response = await waitForResponse(requestId, extra.signal)
    releaseSession(sessionId)

    if (response) {
      appendLog(project_directory, 'USER_REPLY', response.text || `[${response.type}]`)
      const parts: string[] = []
      if (response.type === 'accept') parts.push('[ACCEPTED]')
      if (response.type === 'reject') parts.push('[REJECTED]')
      if (response.text) parts.push(response.text)

      if (response.images?.length) {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const os = await import('node:os')
        const tempDir = path.join(os.tmpdir(), 'loopy-images')
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }
        for (let i = 0; i < response.images.length; i++) {
          const img = response.images[i]!
          const ext = img.mimeType === 'image/jpeg' ? 'jpg' : img.mimeType === 'image/png' ? 'png' : 'img'
          const filename = `img_${Date.now()}_${i}.${ext}`
          const filepath = path.join(tempDir, filename)
          fs.writeFileSync(filepath, Buffer.from(img.base64, 'base64'))
          parts.push(`[Image saved to: ${filepath}]`)
        }
      }

      return {
        content: [{ type: 'text' as const, text: parts.join('\n') || '[Empty response]' }],
      }
    }

    appendLog(project_directory, 'AUTO_REPLY', 'Timeout or cancelled.')
    return {
      content: [{ type: 'text' as const, text: 'User away too long. Do NOT call MCP again.' }],
    }
  }
)

// ---------------------------------------------------------------------------
//  Wait logic (event-driven, no polling)
// ---------------------------------------------------------------------------

function waitForResponse(
  requestId: string,
  signal?: AbortSignal,
): Promise<{ type: string; text: string; images?: { base64: string; mimeType: string }[] } | null> {
  return new Promise((resolve) => {
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }, MAX_WAIT_MS)

    bridge.waitForResponse(requestId, signal).then((res) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve(res)
      }
    })

    signal?.addEventListener('abort', () => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve(null)
      }
    }, { once: true })
  })
}

// ---------------------------------------------------------------------------
//  Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  await bridge.connect().catch(() => {})
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
