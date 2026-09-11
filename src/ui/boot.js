/* Amadeus launch view using the Android reference project's original UI assets.
   Assets are synchronized into public/Resources/amadeus-reference. */
import './boot.css'

const ASSET = './Resources/amadeus-reference'

export function mountBoot(root, hooks = {}) {
  const { onConnect = () => {}, onCancel = () => {} } = hooks

  const el = document.createElement('div')
  el.className = 'boot'
  el.innerHTML = `
    <img class="boot-logo" src="${ASSET}/logo39.png" alt="Amadeus" draggable="false" />
    <div class="boot-status" id="boot-status">Connect to Kurisu?</div>
    <div class="boot-btns">
      <button class="boot-image-btn" id="boot-connect" type="button" aria-label="Connect">
        <img class="normal" src="${ASSET}/connect_unselect.png" alt="" draggable="false" />
        <img class="selected" src="${ASSET}/connect_select.png" alt="" draggable="false" />
      </button>
      <button class="boot-image-btn" id="boot-cancel" type="button" aria-label="Cancel">
        <img class="normal" src="${ASSET}/cancel_unselect.png" alt="" draggable="false" />
        <img class="selected" src="${ASSET}/cancel_select.png" alt="" draggable="false" />
      </button>
    </div>
  `
  root.appendChild(el)

  const statusEl = el.querySelector('#boot-status')
  const connectBtn = el.querySelector('#boot-connect')
  const cancelBtn = el.querySelector('#boot-cancel')

  let finished = false
  let autoTimer = null

  function finish(ok, done) {
    if (finished) return
    finished = true
    if (autoTimer) clearTimeout(autoTimer)

    statusEl.textContent = ok ? 'Connecting…' : 'Disconnected.'
    ;(ok ? connectBtn : cancelBtn).classList.add('active')

    setTimeout(() => {
      el.classList.add('done')
      setTimeout(() => {
        el.remove()
        if (done) done()
      }, 520)
    }, ok ? 900 : 180)
  }

  connectBtn.addEventListener('click', () => finish(true, onConnect))
  cancelBtn.addEventListener('click', () => finish(false, onCancel))

  // Keep the current desktop convenience behavior.
  autoTimer = setTimeout(() => finish(true, onConnect), 15000)

  return {
    el,
    finish,
    dispose() {
      if (autoTimer) clearTimeout(autoTimer)
      el.remove()
    },
  }
}
