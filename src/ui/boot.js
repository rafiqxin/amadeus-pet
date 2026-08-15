/* Amadeus-style boot sequence — original design informed by the
   layout spec: warm near-black gradient, spark→logo formation,
   amber monospace status, red/gold capsule buttons. */
import './boot.css'

export function mountBoot(root, hooks = {}) {
  const { onConnect = () => {}, onCancel = () => {} } = hooks

  const el = document.createElement('div')
  el.className = 'boot'
  el.innerHTML = `
    <div class="boot-scan"></div>
    <div class="boot-center">
      <div class="boot-logo-stage">
        <div class="boot-spark"></div>
        <div class="boot-logo">A</div>
        <div class="boot-sub">// VIRTUAL ASSISTANT SYSTEM</div>
      </div>
      <div class="boot-status" id="boot-status">Connect to AMA·DEUS?</div>
      <div class="boot-bar hidden"><i id="boot-bar"></i></div>
      <div class="boot-btns">
        <button class="boot-btn" id="boot-connect">CONNECT</button>
        <button class="boot-btn" id="boot-cancel">CANCEL</button>
      </div>
    </div>
  `
  root.appendChild(el)
  const statusEl = el.querySelector('#boot-status')
  const barEl = el.querySelector('#boot-bar')
  const barFill = el.querySelector('#boot-bar')
  const connectBtn = el.querySelector('#boot-connect')
  const cancelBtn = el.querySelector('#boot-cancel')

  let finished = false
  let autoTimer = null

  function finish(ok, done) {
    if (finished) return
    finished = true
    if (autoTimer) clearTimeout(autoTimer)
    const complete = () => {
      el.classList.add('done')
      setTimeout(() => {
        el.remove()
        if (done) done()
      }, 650)
    }
    if (ok) {
      statusEl.textContent = 'Connecting…'
      connectBtn.classList.add('active')
      const t0 = Date.now()
      const fill = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / 1400)
        barFill.style.width = `${p * 100}%`
        if (p >= 1) {
          clearInterval(fill)
          setTimeout(complete, 250)
        }
      }, 40)
    } else {
      statusEl.textContent = 'Disconnected.'
      complete()
    }
  }

  connectBtn.addEventListener('click', () => { finish(true, onConnect) })
  cancelBtn.addEventListener('click', () => { finish(false, onCancel) })

  // First-time convenience: auto-connect after 15s of no interaction.
  autoTimer = setTimeout(() => { finish(true, onConnect) }, 15000)

  return {
    el,
    finish,
    dispose() {
      if (autoTimer) clearTimeout(autoTimer)
      el.remove()
    },
  }
}
