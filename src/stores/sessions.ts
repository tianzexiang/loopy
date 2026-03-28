import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Session, FeedbackRequest, FeedbackResponse } from '../types'
import { loadSessions, saveSessions } from '../utils/storage'
import { generateId, shortDirName, summarizeTitle, debounce } from '../utils/helpers'

const TAB_COLORS = [
  '#007acc', '#4ec9b0', '#ce9178', '#c586c0',
  '#dcdcaa', '#9cdcfe', '#d16969', '#608b4e',
  '#b5cea8', '#d7ba7d',
]

const CLEANUP_DELAY_MS = 5_000
const STALE_REQUEST_MS = 12 * 60 * 1000
const STALE_CHECK_INTERVAL_MS = 30_000
const SAVE_DEBOUNCE_MS = 500

let colorIndex = 0
function nextColor(): string {
  return TAB_COLORS[colorIndex++ % TAB_COLORS.length]!
}

/**
 * Session IDs from the pool follow `{instanceId}::{suffix}`.
 * A session belongs to an instance if its mcpConnectionId matches
 * or its id is prefixed by that instance.
 */
function belongsToInstance(session: Session, instanceId: string): boolean {
  return session.mcpConnectionId === instanceId
    || session.id.startsWith(`${instanceId}::`)
}

