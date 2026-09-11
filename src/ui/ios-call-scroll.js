/* iOS CALL transcript interaction helper.
   This module changes behaviour only: it does not add, remove, or restyle any
   CALL controls. WKWebView can fail to hand a pan gesture to an overflow node
   when its ancestors are pointer-transparent, so keep native overflow scrolling
   and add a small direct touch/wheel fallback on the existing subtitle box. */

export function mountIosCallTranscriptScroll(root = document) {
  const el = root?.querySelector?.('.call-subtitle') || document.querySelector('.call-subtitle')
  if (!el) return () => {}

  let touchY = null
  let touchTop = 0
  let lastText = el.textContent || ''

  const scrollable = () => el.scrollHeight > el.clientHeight + 2
  const refresh = () => {
    const next = el.textContent || ''
    if (next !== lastText) {
      lastText = next
      el.scrollTop = 0
    }
    el.dataset.scrollable = scrollable() ? 'true' : 'false'
  }

  const onWheel = (event) => {
    if (!scrollable()) return
    const before = el.scrollTop
    el.scrollTop += event.deltaY
    if (el.scrollTop !== before) event.preventDefault()
  }

  const onTouchStart = (event) => {
    if (event.touches?.length !== 1) return
    touchY = event.touches[0].clientY
    touchTop = el.scrollTop
  }

  const onTouchMove = (event) => {
    if (touchY == null || event.touches?.length !== 1 || !scrollable()) return
    const delta = touchY - event.touches[0].clientY
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const next = Math.max(0, Math.min(max, touchTop + delta))
    if (next !== el.scrollTop) el.scrollTop = next
    // The document itself cannot scroll; consuming the gesture here prevents
    // WKWebView from converting it into a cancelled canvas pan instead.
    event.preventDefault()
  }

  const endTouch = () => { touchY = null }
  const observer = new MutationObserver(() => requestAnimationFrame(refresh))
  observer.observe(el, { childList: true, characterData: true, subtree: true })

  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(refresh)
    resizeObserver.observe(el)
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', endTouch, { passive: true })
  el.addEventListener('touchcancel', endTouch, { passive: true })
  refresh()

  return () => {
    observer.disconnect()
    resizeObserver?.disconnect?.()
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', endTouch)
    el.removeEventListener('touchcancel', endTouch)
  }
}
