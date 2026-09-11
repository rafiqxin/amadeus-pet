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

  /* WKWebView does not reliably deliver a touch to this element. It sits inside
     `.hud-call`/`.hud-console`, which are `pointer-events: none` so the Live2D
     canvas underneath stays tappable, and the compositor's gesture routing does
     not follow the element's own `pointer-events: auto` override. The transcript
     has no drawn scrollbar any more, so there is no widget to hit either.
     Measured on the Simulator: a drag at the transcript's own centre produced
     scrollTop 0 with the element scrollable (max=2187).
     The pattern that does work — and that the removed thumb used — is to take
     the gesture at document capture level and hit-test by geometry. */
  const onDocumentTouchStart = (event) => {
    if (event.touches?.length !== 1 || !scrollable()) return
    const touch = event.touches[0]
    const rect = el.getBoundingClientRect()
    if (touch.clientX < rect.left || touch.clientX > rect.right) return
    if (touch.clientY < rect.top || touch.clientY > rect.bottom) return
    touchY = touch.clientY
    touchTop = el.scrollTop
    touchId = touch.identifier
  }

  const onWindowTouchMove = (event) => {
    if (touchY == null || event.touches?.length !== 1) return
    const touch = Array.from(event.touches).find((item) => item.identifier === touchId)
    if (!touch) return
    const delta = touchY - touch.clientY
    const max = maxScroll()
    const next = Math.max(0, Math.min(max, touchTop + delta))
    if (next !== el.scrollTop) el.scrollTop = next
    event.preventDefault()
  }

  const onWindowTouchEnd = (event) => {
    if (touchY == null) return
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
    document.removeEventListener('touchstart', onDocumentTouchStart, true)
    window.removeEventListener('touchmove', onWindowTouchMove, true)
    window.removeEventListener('touchend', onWindowTouchEnd, true)
    window.removeEventListener('touchcancel', onWindowTouchEnd, true)
    window.removeEventListener('resize', scheduleRefresh)
  }
}
