import { appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export function appendLog(projectDir: string, tag: string, message: string) {
  try {
    const logPath = join(projectDir, 'feedback_log.txt')
    mkdirSync(dirname(logPath), { recursive: true })
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const line = `[${timestamp}] [${tag}] ${message}\n`
    appendFileSync(logPath, line, 'utf-8')
  } catch {
    // logging is best-effort
  }
}
