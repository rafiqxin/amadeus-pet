/* Speech bubble — Amadeus terminal style. */
import './bubble.css'

export function mountBubble(root) {
  const el = document.createElement('div')
  el.className = 'bubble hidden'
  el.innerHTML = `
    <div class="bubble-head"><span class="bubble-tag">AMA</span><span class="bubble-dots"><i></i><i></i><i></i></span></div>
    <div class="bubble-body" id="bubble-text"></div>
    <div class="bubble-tail"></div>
  `
  root.appendChild(el)
  const textEl = el.querySelector('#bubble-text')
  let hideTimer = null

  function show(text, duration = 4200) {
    textEl.textContent = text
    el.classList.remove('hidden')
    el.classList.add('show')
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, duration)
  }

  function hide() {
    el.classList.remove('show')
    el.classList.add('hidden')
  }

  return { el, say: show, hide, dispose() { clearTimeout(hideTimer); el.remove() } }
}
