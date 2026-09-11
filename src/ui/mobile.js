import './mobile.css'
import {
  checkServer,
  getRemoteConfig,
  setRemoteConfig,
  clearRemoteConfig,
  usingRemoteApi,
} from '../llm/client.js'
import {
  checkTtsServer,
  getTtsConfig,
  setTtsConfig,
  clearTtsConfig,
} from '../voice/tts-client.js'
import { nativeSpeechAvailablePlatform, recognizeOnce, stopRecognition } from '../platform/speech.js'

const hasNativeSpeech = nativeSpeechAvailablePlatform()

export function mountMobileUi(root, hooks = {}) {
  const { onSend = () => {}, onVoiceState = () => {} } = hooks

  const shell = document.createElement('div')
  shell.className = 'mobile-ui'
  shell.innerHTML = `
    <div class="mobile-dock" role="toolbar" aria-label="AMA-DEUS controls">
      <button class="mobile-dock-btn" data-mobile-act="chat" aria-label="文字聊天">⌨</button>
      <button class="mobile-dock-btn mobile-mic-btn" data-mobile-act="voice" aria-label="语音输入">●</button>
      <button class="mobile-dock-btn" data-mobile-act="api" aria-label="连接设置">⚙</button>
    </div>
    <div class="mobile-sheet-backdrop" data-mobile-act="close"></div>

    <section class="mobile-sheet mobile-chat-sheet" aria-hidden="true">
      <div class="mobile-sheet-grab"></div>
      <div class="mobile-sheet-head"><div><div class="mobile-sheet-kicker">AMA·DEUS</div><div class="mobile-sheet-title">文字通信</div></div><button class="mobile-close" data-mobile-act="close">×</button></div>
      <form class="mobile-chat-form"><textarea class="mobile-chat-input" rows="3" maxlength="1000" placeholder="用中文和红莉栖说点什么…"></textarea><button class="mobile-primary" type="submit">发送</button></form>
    </section>

    <section class="mobile-sheet mobile-api-sheet" aria-hidden="true">
      <div class="mobile-sheet-grab"></div>
      <div class="mobile-sheet-head"><div><div class="mobile-sheet-kicker">CONNECTION</div><div class="mobile-sheet-title">模型与语音</div></div><button class="mobile-close" data-mobile-act="close">×</button></div>
      <label class="mobile-field"><span>LLM Endpoint</span><input class="mobile-api-endpoint" inputmode="url" placeholder="https://api.deepseek.com" /></label>
      <label class="mobile-field"><span>Model</span><input class="mobile-api-model" placeholder="deepseek-chat" /></label>
      <label class="mobile-field"><span>API Key</span><input class="mobile-api-key" type="password" autocomplete="off" placeholder="输入新 Key；留空则保留已保存 Key" /></label>
      <label class="mobile-field"><span>Kurisu TTS Endpoint · 日语输出</span><input class="mobile-tts-endpoint" inputmode="url" placeholder="http://192.168.1.100:9881（留空禁用）" /></label>
      <div class="mobile-api-status">未检测</div>
      <div class="mobile-api-actions"><button class="mobile-secondary" type="button" data-mobile-act="clear-api">清除</button><button class="mobile-secondary" type="button" data-mobile-act="save-api">保存</button><button class="mobile-primary" type="button" data-mobile-act="save-test-api">保存并测试</button></div>
      <p class="mobile-api-note">固定链路：中文输入 / 中文字幕 → 优先原版日语 OGG → 未命中时生成日语 Kurisu TTS。TTS Endpoint 留空即禁用生成语音。</p>
    </section>

    <section class="mobile-sheet mobile-voice-sheet" aria-hidden="true">
      <div class="mobile-sheet-grab"></div>
      <div class="mobile-sheet-head"><div><div class="mobile-sheet-kicker">VOICE LINK · ZH-CN</div><div class="mobile-sheet-title">语音通信</div></div><button class="mobile-close" data-mobile-act="close">×</button></div>
      <div class="mobile-voice-orb">●</div>
      <div class="mobile-voice-status">${hasNativeSpeech ? '点击开始收音；按中文识别，识别完成后自动发送给 AMA-DEUS。' : '当前平台暂未启用语音输入。'}</div>
      <div class="mobile-voice-transcript"></div>
      ${hasNativeSpeech ? '<button class="mobile-primary mobile-voice-start" type="button" data-mobile-act="voice-start">开始收音</button>' : ''}
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
  const ttsEndpointInput = shell.querySelector('.mobile-tts-endpoint')
  const apiStatusEl = shell.querySelector('.mobile-api-status')
  const voiceStatusEl = shell.querySelector('.mobile-voice-status')
  const voiceTranscriptEl = shell.querySelector('.mobile-voice-transcript')
  const voiceStartBtn = shell.querySelector('.mobile-voice-start')
  const micDockBtn = shell.querySelector('.mobile-mic-btn')
  const voiceOrb = shell.querySelector('.mobile-voice-orb')
  let activeSheet = null
  let listening = false

  function closeSheet() {
    activeSheet?.classList.remove('open')
    activeSheet?.setAttribute('aria-hidden', 'true')
    activeSheet = null
    shell.classList.remove('sheet-open')
  }

  function openSheet(sheet) {
    closeSheet()
    activeSheet = sheet
    shell.classList.add('sheet-open')
    sheet.classList.add('open')
    sheet.setAttribute('aria-hidden', 'false')
  }

  function loadApiFields() {
    const cfg = getRemoteConfig()
    const tts = getTtsConfig()
    endpointInput.value = cfg.endpoint || ''
    modelInput.value = cfg.model || ''
    keyInput.value = ''
    keyInput.placeholder = cfg.hasApiKey ? 'Key 已保存；留空则保持不变' : '输入 API Key'
    ttsEndpointInput.value = tts.endpoint || ''
    apiStatusEl.textContent = `${usingRemoteApi() ? 'LLM 已配置' : 'LLM 未配置'} · ${tts.endpoint && tts.enabled !== false ? 'Kurisu TTS 已配置 / JA' : 'TTS 未配置'}`
  }

  function collectApiConfig() {
    const next = { endpoint: endpointInput.value, model: modelInput.value }
    const freshKey = keyInput.value.trim()
    if (freshKey) next.apiKey = freshKey
    return next
  }

  async function saveApi(test = false) {
    setRemoteConfig(collectApiConfig())
    const ttsEndpoint = ttsEndpointInput.value.trim()
    setTtsConfig({ endpoint: ttsEndpoint, enabled: !!ttsEndpoint })
    keyInput.value = ''
    loadApiFields()
    if (!test) {
      apiStatusEl.textContent = '配置已保存'
      return
    }
    apiStatusEl.textContent = '正在测试 LLM / TTS…'
    const [llmOk, tts] = await Promise.all([checkServer(), checkTtsServer()])
    const ttsLabel = tts.reason === 'not-configured' ? '未配置' : (tts.ok ? 'OK/JA' : 'FAIL')
    apiStatusEl.textContent = `LLM: ${llmOk ? 'OK' : 'FAIL'} · TTS: ${ttsLabel}`
  }

  function setListening(on) {
    listening = on
    if (voiceStartBtn) voiceStartBtn.textContent = on ? '停止收音' : '开始收音'
    voiceStartBtn?.classList.toggle('listening', on)
    micDockBtn?.classList.toggle('listening', on)
    voiceOrb?.classList.toggle('listening', on)
    onVoiceState(on)
  }

  async function startVoice() {
    if (!hasNativeSpeech) return

    if (listening) {
      await stopRecognition()
      setListening(false)
      voiceStatusEl.textContent = '已停止'
      return
    }

    voiceTranscriptEl.textContent = ''
    voiceStatusEl.textContent = '正在请求麦克风/语音识别权限…'
    setListening(true)
    try {
      voiceStatusEl.textContent = '正在收音，请说中文…'
      const text = await recognizeOnce({ language: 'zh-CN' })
      const clean = String(text || '').trim()
      if (!clean) throw new Error('没有识别到有效语音')
      voiceTranscriptEl.textContent = `识别：${clean}`
      voiceStatusEl.textContent = '识别完成，正在发送…'
      closeSheet()
      onSend(clean)
    } catch (err) {
      voiceStatusEl.textContent = err?.message || '语音识别失败'
    } finally {
      setListening(false)
    }
  }

  loadApiFields()
  shell.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mobile-act]')
    if (!btn) return
    const act = btn.dataset.mobileAct
    if (act === 'close') closeSheet()
    else if (act === 'chat') { openSheet(chatSheet); setTimeout(() => chatInput.focus(), 180) }
    else if (act === 'api') { loadApiFields(); openSheet(apiSheet) }
    else if (act === 'voice') openSheet(voiceSheet)
    else if (act === 'voice-start') await startVoice()
    else if (act === 'clear-api') {
      clearRemoteConfig(); clearTtsConfig(); loadApiFields(); apiStatusEl.textContent = 'LLM / TTS 配置已清除'
    }
    else if (act === 'save-api') await saveApi(false)
    else if (act === 'save-test-api') await saveApi(true)
  })

  shell.querySelector('.mobile-chat-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = chatInput.value.trim()
    if (!text) return
    chatInput.value = ''
    closeSheet()
    onSend(text)
  })

  backdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })

  return { closeSheet, openChat: () => openSheet(chatSheet), startVoice, loadApiFields }
}