export const useSessionStore = defineStore('sessions', () => {
  const loaded = loadSessions()
  colorIndex = loaded.length
  const sessions = ref<Session[]>(loaded)
  const activeSessionId = ref<string | null>(sessions.value[0]?.id ?? null)

  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) ?? null
  )

  const visibleSessions = computed(() =>
    sessions.value.filter(s => s.messages.length > 0 || s.pendingRequest)
  )

  // ==================================================================
  //  Connection Layer
  // ==================================================================

  const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function handleRegister(instanceId: string) {
    cancelCleanupTimer(instanceId)
    for (const s of sessions.value) {
      if (belongsToInstance(s, instanceId)) {
        s.connected = true
      }
    }
  }

  function handleDisconnect(instanceId: string) {
    for (const s of sessions.value) {
      if (belongsToInstance(s, instanceId)) {
        s.connected = false
      }
    }
    scheduleCleanup(instanceId)
  }

  function scheduleCleanup(instanceId: string) {
    cancelCleanupTimer(instanceId)
    cleanupTimers.set(instanceId, setTimeout(() => {
      cleanupTimers.delete(instanceId)
      for (let i = sessions.value.length - 1; i >= 0; i--) {
        const s = sessions.value[i]!
        if (belongsToInstance(s, instanceId) && !s.connected && !s.pendingRequest) {
          sessions.value.splice(i, 1)
        }
      }
      fixActiveSession()
    }, CLEANUP_DELAY_MS))
  }

  function cancelCleanupTimer(instanceId: string) {
    const timer = cleanupTimers.get(instanceId)
    if (timer) {
      clearTimeout(timer)
      cleanupTimers.delete(instanceId)
    }
  }

  // ==================================================================
  //  Session Layer
  // ==================================================================

  const autoReplyTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function handleFeedbackRequest(request: FeedbackRequest) {
    let session = sessions.value.find(s => s.id === request.sessionId)

    if (!session) {
      session = {
        id: request.sessionId,
        label: shortDirName(request.projectDirectory),
        color: nextColor(),
        projectDirectory: request.projectDirectory,
        mcpConnectionId: request.mcpConnectionId,
        connected: true,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messages: [],
        pendingRequest: null,
      }
      sessions.value.push(session)
    }

    session.pendingRequest = request
    session.connected = true
    session.lastActiveAt = Date.now()
    session.label = summarizeTitle(request.summary)
    if (request.mcpConnectionId) {
      session.mcpConnectionId = request.mcpConnectionId
    }

    session.messages.push({
      id: generateId(),
      sessionId: session.id,
      role: 'ai',
      content: request.summary,
      images: [],
      timestamp: request.timestamp,
    })

    const current = activeSession.value
    if (!current || !current.pendingRequest || current.id === session.id) {
      activeSessionId.value = session.id
    }

    scheduleAutoReply(request)
  }

  function scheduleAutoReply(request: FeedbackRequest) {
    cancelAutoReplyTimer(request.id)
    if (!request.autoReplyTimeout || request.autoReplyTimeout <= 0) return

    autoReplyTimers.set(request.id, setTimeout(() => {
      autoReplyTimers.delete(request.id)
      const session = sessions.value.find(s => s.pendingRequest?.id === request.id)
      if (!session) return

      sendResponse({
        requestId: request.id,
        type: 'feedback',
        text: request.autoReplyText || '继续',
        images: [],
        timestamp: Date.now(),
      })
    }, request.autoReplyTimeout))
  }

  function cancelAutoReplyTimer(requestId: string) {
    const timer = autoReplyTimers.get(requestId)
    if (timer) {
      clearTimeout(timer)
      autoReplyTimers.delete(requestId)
    }
  }

  async function sendResponse(response: FeedbackResponse) {
    const session = sessions.value.find(s => s.pendingRequest?.id === response.requestId)
    if (!session) return

    cancelAutoReplyTimer(response.requestId)

    session.messages.push({
      id: generateId(),
      sessionId: session.id,
      role: 'user',
      content: response.text,
      images: response.images,
      responseType: response.type,
      timestamp: response.timestamp,
    })
    session.pendingRequest = null
    session.lastActiveAt = Date.now()

    await invoke('send_ws_message', {
      message: JSON.stringify({ type: 'feedback_response', payload: response }),
      target_instance: session.mcpConnectionId ?? null,
    })
  }

  async function removeSession(sessionId: string) {
    const idx = sessions.value.findIndex(s => s.id === sessionId)
    if (idx === -1) return
    const session = sessions.value[idx]!

    if (session.pendingRequest) {
      cancelAutoReplyTimer(session.pendingRequest.id)
      const cancel: FeedbackResponse = {
        requestId: session.pendingRequest.id,
        type: 'reject',
        text: '[Session closed by user]',
        images: [],
        timestamp: Date.now(),
      }
      await invoke('send_ws_message', {
        message: JSON.stringify({ type: 'feedback_response', payload: cancel }),
        target_instance: session.mcpConnectionId ?? null,
      }).catch(() => {})
    }

    sessions.value.splice(idx, 1)
    fixActiveSession()
  }

  // ==================================================================
  //  Helpers
  // ==================================================================

  function fixActiveSession() {
    if (activeSessionId.value && sessions.value.some(s => s.id === activeSessionId.value)) {
      return
    }
    activeSessionId.value = visibleSessions.value[0]?.id ?? sessions.value[0]?.id ?? null
  }

  // ==================================================================
  //  Event Listeners (self-initializing, idempotent)
  // ==================================================================

  let initialized = false
  let staleCheckInterval: ReturnType<typeof setInterval> | null = null

  function init() {
    if (initialized) return
    initialized = true

    listen<string>('ws-register', (event) => {
      try {
        const data = JSON.parse(event.payload) as {
          type: string
          payload: { instanceId: string; projectDirectory?: string }
        }
        if (data.type === 'register' && data.payload?.instanceId) {
          handleRegister(data.payload.instanceId)
        }
      } catch { /* ignore malformed events */ }
    })

    listen<string>('ws-feedback-request', (event) => {
      try {
        const data = JSON.parse(event.payload) as { type: string; payload: FeedbackRequest }
        if (data.type === 'feedback_request') {
          handleFeedbackRequest(data.payload)
        }
      } catch { /* ignore malformed events */ }
    })

    listen<string>('ws-client-disconnected', (event) => {
      handleDisconnect(event.payload)
    })

    listen('ws-show-window', async () => {
      const win = getCurrentWindow()
      await win.unminimize()
      await win.show()
      await win.setFocus()
    })

    staleCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const s of sessions.value) {
        if (s.pendingRequest && now - s.pendingRequest.timestamp > STALE_REQUEST_MS) {
          s.pendingRequest = null
        }
      }
    }, STALE_CHECK_INTERVAL_MS)
  }

  // Auto-initialize on first use
  init()

  // Debounced persistence
  const debouncedSave = debounce(() => saveSessions(sessions.value), SAVE_DEBOUNCE_MS)
  watch(sessions, debouncedSave, { deep: true })

  // HMR cleanup
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      if (staleCheckInterval) clearInterval(staleCheckInterval)
      for (const timer of cleanupTimers.values()) clearTimeout(timer)
      for (const timer of autoReplyTimers.values()) clearTimeout(timer)
      initialized = false
    })
  }

  return {
    sessions,
    visibleSessions,
    activeSessionId,
    activeSession,
    handleFeedbackRequest,
    sendResponse,
    removeSession,
  }
})
