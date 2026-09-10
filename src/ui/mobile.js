import './mobile.css'
import {
  checkServer,
  getRemoteConfig,
  setRemoteConfig,
  clearRemoteConfig,
  usingRemoteApi,
} from '../pet/llm.js'

export function mountMobileUi(root, hooks = {}) {
  const { onSend = () => {}, onVoiceState = () => {} } = hooks

  const shell = document.createElement('div')
  shell.className = 'mobile-ui'
  shell.innerHTML = `
    <div class="mobile-dock" role="toolbar" aria-label="AMA-DEUS controls">
      <button class="mobile-dock-btn" data-mobile-act="chat" aria-label="文字聊天">⌨</button>
      <button class="mobile-dock-btn mobile-mic-btn" data-mobile-act="voice" aria-label="语音状态">●</button>
      <button class="mobile-dock-btn" data-mobile-act="api" aria-label="API 设置">⚙</button>
    </div>
    <div class="mobile-sheet-backdrop" data-mobile-act="close"></div>

    <section class="mobile-sheet mobile-chat-sheet" aria-hidden="true">
      <div class="mobile-sheet-grab"></div>
      <div class="mobile-sheet-head"><div><div class="mobile-sheet-kicker">AMA·DEUS</div><div class="mobile-sheet-title">文字通信</div></div><button class="mobile-close" data-mobile-act="close">×</button></div>
      <form class="mobile-chat-form"><textarea class="mobile-chat-input" rows="3" maxlength="600" placeholder="和红莉栖说点什么…"></textarea><button class="mobile-primary" type="submit">发送</button></form>
    </section>

    <section class="mobile-sheet mobile-api-sheet" aria-hidden="true">
      <div class="mobile-sheet-grab"></div>
      <div class="mobile-sheet-head"><div><div class="mobile-sheet-kicker">CONNECTION</div><div class="mobile-sheet-title">模型 API</div></div><button class="mobile-close" data-mobile-act="close">×</button></div>
      <label class="mobile-field"><span>Endpoint</span><input class="mobile-api-endpoint" inputmode="url" placeholder="https://api.openai.com/v1" /></label>
      <label class="mobile-field"><span>Model</span><input class="mobile-api-model" placeholder="例如 gpt-5-mini" /></label>
      <label class="mobile-field"><span>API Key</span><input class="mobile-api-key" type="password" autocomplete="off" placeholder="输入新 Key；留空则保留已保存 Key" /></label>
      <div class="mobile-api-status">未检测</div>
      <div class="mobile-api-actions"><button class="mobile-secondary" type="button" data-mobile-act="clear-api">清除</button><button class="mobile-secondary" type="button" data-mobile-act="save-api">保存</button><button class="mobile-primary" type="button" data-mobile-act="save-test-api">保存并测试</button></div>
      <p class="mobile-api-note">Key 会持久保存在当前 App 的本机 WebView 存储中；留空保存不会覆盖旧 Key。</p>
    </section>

    <section class="mobile-sheet mobile-voice-sheet" aria-hidden="true">
      <div class="mobile-sheet-grab"></div>
      <div class="mobile-sheet-head"><div><div class="mobile-sheet-kicker">VOICE LINK</div><div class="mobile-sheet-title">语音通信</div></div><button class="mobile-close" data-mobile-act="close">×</button></div>
      <div class="mobile-voice-orb">●</div>
      <div class="mobile-voice-status">iPhone 语音输入暂时停用。当前仅在命中原版台词时播放参考 OGG，并同步驱动 Live2D 嘴型与表情。语音输入将在 Android APK 中接入。</div>
      <div class="mobile-voice-transcript">VOICE INPUT: DISABLED ON iOS</div>
    </section>
  `
  root.appendChild(shell)

  const backdrop = shell.querySelector('.mobile-sheet-backdrop')
  const chatSheet = shell.querySelector('.mobile-chat-sheet')
  const apiSheet = shell.querySelector('.mobile-api-sheet')
  const voiceSheet = shell.querySelector('.mobile-voice-sheet')
  const chatInput = shell.querySelector('.mobile-chat-input')
  const endpointInput = shell.querySelector('.mobile-api-endpoint')
  const modelInput = shell.querySelector('.mobile-api-model')
  const keyInput = shell.querySelector('.mobile-api-key')
  const apiStatusEl = shell.querySelector('.mobile-api-status')
  let activeSheet = null

  function closeSheet() {
    activeSheet?.classList.remove('open')
    activeSheet?.setAttribute('aria-hidden', 'true')
    activeSheet = null
    shell.classList.remove('sheet-open')
  }
  function openSheet(sheet) {
    closeSheet(); activeSheet = sheet; shell.classList.add('sheet-open'); sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false')
  }
  function loadApiFields() {
    const cfg = getRemoteConfig()
    endpointInput.value = cfg.endpoint || ''
    modelInput.value = cfg.model || ''
    keyInput.value = ''
    keyInput.placeholder = cfg.hasApiKey ? 'Key 已保存；留空则保持不变' : '输入 API Key'
    apiStatusEl.textContent = usingRemoteApi() ? `远程 API 已保存${cfg.hasApiKey ? ' · Key 已保存' : ''}` : '当前使用本地模型模式'
  }
  function collectApiConfig() {
    const next = { endpoint: endpointInput.value, model: modelInput.value }
    const freshKey = keyInput.value.trim(); if (freshKey) next.apiKey = freshKey
    return next
  }
  async function saveApi(test = false) {
    setRemoteConfig(collectApiConfig()); keyInput.value = ''; loadApiFields()
    if (!test) { apiStatusEl.textContent = '配置已保存'; return }
    apiStatusEl.textContent = '正在测试连接…'
    const ok = await checkServer()
    apiStatusEl.textContent = ok ? '连接成功 · 配置已保存' : '配置已保存，但连接测试失败'
  }

  loadApiFields()
  shell.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mobile-act]'); if (!btn) return
    const act = btn.dataset.mobileAct
    if (act === 'close') closeSheet()
    else if (act === 'chat') { openSheet(chatSheet); setTimeout(() => chatInput.focus(), 180) }
    else if (act === 'api') { loadApiFields(); openSheet(apiSheet) }
    else if (act === 'voice') { onVoiceState(false); openSheet(voiceSheet) }
    else if (act === 'clear-api') { clearRemoteConfig(); loadApiFields(); apiStatusEl.textContent = '已清除，恢复本地模型模式' }
    else if (act === 'save-api') await saveApi(false)
    else if (act === 'save-test-api') await saveApi(true)
  })

  shell.querySelector('.mobile-chat-form').addEventListener('submit', (e) => {
    e.preventDefault(); const text = chatInput.value.trim(); if (!text) return
    chatInput.value = ''; closeSheet(); onSend(text)
  })
  backdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  return { closeSheet, openChat: () => openSheet(chatSheet) }
}
