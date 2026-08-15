/* Amadeus-style HUD — three pages: TERM (console), CALL (call view with
   standby/ringing/in-call states), RINE (messenger with bubbles, quick
   replies, read receipts). Original implementation. */
import './hud.css'

const QUICK_REPLIES = [
  ['はい。どうした？', '没什么。', '……'],
  ['实验顺利吗？', '很顺利。', '还在进行中。'],
  ['哦？说详细点。', '算了，没事。', '我改主意了。'],
  ['知道了。', '嗯，我也是。', '（装作没看见）'],
]

export function mountHud(root, hooks = {}) {
  const {
    onCommand = () => {}, onSay = () => {}, onQuit, onPark, onResize,
    onOpacity, onVoice, onModel, onToggle = () => {},
    onQuickReply = () => {}, onIncoming = null, onTab = () => {},
  } = hooks

  const el = document.createElement('div')
  el.className = 'hud'
  el.innerHTML = `
    <div class="hud-dock">
      <span class="hud-badge hidden" id="hud-badge">0</span>
      <button class="hud-btn" data-act="console" title="控制台">◈</button>
      <button class="hud-btn" data-act="rine-dock" title="聊天 (RINE)">✉</button>
      <button class="hud-btn" data-act="park" title="停靠屏幕底部">⌂</button>
      <button class="hud-btn" data-act="quit" title="退出">✕</button>
    </div>
    <div class="hud-console hidden">
      <div class="hud-frame">
        <div class="hud-corner tl"></div><div class="hud-corner tr"></div>
        <div class="hud-corner bl"></div><div class="hud-corner br"></div>

        <header class="hud-header">
          <div class="hud-title">AMA·DEUS <span class="sub">// VIRTUAL TERMINAL</span></div>
          <div class="hud-status"><span class="led"></span><span id="hud-link">LINK OK</span></div>
          <div class="hud-tabs">
            <button class="hud-btn tiny active" data-act="tab-term">TERM</button>
            <button class="hud-btn tiny" data-act="tab-call">CALL</button>
            <button class="hud-btn tiny" data-act="tab-rine">RINE</button>
            <button class="hud-btn tiny" data-act="tab-diary">LOG</button>
          </div>
          <div class="hud-clock" id="hud-clock">--:--:--</div>
        </header>

        <!-- ================= TERM ================= -->
        <main class="hud-body">
          <section class="hud-left">
            <div class="hud-monitor">
              <canvas id="hud-wave" width="180" height="180"></canvas>
              <div class="hud-monitor-label">SIGNAL MONITOR</div>
              <div class="hud-reticle"></div>
            </div>
            <div class="hud-meters">
              <div class="meter"><label>MEM.BUF</label><div class="bar"><i id="meter-mem"></i></div></div>
              <div class="meter"><label>SYNC</label><div class="bar"><i id="meter-sync"></i></div></div>
              <div class="meter"><label>QUANTUM</label><div class="bar"><i id="meter-q"></i></div></div>
            </div>
          </section>

          <section class="hud-right">
            <div class="hud-log-head">COMM.LOG</div>
            <div class="hud-log" id="hud-log"></div>
            <form class="hud-input-row" id="hud-input-form">
              <span class="prompt">&gt;</span>
              <input id="hud-input" autocomplete="off" spellcheck="false" placeholder="输入指令或对话…" />
              <button class="hud-btn small" type="submit">发送</button>
            </form>
          </section>
        </main>

        <!-- ================= CALL ================= -->
        <main class="hud-call hidden">
          <div class="phone-bar">
            <span class="phone-signal" id="phone-signal">▂▄▆█</span>
            <span class="phone-time" id="phone-time">--:--</span>
            <span class="call-state-mini" id="call-state">STANDBY</span>
            <span class="phone-batt">▮▮▮▮ 87%</span>
          </div>
          <div class="call-controls" id="call-controls">
            <button class="hud-btn big danger hidden" data-act="call-end" title="结束通话">✕</button>
            <button class="hud-btn big hidden" data-act="call-hold" title="保持">⏸</button>
            <button class="hud-btn big ring" data-act="call-ring" title="呼叫">☎</button>
          </div>
          <div class="call-accept-row hidden" id="call-accept-row">
            <button class="hud-btn big accept" data-act="call-accept" title="接听">☎</button>
            <button class="hud-btn big danger" data-act="call-decline" title="挂断">✕</button>
          </div>
          <div class="call-subtitle" id="call-subtitle"></div>
        </main>

        <!-- ================= RINE ================= -->
        <main class="hud-rine hidden">
          <div class="rine-head">
            <span class="rine-back">‹</span>
            <span class="rine-title">AMA·DEUS</span>
            <span class="rine-online">在线</span>
          </div>
          <div class="rine-log" id="rine-log"></div>
          <div class="rine-quick" id="rine-quick"></div>
          <div class="rine-stickers" id="rine-stickers">
            <button class="sticker">🔬</button>
            <button class="sticker">🧪</button>
            <button class="sticker">⏱️</button>
            <button class="sticker">📡</button>
            <button class="sticker">☕</button>
            <button class="sticker">🍮</button>
          </div>
        </main>

        <!-- ================= DIARY ================= -->
        <main class="hud-diary hidden">
          <div class="diary-head">SECRET DIARY // 交互日志</div>
          <div class="diary-log" id="diary-log"></div>
          <div class="diary-delete">
            <span class="prompt">&gt;</span>
            <input id="diary-input" autocomplete="off" spellcheck="false" placeholder="删除码…" />
            <button class="hud-btn small" id="diary-submit">执行</button>
          </div>
        </main>

        <footer class="hud-footer">
          <span>MODE: OBSERVE</span>
          <button class="hud-btn tiny" data-act="opacity-down" title="降低透明度">透-</button>
          <button class="hud-btn tiny" data-act="opacity-up" title="提高透明度">透+</button>
          <button class="hud-btn tiny" id="hud-voice-btn" data-act="voice" title="语音开关">音</button>
          <button class="hud-btn tiny" data-act="model" title="切换人格模型">模</button>
          <button class="hud-btn tiny" data-act="resize-down" title="缩小">－</button>
          <button class="hud-btn tiny" data-act="resize-up" title="放大">＋</button>
          <button class="hud-btn tiny" data-act="park" title="停靠底部">⌂</button>
          <button class="hud-btn tiny" data-act="console">隐藏</button>
          <button class="hud-btn tiny danger" data-act="quit">✕</button>
        </footer>
      </div>
    </div>
  `
  root.appendChild(el)

  const $ = (s) => el.querySelector(s)
  const consoleEl = $('.hud-console')
  const logEl = $('#hud-log')
  const inputForm = $('#hud-input-form')
  const input = $('#hud-input')
  const clockEl = $('#hud-clock')
  const waveCanvas = $('#hud-wave')
  const linkEl = $('#hud-link')
  const badgeEl = $('#hud-badge')
  const voiceBtn = $('#hud-voice-btn')
  const bodyEl = $('.hud-body')
  const callEl = $('.hud-call')
  const rineEl = $('.hud-rine')
  const callStateEl = $('#call-state')
  const callSubtitleEl = $('#call-subtitle')
  const callTimeEl = $('#phone-time')
  const callControls = $('#call-controls')
  const callAcceptRow = $('#call-accept-row')
  const rineLog = $('#rine-log')
  const rineQuick = $('#rine-quick')
  const diaryEl = $('.hud-diary')
  const diaryLog = $('#diary-log')
  const diaryInput = $('#diary-input')
  const diarySubmit = $('#diary-submit')
  const tabs = el.querySelectorAll('.hud-tabs .hud-btn')

  /* ---- unread badge ----------------------------------------- */
  let unread = 0
  function bumpBadge() {
    if (!consoleEl.classList.contains('hidden')) return
    unread = Math.min(unread + 1, 99)
    badgeEl.textContent = String(unread)
    badgeEl.classList.remove('hidden')
    badgeEl.classList.remove('pop')
    void badgeEl.offsetWidth
    badgeEl.classList.add('pop')
  }
  function clearBadge() {
    unread = 0
    badgeEl.classList.add('hidden')
  }

  /* ---- tabs -------------------------------------------------- */
  function setTab(tab) {
    bodyEl.classList.toggle('hidden', tab !== 'term')
    callEl.classList.toggle('hidden', tab !== 'call')
    rineEl.classList.toggle('hidden', tab !== 'rine')
    diaryEl.classList.toggle('hidden', tab !== 'diary')
    consoleEl.classList.toggle('call-mode', tab === 'call')
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.act === `tab-${tab}`))
    onTab(tab)
  }

  /* ---- console ----------------------------------------------- */
  function toggleConsole(show) {
    const willShow = show !== undefined ? show : consoleEl.classList.contains('hidden')
    consoleEl.classList.toggle('hidden', !willShow)
    if (willShow) clearBadge()
    onToggle(willShow)
  }

  function sysLog(text) { log(`<span class="sys">[SYS] ${text}</span>`) }
  function userLog(text) {
    log(`<span class="user">&gt; ${text}</span>`)
    bumpBadge()
  }
  function aiLog(text) {
    log(`<span class="ai">▸ ${text}</span>`)
    bumpBadge()
  }
  function log(html) {
    const div = document.createElement('div')
    div.className = 'log-line'
    div.innerHTML = html
    logEl.appendChild(div)
    while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild)
    logEl.scrollTop = logEl.scrollHeight
    // secret diary: record every interaction
    const t = new Date()
    const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
    const row = document.createElement('div')
    row.className = 'diary-row'
    row.innerHTML = `<span class="t">${stamp}</span>${html.replace(/<[^>]+>/g, '')}`
    diaryLog.appendChild(row)
    while (diaryLog.children.length > 200) diaryLog.removeChild(diaryLog.firstChild)
  }

  /* ---- waveform (TERM) --------------------------------------- */
  const wctx = waveCanvas.getContext('2d')
  let wavePhase = 0
  function drawWave() {
    const w = waveCanvas.width, h = waveCanvas.height
    wctx.clearRect(0, 0, w, h)
    wctx.strokeStyle = 'rgba(79,216,255,0.85)'
    wctx.lineWidth = 1.4
    for (let ring = 0; ring < 3; ring++) {
      const base = 26 + ring * 22
      wctx.beginPath()
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.05) {
        const amp = 5 + ring * 3
        const r = base + Math.sin(a * 9 + wavePhase * (1 + ring * 0.5)) * amp
        const x = w / 2 + Math.cos(a) * r
        const y = h / 2 + Math.sin(a) * r
        if (a === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y)
      }
      wctx.stroke()
    }
    wctx.fillStyle = 'rgba(79,216,255,0.9)'
    wctx.beginPath(); wctx.arc(w / 2, h / 2, 2.4, 0, Math.PI * 2); wctx.fill()
    wavePhase += 0.06
  }

  /* ---- meters ------------------------------------------------ */
  const memMeter = $('#meter-mem')
  const syncMeter = $('#meter-sync')
  const qMeter = $('#meter-q')
  function drawMeters() {
    memMeter.style.width = (28 + Math.abs(Math.sin(wavePhase * 0.7)) * 60) + '%'
    syncMeter.style.width = (72 + Math.sin(wavePhase * 1.3) * 20) + '%'
    qMeter.style.width = (40 + Math.abs(Math.cos(wavePhase * 0.4)) * 55) + '%'
  }

  /* ---- call view --------------------------------------------- */
  let callState = 'standby' // standby | ringing | active | hold
  let callHold = false

  function setCallState(state) {
    callState = state
    callHold = false
    const active = state === 'active' || state === 'hold'
    const ringing = state === 'ringing'
    callControls.querySelector('[data-act="call-ring"]').classList.toggle('hidden', state !== 'standby')
    callControls.querySelector('[data-act="call-end"]').classList.toggle('hidden', !active)
    callControls.querySelector('[data-act="call-hold"]').classList.toggle('hidden', !active)
    // ringing: the controls pill has no visible button → hide the whole pill
    // so no empty dark-gray capsule floats above the accept row
    callControls.classList.toggle('empty', ringing)
    callAcceptRow.classList.toggle('hidden', !ringing)
    callStateEl.textContent = ringing ? 'INCOMING' : active ? 'IN CALL' : 'STANDBY'
    callStateEl.classList.toggle('ringing', ringing)
    callStateEl.classList.toggle('hold', state === 'hold')
  }

  /* ---- clock -------------------------------------------------- */
  /* ---- RINE --------------------------------------------------- */
  const stickers = el.querySelectorAll('.rine-stickers .sticker')
  let quickPool = QUICK_REPLIES[Math.floor(Math.random() * QUICK_REPLIES.length)]

  function rineMsg(who, text) {
    const div = document.createElement('div')
    div.className = `rine-msg ${who}`
    div.innerHTML = `<div class="rine-bubble"></div><span class="rine-receipt"></span>`
    div.querySelector('.rine-bubble').textContent = text
    rineLog.appendChild(div)
    while (rineLog.children.length > 50) rineLog.removeChild(rineLog.firstChild)
    rineLog.scrollTop = rineLog.scrollHeight
    return div
  }

  function rineSticker(who, emoji) {
    const div = document.createElement('div')
    div.className = `rine-msg ${who} sticker-msg`
    div.innerHTML = `<div class="rine-sticker-bubble"></div><span class="rine-receipt"></span>`
    div.querySelector('.rine-sticker-bubble').textContent = emoji
    rineLog.appendChild(div)
    rineLog.scrollTop = rineLog.scrollHeight
    return div
  }

  function markRead(div) {
    const r = div.querySelector('.rine-receipt')
    if (r) r.textContent = '已读'
  }

  function showQuickReplies() {
    rineQuick.innerHTML = ''
    quickPool = QUICK_REPLIES[Math.floor(Math.random() * QUICK_REPLIES.length)]
    quickPool.forEach((q) => {
      const b = document.createElement('button')
      b.className = 'rine-quick-btn'
      b.textContent = q
      b.addEventListener('click', () => {
        userLog(q)
        rineMsg('user', q)
        rineQuick.innerHTML = ''
        onQuickReply(q)
      })
      rineQuick.appendChild(b)
    })
  }

  /* ---- clock -------------------------------------------------- */
  function tickClock() {
    const d = new Date()
    const t = d.toTimeString().slice(0, 8)
    clockEl.textContent = t
    callTimeEl.textContent = t.slice(0, 5)
  }

  const animTimer = setInterval(() => {
    if (!consoleEl.classList.contains('hidden')) {
      drawWave(); drawMeters()
    }
    tickClock()
  }, 100)

  /* ---- events ------------------------------------------------- */
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'console') toggleConsole()
    else if (act === 'rine-dock') { toggleConsole(true); setTab('rine') }
    else if (act === 'park') { onPark?.(); sysLog('停靠指令已执行') }
    else if (act === 'quit') { onQuit?.() }
    else if (act === 'resize-up') { onResize?.(1); sysLog('显示倍率 +0.05') }
    else if (act === 'resize-down') { onResize?.(-1); sysLog('显示倍率 -0.05') }
    else if (act === 'opacity-up') { onOpacity?.(1) }
    else if (act === 'opacity-down') { onOpacity?.(-1) }
    else if (act === 'voice') { onVoice?.() }
    else if (act === 'model') { onModel?.() }
    else if (act === 'tab-term') { setTab('term') }
    else if (act === 'tab-call') {
      setTab('call')
      sysLog('通话界面已开启')
    }
    else if (act === 'tab-rine') { setTab('rine') }
    else if (act === 'tab-diary') { setTab('diary') }
    else if (act === 'call-ring') {
      setCallState('ringing')
      sysLog('正在呼叫 AMA·DEUS…')
    }
    else if (act === 'call-accept') {
      setCallState('active')
      sysLog('通话已接通')
      onIncoming?.('accept')
    }
    else if (act === 'call-decline') {
      setCallState('standby')
      sysLog('通话已拒绝')
      onIncoming?.('decline')
    }
    else if (act === 'call-end') {
      setCallState('standby')
      sysLog('通话结束')
    }
    else if (act === 'call-hold') {
      callHold = !callHold
      setCallState(callHold ? 'hold' : 'active')
      callStateEl.textContent = callHold ? 'HOLD' : 'IN CALL'
      sysLog(callHold ? '通话保持中' : '通话已恢复')
    }
  })

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    userLog(text)
    rineMsg('user', text)
    onCommand(text)
  })

  stickers.forEach((s) => {
    s.addEventListener('click', () => {
      rineSticker('user', s.textContent)
      aiLog('（收到贴纸）')
      const reply = document.createElement('div')
      rineMsg('her', '……')
      markRead(reply)
      showQuickReplies()
    })
  })

  /* ---- diary deletion code ----------------------------------- */
  diarySubmit.addEventListener('click', () => {
    const code = diaryInput.value.trim()
    if (code.toLowerCase() === 'der alte würfelt nicht') {
      diaryLog.innerHTML = ''
      diaryInput.value = ''
      sysLog('删除码通过')
      aiLog('交互记录已删除。……就这样吧。')
    } else {
      diaryInput.value = ''
      sysLog('删除码不正确')
    }
  })
  diaryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') diarySubmit.click()
  })

  /* ---- public API -------------------------------------------- */
  return {
    el,
    toggleConsole,
    setTab,
    sysLog,
    userLog,
    aiLog,
    setLinkStatus: (ok, label) => {
      linkEl.textContent = label || (ok ? 'LINK OK' : 'LINK DOWN')
      $('.led').classList.toggle('bad', !ok)
    },
    setVoiceState: (on) => {
      voiceBtn.textContent = on ? '音:开' : '音:关'
      voiceBtn.classList.toggle('off', !on)
    },
    setCallSubtitle: (text) => {
      callSubtitleEl.textContent = text
    },
    setCallState,
    incomingCall: () => {
      toggleConsole(true)
      setTab('call')
      setCallState('ringing')
      sysLog('检测到来电请求')
    },
    rineHer(text, { read = false, quick = true } = {}) {
      const div = rineMsg('her', text)
      if (read) markRead(div)
      if (quick) showQuickReplies()
      return div
    },
    rineUser(text) {
      const div = rineMsg('user', text)
      setTimeout(() => markRead(div), 1400)
      return div
    },
    dRine(text) {
      const div = rineMsg('her', text)
      div.classList.add('drine')
      return div
    },
    dispose() {
      clearInterval(animTimer)
      el.remove()
    },
  }
}
