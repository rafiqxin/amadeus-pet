/* Pet interactions: custom window dragging, click vs drag disambiguation.
   The renderer decides gesture ownership; Electron's main process computes
   actual window coordinates from screen.getCursorScreenPoint() so Windows
   DPI scaling cannot mix CSS pixels and BrowserWindow DIP coordinates. */

const HIT = { fx: 0.5, fy: 0.5, frx: 0.354, fry: 0.445, hitScale: 1 }
const DRAG_THRESHOLD = 5

export function mountInteractions(stage, hooks = {}) {
  const { onClick = () => {}, onDragStart = () => {}, onDragEnd = () => {}, onDoubleClick = () => {} } = hooks
  const ipc = window.amadeus

  let dragging = false
  let moved = false
  let consoleOpen = false
  let lastX = 0, lastY = 0

  function inHitArea(x, y) {
    const r = stage.getBoundingClientRect()
    const cx = r.left + r.width * HIT.fx
    const cy = r.top + r.height * HIT.fy
    const rx = r.width * HIT.frx * HIT.hitScale
    const ry = r.height * HIT.fry * HIT.hitScale
    const dx = (x - cx) / rx
    const dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1
  }

  function onPointerDown(e) {
    if (consoleOpen) return
    if (!inHitArea(e.clientX, e.clientY)) return
    dragging = true
    moved = false
    lastX = e.screenX
    lastY = e.screenY
    ipc?.dragStart()
    onDragStart()
  }

  function onPointerMove(e) {
    if (!ipc || !dragging) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    if (dx !== 0 || dy !== 0) {
      if (!moved && (Math.abs(dx) + Math.abs(dy)) > DRAG_THRESHOLD) moved = true
      ipc.dragMove()
    }
    lastX = e.screenX
    lastY = e.screenY
  }

  function endDrag(e, cancelled = false) {
    if (!dragging) return
    dragging = false
    ipc?.dragEnd()
    if (!cancelled && !moved && inHitArea(e.clientX, e.clientY)) onClick(e)
    onDragEnd()
  }

  function onPointerUp(e) {
    endDrag(e, false)
  }

  function onPointerCancel(e) {
    endDrag(e, true)
  }

  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('pointercancel', onPointerCancel)

  stage.addEventListener('dblclick', (e) => {
    if (inHitArea(e.clientX, e.clientY)) onDoubleClick()
  })

  return {
    setConsoleOpen(open) {
      consoleOpen = !!open
      if (dragging) ipc?.dragEnd()
      dragging = false
    },
    setHitScale(v) {
      HIT.hitScale = v || 1
    },
    dispose() {
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', onPointerUp)
      stage.removeEventListener('pointercancel', onPointerCancel)
      ipc?.dragEnd()
    },
  }
}
