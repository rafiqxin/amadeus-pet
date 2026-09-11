/* iOS CALL transcript scroller.
   Keeps the established CALL box but adds a real, visible track/thumb whose
   position is bound bidirectionally to scrollTop. The scrollbar is portaled to
   document.body so it is not trapped beneath HUD ancestors with pointer-events:none. */

export function mountIosCallTranscriptScroll(root = document) {
  const el = root?.querySelector?.('.call-subtitle') || document.querySelector('.call-subtitle')
  if (!el) return () => {}

  const track = document.createElement('div')
  track.className = 'call-scroll-track'
  track.setAttribute('aria-hidden', 'true')
  const thumb = document.createElement('div')
  thumb.className = 'call-scroll-thumb'
  track.appendChild(thumb)
  document.body.appendChild(track)

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
    const inset = 8
    // The real hit-test box is 44 px wide. Its visual 6 px rail is centered at
    // +22 px, preserving the previous screen-space rail center (rect.right - 8).
    track.style.left = `${Math.max(0, rect.right - 30)}px`
    track.style.top = `${Math.max(0, rect.top + inset)}px`
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
    if (event.touches?.length !== 1 || thumbDrag) return
    touchY = event.touches[0].clientY
    touchTop = el.scrollTop
  }

  const onTouchMove = (event) => {
    if (thumbDrag || touchY == null || event.touches?.length !== 1 || !scrollable()) return
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
    touchY = null
    thumb.classList.add('dragging')
    return true
  }

  function thumbHit(clientX, clientY) {
    if (!scrollable()) return false
    const rect = thumb.getBoundingClientRect()
    const padX = Math.max(0, (44 - rect.width) / 2)
    const padY = Math.max(8, (44 - rect.height) / 2)
    return clientX >= rect.left - padX
      && clientX <= rect.right + padX
      && clientY >= rect.top - padY
      && clientY <= rect.bottom + padY
  }

  function moveThumbDrag(clientY) {
    if (!thumbDrag) return
    const max = maxScroll()
    const travel = Math.max(1, track.clientHeight - thumb.clientHeight)
    const delta = clientY - thumbDrag.y
    const next = Math.max(0, Math.min(max, thumbDrag.scrollTop + (delta / travel) * max))
    if (next !== el.scrollTop) {
      el.scrollTop = next
      updateThumb()
    }
  }

  function finishThumbDrag(kind, id) {
    if (!thumbDrag || thumbDrag.kind !== kind) return
    if (id != null && thumbDrag.id != null && thumbDrag.id !== id) return
    thumbDrag = null
    thumb.classList.remove('dragging')
  }

  function ownPointerDown(event) {
    if (thumbDrag || !thumbHit(event.clientX, event.clientY)) return false
    if (!beginThumbDrag({ kind: 'pointer', id: event.pointerId, clientY: event.clientY })) return false
    try { thumb.setPointerCapture?.(event.pointerId) } catch {}
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  const onDocumentPointerDown = (event) => { ownPointerDown(event) }
  const onThumbDown = (event) => {
    if (thumbDrag) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    ownPointerDown(event)
  }

  const onWindowPointerMove = (event) => {
    if (!thumbDrag || thumbDrag.kind !== 'pointer' || thumbDrag.id !== event.pointerId) return
    moveThumbDrag(event.clientY)
    event.preventDefault()
    event.stopPropagation()
  }
  const onWindowPointerUp = (event) => finishThumbDrag('pointer', event.pointerId)

  function ownTouchStart(event) {
    if (thumbDrag || event.touches?.length !== 1) return false
    const touch = event.touches[0]
    if (!thumbHit(touch.clientX, touch.clientY)) return false
    if (!beginThumbDrag({ kind: 'touch', id: touch.identifier, clientY: touch.clientY })) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  const onDocumentTouchStart = (event) => { ownTouchStart(event) }
  const onThumbTouchStart = (event) => {
    if (thumbDrag) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    ownTouchStart(event)
  }
  const onWindowTouchMove = (event) => {
    if (!thumbDrag || thumbDrag.kind !== 'touch') return
    const touch = Array.from(event.touches || []).find((item) => item.identifier === thumbDrag.id)
    if (!touch) return
    moveThumbDrag(touch.clientY)
    event.preventDefault()
    event.stopPropagation()
  }
  const onWindowTouchEnd = (event) => {
    if (!thumbDrag || thumbDrag.kind !== 'touch') return
    const stillActive = Array.from(event.touches || []).some((item) => item.identifier === thumbDrag.id)
    if (!stillActive) finishThumbDrag('touch', thumbDrag.id)
  }

  const onTrackDown = (event) => {
    if (thumbDrag || event.target === thumb || !scrollable()) return
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
  document.addEventListener('pointerdown', onDocumentPointerDown, { capture: true, passive: false })
  document.addEventListener('touchstart', onDocumentTouchStart, { capture: true, passive: false })
  window.addEventListener('pointermove', onWindowPointerMove, { capture: true, passive: false })
  window.addEventListener('pointerup', onWindowPointerUp, { capture: true, passive: true })
  window.addEventListener('pointercancel', onWindowPointerUp, { capture: true, passive: true })
  window.addEventListener('touchmove', onWindowTouchMove, { capture: true, passive: false })
  window.addEventListener('touchend', onWindowTouchEnd, { capture: true, passive: true })
  window.addEventListener('touchcancel', onWindowTouchEnd, { capture: true, passive: true })
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
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('touchstart', onDocumentTouchStart, true)
    window.removeEventListener('pointermove', onWindowPointerMove, true)
    window.removeEventListener('pointerup', onWindowPointerUp, true)
    window.removeEventListener('pointercancel', onWindowPointerUp, true)
    window.removeEventListener('touchmove', onWindowTouchMove, true)
    window.removeEventListener('touchend', onWindowTouchEnd, true)
    window.removeEventListener('touchcancel', onWindowTouchEnd, true)
    window.removeEventListener('resize', scheduleRefresh)
    track.remove()
  }
}
