import type { Session } from '../types'

const STORAGE_KEY = 'loopy-sessions'

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const sessions = JSON.parse(raw) as Session[]
    return sessions.map(s => ({
      ...s,
      connected: false,
      waitingForAI: false,
      pendingRequest: null,
    }))
  } catch {
    return []
  }
}

export function saveSessions(sessions: Session[]) {
  try {
    const serializable = sessions.map(s => ({
      ...s,
      messages: s.messages.map(m => ({
        ...m,
        images: m.images.map(img => ({
          ...img,
          previewUrl: img.previewUrl.length > 500_000 ? '' : img.previewUrl,
        })),
      })),
    }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
  } catch {
    // storage full, try trimming old sessions
    try {
      const trimmed = sessions.slice(-10)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      // give up
    }
  }
}
