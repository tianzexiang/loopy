#!/usr/bin/env node
/**
 * Interactive Feedback MCP - Setup Script
 *
 * Usage: node setup.mjs
 *
 * Automatically adds the MCP server configuration to Cursor's mcp.json.
 * Works in both development layout and release package layout.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Detect layout: release (server.mjs next to setup.mjs) or dev (mcp-server/dist/)
const releasePath = resolve(__dirname, 'server.mjs')
const devPath = resolve(__dirname, 'mcp-server/dist/index.js')
const bundlePath = resolve(__dirname, 'mcp-server/dist/bundle.mjs')

let serverEntry
if (existsSync(releasePath)) {
  serverEntry = releasePath
} else if (existsSync(bundlePath)) {
  serverEntry = bundlePath
} else if (existsSync(devPath)) {
  serverEntry = devPath
} else {
  console.error('❌ MCP server not found. Run build first:')
  console.error('   cd mcp-server && npm install && npm run bundle')
  process.exit(1)
}

const cursorDir = join(homedir(), '.cursor')
const mcpJsonPath = join(cursorDir, 'mcp.json')

let config = { mcpServers: {} }

if (existsSync(mcpJsonPath)) {
  try {
    config = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
    if (!config.mcpServers) config.mcpServers = {}
  } catch {
    console.warn('⚠️  Existing mcp.json is malformed, creating fresh.')
    config = { mcpServers: {} }
  }
}

const existing = config.mcpServers['loopy']
const currentEnv = existing?.env ?? {}

config.mcpServers['loopy'] = {
  command: 'node',
  args: [serverEntry.replace(/\\/g, '/')],
  timeout: 1800000,
  autoApprove: ['loopy'],
  env: {
    FEEDBACK_MAX_WAIT_MS: '1800000',
    FEEDBACK_AUTO_REPLY_TIMEOUT_MS: '300000',
    ...currentEnv,
  },
}

if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true })
writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

console.log('✅ Cursor MCP 配置已更新！')
console.log(`   配置文件: ${mcpJsonPath}`)
console.log(`   服务入口: ${serverEntry}`)
console.log('')
console.log('   等待超时: 30 分钟')
const autoMs = currentEnv.FEEDBACK_AUTO_REPLY_TIMEOUT_MS ?? '300000'
const hasCustomText = !!currentEnv.FEEDBACK_AUTO_REPLY_TEXT
console.log(`   自动回复: ${autoMs === '0' ? '已禁用' : `${Number(autoMs) / 60000} 分钟（${hasCustomText ? '自定义文本' : 'PUA 激励'}）`}`)
console.log('')
console.log('👉 请在 Cursor 设置 → MCP 中重启 loopy 服务。')
