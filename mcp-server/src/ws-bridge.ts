import WebSocket from 'ws'
import type { FeedbackRequest, FeedbackResponse } from './types.js'

type ResponseResolver = (response: FeedbackResponse) => void

export class WsBridge {
  private ws: WebSocket | null = null
  private port: number
  private connected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private instanceId: string
  private projectDirectory: string | null = null

  private waiters = new Map<string, ResponseResolver>()

  constructor(port: number, instanceId: string) {
    this.port = port
    this.instanceId = instanceId
  }

  connect(): Promise<void> {
    return new Promise((resolve) => {
      const url = `ws://127.0.0.1:${this.port}`
      try { this.ws?.close() } catch { /* ignore */ }
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this.connected = true
        this.sendRegister()
        resolve()
      })

      this.ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString()) as { type: string; payload: FeedbackResponse }
          if (data.type === 'feedback_response' && data.payload?.requestId) {
            const waiter = this.waiters.get(data.payload.requestId)
            if (waiter) {
              this.waiters.delete(data.payload.requestId)
              waiter(data.payload)
            }
          }
        } catch { /* ignore malformed messages */ }
      })

      this.ws.on('close', () => {
        this.connected = false
        this.scheduleReconnect()
      })

      this.ws.on('error', () => {
        this.connected = false
        if (this.ws?.readyState !== WebSocket.OPEN) {
          resolve()
        }
        this.scheduleReconnect()
      })
    })
  }

  private sendRegister() {
    this.send({
      type: 'register',
      payload: {
        instanceId: this.instanceId,
        projectDirectory: this.projectDirectory,
      },
    })
  }

  setProjectDirectory(dir: string) {
    this.projectDirectory = dir
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => {})
    }, 3000)
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  async ensureConnected(): Promise<void> {
    if (this.isConnected()) return
    await this.connect()
    if (!this.isConnected()) {
      await new Promise(r => setTimeout(r, 3000))
      await this.connect()
    }
    if (!this.isConnected()) {
      throw new Error('Failed to connect to GUI. Is the Loopy GUI running?')
    }
  }

  sendRequest(request: FeedbackRequest) {
    this.send({ type: 'feedback_request', payload: request })
  }

  showWindow() {
    this.send({ type: 'show_window' })
  }

  /**
   * Returns a Promise that resolves when the GUI sends a response
   * for the given requestId — no polling needed.
   */
  waitForResponse(requestId: string, signal?: AbortSignal): Promise<FeedbackResponse | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null)
        return
      }

      this.waiters.set(requestId, resolve)

      signal?.addEventListener('abort', () => {
        this.waiters.delete(requestId)
        resolve(null)
      }, { once: true })
    })
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }
}
