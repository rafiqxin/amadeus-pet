import './amadeus.css'
import { getRemoteConfig, setRemoteConfig, clearRemoteConfig, checkServer, usingRemoteApi } from '../llm/client.js'
import { getTtsConfig, setTtsConfig, clearTtsConfig, checkTtsServer } from '../voice/tts-client.js'

export function mountAmadeusUi(root, hooks = {}) {
  const { onSend = () => {}, onRecognize = null } = hooks
  const el = document.createElement('div')
  el.className = 'amadeus-ui'
  el.innerHTML = `
    <header class="ama-statusbar"><div class="ama-brand">AMA·DEUS <span>LAB MEM 004</span></div><div class="ama-link"><i></i><span data-ama-status>STANDBY</span><button class="ama-quit" data-act="quit" type="button" title="关闭 AMA-DEUS" aria-label="关闭 AMA-DEUS">×</button></div></header>
    <div class="ama-thinking" data-ama-thinking aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="ama-subtitle" data-ama-subtitle></div>
    <nav class="ama-dock" aria-label="AMA-DEUS controls"><button data-act="chat" aria-label="文字通信">⌨</button><button data-act="voice" aria-label="语音通信">●</button><button data-act="settings" aria-label="连接设置">⚙</button></nav>
    <div class="ama-backdrop" data-act="close"></div>
    <section class="ama-sheet" data-sheet="chat" aria-hidden="true"><div class="ama-grab"></div><div class="ama-sheet-head"><div><small>TEXT LINK</small><strong>文字通信</strong></div><button data-act="close">×</button></div><form data-chat-form><textarea rows="3" maxlength="1000" placeholder="用中文和红莉栖说点什么…"></textarea><button class="primary" type="submit">发送</button></form></section>
    <section class="ama-sheet" data-sheet="voice" aria-hidden="true"><div class="ama-grab"></div><div class="ama-sheet-head"><div><small>VOICE LINK · ZH INPUT</small><strong>中文语音通信</strong></div><button data-act="close">×</button></div><div class="ama-orb">●</div><div class="ama-voice-state" data-voice-state>${onRecognize ? '点击开始收音。按中文识别，识别完成后自动发送。' : '当前平台未接入原生中文语音识别。'}</div><div class="ama-transcript" data-transcript></div>${onRecognize ? '<button class="primary" data-act="recognize" type="button">开始中文收音</button>' : ''}</section>
    <section class="ama-sheet ama-settings" data-sheet="settings" aria-hidden="true"><div class="ama-grab"></div><div class="ama-sheet-head"><div><small>CONNECTION</small><strong>模型与语音</strong></div><button data-act="close">×</button></div><div class="ama-section-title">LLM · OpenAI Compatible</div><label><span>Endpoint</span><input data-llm-endpoint inputmode="url" placeholder="https://api.deepseek.com" /></label><label><span>Model</span><input data-llm-model placeholder="deepseek-chat" /></label><label><span>API Key</span><input data-llm-key type="password" autocomplete="off" placeholder="留空则保留已保存 Key" /></label><div class="ama-section-title">KURISU TTS · JAPANESE OUTPUT</div><label><span>TTS Endpoint</span><input data-tts-endpoint inputmode="url" placeholder="http://192.168.1.100:9881" /></label><label class="ama-toggle"><input data-tts-enabled type="checkbox" checked /><span>无匹配原版 OGG 时生成日语 Kurisu TTS</span></label><div class="ama-language-flow"><b>语音链路</b><span>中文输入 / 中文字幕 → 日语发声</span></div><div class="ama-settings-status" data-settings-status>未检测</div><div class="ama-actions"><button data-act="clear-settings" type="button">清除</button><button data-act="save-settings" type="button">保存</button><button class="primary" data-act="test-settings" type="button">保存并测试</button></div><p>优先级：高置信度原版日语 OGG → 中文回复翻译为日语 → Kurisu TTS → 纯文字。不会回退到 Android/Web Speech 系统女声。</p></section>
  `
  root.appendChild(el)

  const subtitle = el.querySelector('[data-ama-subtitle]'), status = el.querySelector('[data-ama-status]')
  const thinkingEl = el.querySelector('[data-ama-thinking]')
  const sheets = [...el.querySelectorAll('[data-sheet]')], backdrop = el.querySelector('.ama-backdrop')
  const chatInput = el.querySelector('[data-chat-form] textarea'), settingsStatus = el.querySelector('[data-settings-status]')
  const voiceState = el.querySelector('[data-voice-state]'), transcript = el.querySelector('[data-transcript]')
  let activeSheet = null, subtitleTimer = null

  function setStatus(text) { status.textContent = String(text || 'STANDBY') }
  function setSubtitle(text, ms = 7000) {
    const value = String(text || '').trim(); subtitle.textContent = value; subtitle.classList.toggle('show', !!value)
    clearTimeout(subtitleTimer); if (value && ms > 0) subtitleTimer = setTimeout(() => subtitle.classList.remove('show'), ms)
  }
  /* Shown while the reply is being produced and voiced. It occupies the same
     slot as the subtitle so the two swap in place: thinking dots during the
     LLM + synthesis gap, then the line itself the moment audio starts. */
  function setThinking(on) {
    const active = !!on
    thinkingEl.classList.toggle('show', active)
    thinkingEl.setAttribute('aria-hidden', active ? 'false' : 'true')
    if (active) setSubtitle('', 0)
  }
  function closeSheet() { if (activeSheet) { activeSheet.classList.remove('open'); activeSheet.setAttribute('aria-hidden', 'true') }; activeSheet = null; el.classList.remove('sheet-open') }
  function openSheet(name) { closeSheet(); const sheet = sheets.find((x) => x.dataset.sheet === name); if (!sheet) return; activeSheet = sheet; el.classList.add('sheet-open'); sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false') }
  function loadSettings() {
    const llm = getRemoteConfig(), tts = getTtsConfig()
    el.querySelector('[data-llm-endpoint]').value = llm.endpoint || ''; el.querySelector('[data-llm-model]').value = llm.model || ''; el.querySelector('[data-llm-key]').value = ''
    el.querySelector('[data-llm-key]').placeholder = llm.hasApiKey ? 'Key 已保存；留空保持不变' : '输入 API Key'
    el.querySelector('[data-tts-endpoint]').value = tts.endpoint || ''; el.querySelector('[data-tts-enabled]').checked = tts.enabled !== false
    settingsStatus.textContent = `${usingRemoteApi() ? 'LLM 已配置' : 'LLM: 本地模式'} · ${tts.endpoint ? 'TTS 已配置 / 日语输出' : 'TTS 未配置'}`
  }
  async function saveSettings(test = false) {
    const next = { endpoint: el.querySelector('[data-llm-endpoint]').value, model: el.querySelector('[data-llm-model]').value }
    const key = el.querySelector('[data-llm-key]').value.trim(); if (key) next.apiKey = key
    setRemoteConfig(next); setTtsConfig({ endpoint: el.querySelector('[data-tts-endpoint]').value, enabled: el.querySelector('[data-tts-enabled]').checked }); loadSettings()
    if (!test) { settingsStatus.textContent = '配置已保存'; return }
    settingsStatus.textContent = '正在测试 LLM / TTS…'; const [llmOk, tts] = await Promise.all([checkServer(), checkTtsServer()])
    const lang = tts?.body?.output_language ? `/${String(tts.body.output_language).toUpperCase()}` : ''
    settingsStatus.textContent = `LLM: ${llmOk ? 'OK' : 'FAIL'} · TTS: ${tts.ok ? `OK${lang}` : (tts.reason === 'not-configured' ? '未配置' : 'FAIL')}`
  }

  loadSettings()
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return; const act = btn.dataset.act
    if (act === 'close') closeSheet()
    else if (act === 'quit') { closeSheet(); window.amadeus?.quit?.() }
    else if (act === 'chat') { openSheet('chat'); setTimeout(() => chatInput.focus({ preventScroll: true }), 120) }
    else if (act === 'voice') openSheet('voice')
    else if (act === 'settings') { loadSettings(); openSheet('settings') }
    else if (act === 'save-settings') await saveSettings(false)
    else if (act === 'test-settings') await saveSettings(true)
    else if (act === 'clear-settings') { clearRemoteConfig(); clearTtsConfig(); loadSettings(); settingsStatus.textContent = '配置已清除' }
    else if (act === 'recognize' && onRecognize) {
      voiceState.textContent = '正在收音（中文）…'; transcript.textContent = ''; btn.disabled = true
      try { const text = await onRecognize(); transcript.textContent = `识别：${text}`; voiceState.textContent = '识别完成，正在发送…'; closeSheet(); onSend(text) }
      catch (error) { voiceState.textContent = error?.message || '中文语音识别失败' }
      finally { btn.disabled = false }
    }
  })
  el.querySelector('[data-chat-form]').addEventListener('submit', (e) => { e.preventDefault(); const text = chatInput.value.trim(); if (!text) return; chatInput.value = ''; closeSheet(); onSend(text) })
  backdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  return { setStatus, setSubtitle, setThinking, openSheet, closeSheet, loadSettings }
}
