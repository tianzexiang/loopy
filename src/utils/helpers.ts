export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function shortDirName(dir?: string): string {
  if (!dir) return ''
  return dir.split(/[\\/]/).pop() ?? dir
}

export function summarizeTitle(text: string, maxLen = 30): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen - 2) + '…' : clean
}

export function arrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}
