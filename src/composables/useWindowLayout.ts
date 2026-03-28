import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from '@tauri-apps/api/window'

export async function getLogicalWindowState() {
  const win = getCurrentWindow()
  const [pos, size, scale] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.scaleFactor(),
  ])
  return {
    x: pos.x / scale,
    y: pos.y / scale,
    w: size.width / scale,
    h: size.height / scale,
    scale,
  }
}

export async function getExpandDirection(): Promise<'up' | 'down'> {
  const monitor = await currentMonitor()
  if (!monitor) return 'up'
  const { y, h, scale } = await getLogicalWindowState()
  const screenH = monitor.size.height / scale
  const screenY = monitor.position.y / scale
  const windowBottomY = y + h
  const midY = screenY + screenH / 2
  return windowBottomY > midY ? 'up' : 'down'
}

export async function animateWindowResize(
  targetW: number,
  targetH: number,
  targetX: number,
  targetY: number,
  duration = 180,
) {
  const { x: sX, y: sY, w: sW, h: sH } = await getLogicalWindowState()
  const win = getCurrentWindow()
  const startTime = performance.now()

  return new Promise<void>((resolve) => {
    function step(now: number) {
      const t = Math.min((now - startTime) / duration, 1)
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

      const w = Math.round(sW + (targetW - sW) * ease)
      const h = Math.round(sH + (targetH - sH) * ease)
      const x = Math.round(sX + (targetX - sX) * ease)
      const y = Math.round(sY + (targetY - sY) * ease)

      Promise.all([
        win.setSize(new LogicalSize(w, h)),
        win.setPosition(new LogicalPosition(x, y)),
      ]).then(() => {
        if (t < 1) {
          requestAnimationFrame(step)
        } else {
          resolve()
        }
      })
    }
    requestAnimationFrame(step)
  })
}
