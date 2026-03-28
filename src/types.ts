export interface FeedbackRequest {
  id: string
  sessionId: string
  /** MCP process id (shared by all agents in one Cursor); used for disconnect/reconnect */
  mcpConnectionId?: string
  summary: string
  projectDirectory: string
  hasFileChanges?: boolean
  timestamp: number
  /** If set, GUI auto-replies after this many ms of user inactivity */
  autoReplyTimeout?: number
  /** Text to auto-reply with (default: "继续") */
  autoReplyText?: string
}

export interface FeedbackResponse {
  requestId: string
  type: 'accept' | 'reject' | 'feedback'
  text: string
  images: ImageAttachment[]
  timestamp: number
}

export interface ImageAttachment {
  id: string
  name: string
  base64: string
  mimeType: string
  previewUrl: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'ai' | 'user'
  content: string
  images: ImageAttachment[]
  responseType?: 'accept' | 'reject' | 'feedback'
  timestamp: number
}

export interface Session {
  id: string
  label: string
  color: string
  projectDirectory?: string
  /** Same as MCP INSTANCE_ID when this tab is from that process (incl. per-request tabs) */
  mcpConnectionId?: string
  connected: boolean
  createdAt: number
  lastActiveAt: number
  messages: ChatMessage[]
  pendingRequest: FeedbackRequest | null
}

