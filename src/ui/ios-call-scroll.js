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

  /* WKWebView does not always deliver a scroll gesture to this element: the CALL
     HUD sits above the Live2D canvas and some of its layers are pointer-events:
     none. Tracking a single finger and writing scrollTop directly keeps the
     gesture working regardless of what the compositor decides to hit-test. */
  const onTouchStart = (event) => {
    if (event.touches?.length !== 1) return
    touchY = event.touches[0].clientY
    touchTop = el.scrollTop
  }

  const onTouchMove = (event) => {
    if (touchY == null || event.touches?.length !== 1 || !scrollable()) return
    const delta = touchY - event.touches[0].clientY
    const max = maxScroll()
    const next = Math.max(0, Math.min(max, touchTop + delta))
    if (next !== el.scrollTop) el.scrollTop = next
    event.preventDefault()
  }

  const endTouch = () => { touchY = null }

  const observer = new MutationObserver(scheduleRefresh)
  observer.observe(el, { childList: true, characterData: true, subtree: true })

  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleRefresh)
    resizeObserver.observe(el)
  }

  el.addEventListener('scroll', emitScrollState, { passive: true })
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', endTouch, { passive: true })
  el.addEventListener('touchcancel', endTouch, { passive: true })
  window.addEventListener('resize', scheduleRefresh)
  refresh()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    observer.disconnect()
    resizeObserver?.disconnect?.()
    el.removeEventListener('scroll', emitScrollState)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', endTouch)
    el.removeEventListener('touchcancel', endTouch)
    window.removeEventListener('resize', scheduleRefresh)
  }
}
