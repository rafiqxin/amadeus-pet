/* Pet interactions: custom window dragging, click vs drag disambiguation.
   NOTE: the window is ALWAYS interactive. The mouse-passthrough dance
   (setIgnoreMouseEvents forward:true) proved unreliable for real mice on
   Linux X11 — real events were swallowed at the OS level, making the pet
   undraggable and its buttons unclickable. Desktop-pet standard (PPet etc.)
   is a fully interactive window; the transparent margins just swallow
   clicks.

   DRAG MATH — restored to the original simple version that worked:
   per-event screen deltas, applied immediately, no rAF batching, no
   pointer capture, no calibration. The hit ellipse is expressed as
   fractions of the stage so it stays centered on the model at any
   window size. */

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
    if (consoleOpen) return // the frame owns all dragging while the console is open
    if (!inHitArea(e.clientX, e.clientY)) return
    dragging = true
    moved = false
    lastX = e.screenX
    lastY = e.screenY
    onDragStart()
  }

  function onPointerMove(e) {
    if (!ipc || !dragging) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    if (dx !== 0 || dy !== 0) {
      if (!moved && (Math.abs(dx) + Math.abs(dy)) > DRAG_THRESHOLD) moved = true
      ipc.dragMove(dx, dy)
    }
    lastX = e.screenX
    lastY = e.screenY
  }

  function onPointerUp(e) {
    if (!dragging) return
    dragging = false
    if (!moved && inHitArea(e.clientX, e.clientY)) onClick(e)
    onDragEnd()
  }

  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)

  stage.addEventListener('dblclick', (e) => {
    if (inHitArea(e.clientX, e.clientY)) onDoubleClick()
  })

  return {
    setConsoleOpen(open) {
      consoleOpen = !!open
      dragging = false
    },
    setHitScale(v) {
      HIT.hitScale = v || 1
    },
    dispose() {
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', onPointerUp)
    },
  }
}
