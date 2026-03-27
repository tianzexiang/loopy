export interface FeedbackRequest {
  id: string
  sessionId: string
  mcpConnectionId?: string
  summary: string
  projectDirectory: string
  hasFileChanges?: boolean
  timestamp: number
  autoReplyTimeout?: number
  autoReplyText?: string
}

export interface FeedbackResponse {
  requestId: string
  type: 'accept' | 'reject' | 'feedback'
  text: string
  images?: ImagePayload[]
  timestamp: number
}

export interface ImagePayload {
  base64: string
  mimeType: string
}
