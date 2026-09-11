/* iOS CALL transcript scrolling.
 *
 * The box scrolls by finger, the way a phone user expects: `.call-subtitle`
 * carries `touch-action: pan-y`, `overflow-y: auto` and momentum scrolling (see
 * ios-call-fixes.css), and the handlers below keep that reliable inside
 * WKWebView, where an ancestor with `pointer-events: none` and the Live2D
 * canvas underneath both interfere with native gesture routing.
 *
 * There is deliberately NO drawn rail or thumb. An earlier revision portaled a
 * custom 44px track/thumb to document.body to work around the gesture routing;
 * on a real device it read as a foreign scrollbar pasted over the CALL frame,
 * and the fix for the routing is the touch handling here, not a visible widget.
 * Only the scroll state is still reported, through `ama-transcript-scroll`.
 */

export function mountIosCallTranscriptScroll(root = document) {
  const el = root?.querySelector?.('.call-subtitle') || document.querySelector('.call-subtitle')
  if (!el) return () => {}

  let touchY = null
  let touchTop = 0
  let touchId = null
  let lastText = el.textContent || ''
  let raf = 0

  const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight)
  const scrollable = () => maxScroll() > 2

  function emitScrollState() {
    try {
      window.dispatchEvent(new CustomEvent('ama-transcript-scroll', {
        detail: { scrollTop: el.scrollTop, maxScroll: maxScroll(), scrollable: scrollable() },
      }))
    } catch {}
  }

  function refresh() {
    const next = el.textContent || ''
    if (next !== lastText) {
      lastText = next
      el.scrollTop = 0
    }
    el.dataset.scrollable = maxScroll() > 2 ? 'true' : 'false'
    emitScrollState()
  }

  function scheduleRefresh() {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      refresh()
    })
  }

  // Desktop wheel support (the Electron harness drives the same markup).
  const onWheel = (event) => {
    if (!scrollable()) return
    const before = el.scrollTop
    el.scrollTop += event.deltaY
    if (el.scrollTop !== before) event.preventDefault()
  }

  /* WKWebView does not deliver a touch to this element. It sits inside
     `.hud-call`/`.hud-console`, which are `pointer-events: none` so the Live2D
     canvas underneath stays tappable, and the compositor's gesture routing does
     not follow the element's own `pointer-events: auto` override. The transcript
     has no drawn scrollbar any more, so there is no widget to hit either.
     Measured on the Simulator: a drag at the transcript's own centre produced
     scrollTop 0 with the element scrollable (max=2187).
     The pattern that does work — the one the removed thumb used — is to take the
     gesture at document capture level and hit-test by geometry.
     Pointer events, not touch events: measured with an instrumented probe, an
     XCUITest drag reaches the page as pointer events only (`touch=0/0/0`), and a
     finger on iOS produces pointer events too. Touch events are kept solely as a
     fallback for engines without PointerEvent, and never run alongside them. */
  const pointerCapable = typeof window.PointerEvent !== 'undefined'

  const beginDrag = (clientY, id) => {
    touchY = clientY
    touchTop = el.scrollTop
    touchId = id
  }

  const moveDrag = (clientY) => {
    if (touchY == null) return false
    const delta = touchY - clientY
    const max = maxScroll()
    const next = Math.max(0, Math.min(max, touchTop + delta))
    if (next !== el.scrollTop) el.scrollTop = next
    return true
  }

  const insideTranscript = (clientX, clientY) => {
    const rect = el.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right) return false
    if (clientY < rect.top || clientY > rect.bottom) return false
    return true
  }

  const onDocumentPointerDown = (event) => {
    if (touchY != null || !scrollable() || !insideTranscript(event.clientX, event.clientY)) return
    beginDrag(event.clientY, event.pointerId)
  }

  const onWindowPointerMove = (event) => {
    if (touchId == null || event.pointerId !== touchId) return
    if (moveDrag(event.clientY)) event.preventDefault()
  }

  const onWindowPointerUp = (event) => {
    if (touchId == null || event.pointerId !== touchId) return
    touchY = null
    touchId = null
  }

  const onDocumentTouchStart = (event) => {
    if (pointerCapable) return
    if (event.touches?.length !== 1 || !scrollable()) return
    const touch = event.touches[0]
    if (!insideTranscript(touch.clientX, touch.clientY)) return
    beginDrag(touch.clientY, touch.identifier)
  }

  const onWindowTouchMove = (event) => {
    if (pointerCapable || touchY == null || event.touches?.length !== 1) return
    const touch = Array.from(event.touches).find((item) => item.identifier === touchId)
    if (!touch) return
    if (moveDrag(touch.clientY)) event.preventDefault()
  }

  const onWindowTouchEnd = (event) => {
    if (pointerCapable || touchY == null) return
    const stillActive = Array.from(event.touches || []).some((item) => item.identifier === touchId)
    if (!stillActive) { touchY = null; touchId = null }
  }

  const observer = new MutationObserver(scheduleRefresh)
  observer.observe(el, { childList: true, characterData: true, subtree: true })

  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleRefresh)
    resizeObserver.observe(el)
  }

  el.addEventListener('scroll', emitScrollState, { passive: true })
  el.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('pointerdown', onDocumentPointerDown, { capture: true, passive: true })
  window.addEventListener('pointermove', onWindowPointerMove, { capture: true, passive: false })
  window.addEventListener('pointerup', onWindowPointerUp, { capture: true, passive: true })
  window.addEventListener('pointercancel', onWindowPointerUp, { capture: true, passive: true })
  document.addEventListener('touchstart', onDocumentTouchStart, { capture: true, passive: true })
  window.addEventListener('touchmove', onWindowTouchMove, { capture: true, passive: false })
  window.addEventListener('touchend', onWindowTouchEnd, { capture: true, passive: true })
  window.addEventListener('touchcancel', onWindowTouchEnd, { capture: true, passive: true })
  window.addEventListener('resize', scheduleRefresh)
  refresh()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    observer.disconnect()
    resizeObserver?.disconnect?.()
    el.removeEventListener('scroll', emitScrollState)
    el.removeEventListener('wheel', onWheel)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    window.removeEventListener('pointermove', onWindowPointerMove, true)
    window.removeEventListener('pointerup', onWindowPointerUp, true)
    window.removeEventListener('pointercancel', onWindowPointerUp, true)
    document.removeEventListener('touchstart', onDocumentTouchStart, true)
    window.removeEventListener('touchmove', onWindowTouchMove, true)
    window.removeEventListener('touchend', onWindowTouchEnd, true)
    window.removeEventListener('touchcancel', onWindowTouchEnd, true)
    window.removeEventListener('resize', scheduleRefresh)
  }
}
