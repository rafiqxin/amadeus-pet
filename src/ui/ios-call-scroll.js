/* iOS CALL transcript scroller.
   Keeps the established CALL box but adds a real, visible track/thumb whose
   position is bound bidirectionally to scrollTop. Native touch scrolling still
   works; the thumb is an explicit fallback and direct-manipulation affordance. */

export function mountIosCallTranscriptScroll(root = document) {
  const el = root?.querySelector?.('.call-subtitle') || document.querySelector('.call-subtitle')
  if (!el || !el.parentElement) return () => {}
  const host = el.parentElement

  const track = document.createElement('div')
  track.className = 'call-scroll-track'
  track.setAttribute('aria-hidden', 'true')
  const thumb = document.createElement('div')
  thumb.className = 'call-scroll-thumb'
  track.appendChild(thumb)
  host.appendChild(track)

  let touchY = null
  let touchTop = 0
  let lastText = el.textContent || ''
  let thumbDrag = null
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

  function positionTrack() {
    const rect = el.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const inset = 8
    track.style.left = `${Math.max(0, rect.right - hostRect.left - 11)}px`
    track.style.top = `${Math.max(0, rect.top - hostRect.top + inset)}px`
    track.style.height = `${Math.max(28, rect.height - inset * 2)}px`
  }

  function updateThumb() {
    const max = maxScroll()
    const trackHeight = Math.max(1, track.clientHeight)
    const ratio = Math.max(0, Math.min(1, el.clientHeight / Math.max(el.clientHeight, el.scrollHeight)))
    const thumbHeight = Math.max(28, Math.round(trackHeight * ratio))
    const travel = Math.max(0, trackHeight - thumbHeight)
    const top = max > 0 ? (el.scrollTop / max) * travel : 0
    thumb.style.height = `${Math.min(trackHeight, thumbHeight)}px`
    thumb.style.transform = `translateY(${Math.max(0, Math.min(travel, top))}px)`
    track.classList.toggle('show', max > 2)
    el.dataset.scrollable = max > 2 ? 'true' : 'false'
    emitScrollState()
  }

  function refresh() {
    const next = el.textContent || ''
    if (next !== lastText) {
      lastText = next
      el.scrollTop = 0
    }
    positionTrack()
    updateThumb()
  }

  function scheduleRefresh() {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      refresh()
    })
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
    const max = maxScroll()
    const next = Math.max(0, Math.min(max, touchTop + delta))
    if (next !== el.scrollTop) el.scrollTop = next
    event.preventDefault()
  }

  const endTouch = () => { touchY = null }

  function beginThumbDrag({ kind, id, clientY }) {
    if (!scrollable()) return false
    thumbDrag = {
      kind,
      id,
      y: clientY,
      scrollTop: el.scrollTop,
    }
    thumb.classList.add('dragging')
    return true
  }

  function moveThumbDrag(clientY) {
    if (!thumbDrag) return
    const max = maxScroll()
    const travel = Math.max(1, track.clientHeight - thumb.clientHeight)
    const delta = clientY - thumbDrag.y
    const next = Math.max(0, Math.min(max, thumbDrag.scrollTop + (delta / travel) * max))
    if (next !== el.scrollTop) {
      el.scrollTop = next
      // Do not rely only on a later native scroll event. Updating immediately
      // keeps the visual thumb and the test/diagnostic state in lock-step.
      updateThumb()
    }
  }

  function finishThumbDrag(kind, id) {
    if (!thumbDrag || thumbDrag.kind !== kind) return
    if (id != null && thumbDrag.id != null && thumbDrag.id !== id) return
    thumbDrag = null
    thumb.classList.remove('dragging')
  }

  const onThumbDown = (event) => {
    if (!beginThumbDrag({ kind: 'pointer', id: event.pointerId, clientY: event.clientY })) return
    try { thumb.setPointerCapture?.(event.pointerId) } catch {}
    event.preventDefault()
    event.stopPropagation()
  }

  // Pointer capture on a tiny element is not sufficiently reliable in iOS
  // WKWebView. Own move/up at window level as well so the drag continues when
  // the finger leaves the visual thumb or WebKit declines pointer capture.
  const onWindowPointerMove = (event) => {
    if (!thumbDrag || thumbDrag.kind !== 'pointer' || thumbDrag.id !== event.pointerId) return
    moveThumbDrag(event.clientY)
    event.preventDefault()
  }
  const onWindowPointerUp = (event) => finishThumbDrag('pointer', event.pointerId)

  // Real touch fallback for WKWebView versions where the synthesized pointer
  // stream is interrupted. This is intentionally separate from transcript
  // pan scrolling: it starts only when the finger goes down on the thumb.
  const onThumbTouchStart = (event) => {
    if (thumbDrag || event.touches?.length !== 1) return
    const touch = event.touches[0]
    if (!beginThumbDrag({ kind: 'touch', id: touch.identifier, clientY: touch.clientY })) return
    event.preventDefault()
    event.stopPropagation()
  }
  const onWindowTouchMove = (event) => {
    if (!thumbDrag || thumbDrag.kind !== 'touch') return
    const touch = Array.from(event.touches || []).find((item) => item.identifier === thumbDrag.id)
    if (!touch) return
    moveThumbDrag(touch.clientY)
    event.preventDefault()
  }
  const onWindowTouchEnd = (event) => {
    if (!thumbDrag || thumbDrag.kind !== 'touch') return
    const stillActive = Array.from(event.touches || []).some((item) => item.identifier === thumbDrag.id)
    if (!stillActive) finishThumbDrag('touch', thumbDrag.id)
  }

  const onTrackDown = (event) => {
    if (event.target === thumb || !scrollable()) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    el.scrollTop = ratio * maxScroll()
    updateThumb()
    event.preventDefault()
    event.stopPropagation()
  }

  const observer = new MutationObserver(scheduleRefresh)
  observer.observe(el, { childList: true, characterData: true, subtree: true })

  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleRefresh)
    resizeObserver.observe(el)
    resizeObserver.observe(host)
  }

  el.addEventListener('scroll', updateThumb, { passive: true })
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', endTouch, { passive: true })
  el.addEventListener('touchcancel', endTouch, { passive: true })
  thumb.addEventListener('pointerdown', onThumbDown, { passive: false })
  thumb.addEventListener('touchstart', onThumbTouchStart, { passive: false })
  track.addEventListener('pointerdown', onTrackDown, { passive: false })
  window.addEventListener('pointermove', onWindowPointerMove, { passive: false })
  window.addEventListener('pointerup', onWindowPointerUp, { passive: true })
  window.addEventListener('pointercancel', onWindowPointerUp, { passive: true })
  window.addEventListener('touchmove', onWindowTouchMove, { passive: false })
  window.addEventListener('touchend', onWindowTouchEnd, { passive: true })
  window.addEventListener('touchcancel', onWindowTouchEnd, { passive: true })
  window.addEventListener('resize', scheduleRefresh)
  refresh()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    observer.disconnect()
    resizeObserver?.disconnect?.()
    el.removeEventListener('scroll', updateThumb)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', endTouch)
    el.removeEventListener('touchcancel', endTouch)
    thumb.removeEventListener('pointerdown', onThumbDown)
    thumb.removeEventListener('touchstart', onThumbTouchStart)
    track.removeEventListener('pointerdown', onTrackDown)
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', onWindowPointerUp)
    window.removeEventListener('pointercancel', onWindowPointerUp)
    window.removeEventListener('touchmove', onWindowTouchMove)
    window.removeEventListener('touchend', onWindowTouchEnd)
    window.removeEventListener('touchcancel', onWindowTouchEnd)
    window.removeEventListener('resize', scheduleRefresh)
    track.remove()
  }
}
