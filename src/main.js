/* AMA-DEUS iOS renderer: retain the current CALL presentation while the
   interaction/voice core follows main. */
import './style.css'

import { createPetAppCubism2 } from './live2d/cubism2app.js'
import { mountHud } from './ui/hud.js'
import { mountBubble } from './ui/bubble.js'
import { mountBoot } from './ui/boot.js'
import { mountMobileUi } from './ui/mobile.js'
import { mountIosCallTranscriptScroll } from './ui/ios-call-scroll.js'
import { isIOSRuntime } from './platform/runtime.js'
import { createDialogue } from './pet/dialogue.js'
import { createSettings, applyVisualSettings } from './pet/settings.js'
import { playRingTone } from './pet/tone.js'
import { planReaction, applyReaction } from './pet/reaction.js'
import { nextTouchReaction } from './pet/touch-reactions.js'
import {
  chat,
  checkServer,
  usingRemoteApi,
  classifyReferenceVoice,
  translateForKurisuTts,
} from './llm/client.js'
import { routeAndSpeak } from './voice/pipeline.js'
import { playReferenceVoice, playAudioBlob, stopVoicePlayback, unlockVoiceAudio } from './voice/player.js'
import { checkTtsServer, setTtsConfig, synthesizeTts } from './voice/tts-client.js'
import { beginVoiceTrace, voiceDiagnostic } from './voice/diagnostics.js'

const MODEL_DIR = './models/kurisu/'
const MODEL_FILE = 'kurisu.model.json'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function boot() {
  const stage = document.getElementById('stage')
  const canvas = document.getElementById('l2d-canvas2')
  const hudRoot = document.getElementById('hud-root')
  if (!stage || !canvas || !hudRoot) throw new Error('iOS CALL surface is incomplete')

  const isIOS = isIOSRuntime()
  const uiTest = !!window.__AMA_UI_TEST__
  const uiTestMode = String(window.__AMA_UI_TEST_MODE__ || '')
  document.body.classList.toggle('mobile-ios', isIOS)

  const testState = { ready: 0, reactions: 0, audio: 0, scroll: 0, max: 0, scrollable: 0, scrolled: 0, voice: 'IDLE' }
  let testProbe = null
  const updateTestProbe = () => {
    if (!uiTest) return
    if (!testProbe) {
      testProbe = document.createElement('div')
      testProbe.id = 'ama-test-probe'
      testProbe.style.cssText = 'position:fixed;left:2px;top:2px;z-index:100000;padding:2px 3px;background:#000;color:#fff;font:9px monospace;pointer-events:none;'
      document.body.appendChild(testProbe)
    }
    testProbe.textContent = `AMA_TEST_PROBE ready=${testState.ready} reactions=${testState.reactions} audio=${testState.audio} scroll=${Math.round(testState.scroll)} max=${Math.round(testState.max)} scrollable=${testState.scrollable} scrolled=${testState.scrolled} voice=${testState.voice}`
    // XCUITest cannot reliably see arbitrary DOM text inside WKWebView. Mirror
    // the same state through a test-only native script-message bridge; the
    // harness exposes it as a UILabel accessibility element.
    try { window.webkit?.messageHandlers?.amaTest?.postMessage({ ...testState }) } catch {}
  }
  const onDiagnostic = (event) => {
    if (!uiTest) return
    const d = event.detail || {}
    testState.voice = `${d.stage || 'IDLE'}-${d.status || 'OK'}`
    if (d.stage === 'PLAY' && d.status === 'OK') testState.audio += 1
    updateTestProbe()
  }
  const onTranscriptScroll = (event) => {
    if (!uiTest) return
    testState.scroll = Number(event.detail?.scrollTop || 0)
    testState.max = Number(event.detail?.maxScroll || 0)
    testState.scrollable = event.detail?.scrollable ? 1 : 0
    if (testState.scroll > 0) testState.scrolled = 1
    updateTestProbe()
  }
  window.addEventListener('ama-voice-diagnostics', onDiagnostic)
  window.addEventListener('ama-transcript-scroll', onTranscriptScroll)
  updateTestProbe()

  const settings = createSettings()
  if (isIOS && settings.get('voice') === false) settings.set('voice', true)
  applyVisualSettings(stage, canvas, settings)
  const dialogue = createDialogue()
  const bubble = mountBubble(hudRoot)

  let app = null
  let pet = null
  let consoleOpen = false
  let busy = false
  let lastPrimaryTapAt = -Infinity
  let lastAnyTapAt = -Infinity

  function viewportSize() {
    const rect = stage.getBoundingClientRect()
    return {
      w: Math.max(1, Math.round(rect.width || window.innerWidth || 393)),
      h: Math.max(1, Math.round(rect.height || window.innerHeight || 852)),
    }
  }
  function resize() {
    if (!app) return
    const v = viewportSize()
    app.resize(v.w, v.h)
  }
  function setMouth(level) { app?.setMouthOpen?.(level) }

  function presentLine(text, { log = true, rine = true, durationMs = 0 } = {}) {
    const line = String(text || '').trim()
    if (!line) return
    const estimated = Math.max(2600, Math.min(14000, line.length * 220))
    const holdMs = Number(durationMs) > 0
      ? Math.max(900, Math.min(30000, Number(durationMs) + 260))
      : estimated
    if (!consoleOpen) bubble.say(line, holdMs)
    if (log) hud.aiLog(line)
    hud.setCallSubtitle(line)
    if (rine) hud.rineHer(line, { read: true, quick: true })
  }

  function thinking() {
    if (!consoleOpen) bubble.say('……', 60000)
    hud.setCallSubtitle('……')
  }

  async function playTouch(hit) {
    if (!pet || busy || settings.get('voice') === false) return
    const now = performance.now()
    if (now - lastAnyTapAt < 140) return
    lastAnyTapAt = now

    void unlockVoiceAudio()
    const reaction = nextTouchReaction(hit?.area || 'body')
    if (uiTest) {
      testState.reactions += 1
      updateTestProbe()
    }
    beginVoiceTrace('TOUCH OGG')
    voiceDiagnostic('CONFIG', 'SKIP', reaction.voice)
    applyReaction(pet, reaction, { playMotion: true })

    const result = await playReferenceVoice(reaction.voice, {
      onLevel: setMouth,
      onStart: ({ durationSec = 0 } = {}) => {
        presentLine(reaction.text, {
          log: false,
          rine: false,
          durationMs: durationSec > 0 ? durationSec * 1000 : 0,
        })
      },
      onEnd: () => hud.setCallSubtitle(''),
    })
    if (!result.played) {
      presentLine(reaction.text, { log: false, rine: false })
      setMouth(0)
    }
  }

  function pointHit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
    const x = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width))
    const y = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height))
    let precise = false
    try { precise = pet?.hitTest?.(x, y) || false } catch {}
    const normalizedY = (clientY - rect.top) / Math.max(1, rect.height)
    const area = precise
      ? String(precise).toLowerCase()
      : normalizedY < 0.42 ? 'head' : normalizedY < 0.63 ? 'mouth' : 'body'
    return { area, source: precise ? 'stage-hit-test' : 'stage-coordinate', model: pet, x, y }
  }

  function interactiveTarget(target) {
    return !!target?.closest?.('button,input,textarea,form,.mobile-dock,.mobile-sheet,.mobile-sheet-backdrop,.call-subtitle,.call-scroll-track,.boot')
  }

  /* Cubism owns the primary tap path exactly as it does on main. The stage
     fallback runs only after bubbling confirms Cubism did not claim the same
     gesture; it uses coordinates + Live2D hit testing and never depends on the
     DOM target being exactly the canvas. */
  let pointerStart = null
  function mountIosStageTapFallback() {
    if (!isIOS) return () => {}
    const onPointerDown = (event) => {
      if (interactiveTarget(event.target)) return
      const hit = pointHit(event.clientX, event.clientY)
      if (!hit) return
      pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() }
      void unlockVoiceAudio()
    }
    const onPointerUp = (event) => {
      const start = pointerStart
      pointerStart = null
      if (!start || start.id !== event.pointerId || interactiveTarget(event.target)) return
      if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 14) return
      const hit = pointHit(event.clientX, event.clientY)
      if (!hit) return
      queueMicrotask(() => {
        if (lastPrimaryTapAt >= start.at) return
        void playTouch(hit)
      })
    }
    const onPointerCancel = () => { pointerStart = null }
    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('pointerup', onPointerUp)
    stage.addEventListener('pointercancel', onPointerCancel)
    return () => {
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointerup', onPointerUp)
      stage.removeEventListener('pointercancel', onPointerCancel)
    }
  }

  async function speakReply(reply, mood = 'normal') {
    const line = String(reply || '').trim()
    if (!line) return
    const reaction = planReaction(line, { mood })
    applyReaction(pet, reaction, { playMotion: true })
    hud.aiLog(line)
    hud.rineHer(line, { read: true, quick: true })
    presentLine(line, { log: false, rine: false })

    if (settings.get('voice') === false) {
      await wait(Math.max(2200, Math.min(12000, line.length * 210)))
      hud.setCallSubtitle('')
      return
    }

    let resolveEnd
    const ended = new Promise((resolve) => { resolveEnd = resolve })
    const route = await routeAndSpeak(line, {
      classify: classifyReferenceVoice,
      translateTts: translateForKurisuTts,
      mood: reaction.emotion,
      onLevel: setMouth,
      onStart: () => {},
      onEnd: (meta) => resolveEnd(meta),
    })

    if (route.played) {
      await ended
      await wait(220)
    } else {
      hud.sysLog(route.error ? `语音回退为文字：${route.error}` : '语音回退为文字')
      await wait(Math.max(2200, Math.min(14000, line.length * 220)))
    }
    hud.setCallSubtitle('')
    setMouth(0)
  }

  async function brain(text) {
    const input = String(text || '').trim()
    if (!input || busy) return
    busy = true
    thinking()
    try {
      let reply = ''
      let mood = 'normal'
      if (usingRemoteApi()) {
        try {
          reply = await chat(input)
        } catch (error) {
          hud.sysLog(`LLM 请求失败：${error?.message || error}`)
        }
      }
      if (!reply) {
        const fallback = dialogue.bankHints?.(input)
        mood = fallback?.mood || 'normal'
        reply = dialogue.respond(input)
        if (!usingRemoteApi()) hud.sysLog('未配置远程 LLM，使用本地台词库')
      }
      await speakReply(reply, mood)
    } finally {
      busy = false
      setMouth(0)
    }
  }

  const hud = mountHud(hudRoot, {
    onToggle(open) {
      consoleOpen = open
      document.body.classList.toggle('console-open', open)
    },
    onCommand(text) { brain(text) },
    onPark() {},
    onResize() {},
    onOpacity() {},
    onVoice() {
      if (isIOS) {
        settings.set('voice', true)
        hud.setVoiceState(true)
        return
      }
      const next = settings.get('voice') === false
      settings.set('voice', next)
      hud.setVoiceState(next)
      if (!next) stopVoicePlayback()
      hud.sysLog(next ? '角色语音已开启' : '角色语音已关闭')
    },
    onModel() { hud.sysLog('iOS 产品构建固定使用 Kurisu / Cubism2') },
    onQuickReply(text) { brain(text) },
    onTab(tab) { document.body.classList.toggle('call-mode', tab === 'call') },
    onIncoming(action) {
      if (action === 'accept') { hud.setCallState('active'); playRingTone() }
    },
    onQuit() {},
  })

  const mobileUi = isIOS ? mountMobileUi(hudRoot, {
    onSend(text) {
      if (busy) { hud.sysLog('上一条回复仍在发声，请稍候'); return }
      hud.userLog(text)
      hud.rineUser(text)
      brain(text)
    },
    onVoiceState(on) { hud.sysLog(on ? 'iOS 中文语音识别中…' : 'iOS 语音识别空闲') },
  }) : null

  hud.setVoiceState(settings.get('voice') !== false)
  hud.setLinkStatus(false, 'LINKING')

  const bootDone = new Promise((resolve) => {
    mountBoot(hudRoot, {
      onConnect: resolve,
      onCancel: () => {
        hud.setLinkStatus(false, 'DISCONNECTED')
        hud.setCallSubtitle('Disconnected.')
      },
    })
  })

  app = await createPetAppCubism2(canvas, {
    onTap: ({ hit }) => {
      lastPrimaryTapAt = performance.now()
      void playTouch({ ...hit, source: hit?.source || 'live2d' })
    },
    onLoaded: () => hud.sysLog('Kurisu / Cubism2 载入完成'),
  })
  pet = app.getManager()
  resize()
  await app.loadModel(MODEL_DIR, MODEL_FILE)
  resize()

  const unmountStageTap = mountIosStageTapFallback()
  const unmountTranscriptScroll = isIOS ? mountIosCallTranscriptScroll(hudRoot) : () => {}

  const syncViewport = () => setTimeout(resize, 60)
  window.addEventListener('resize', syncViewport)
  window.addEventListener('orientationchange', syncViewport)

  if (uiTest) setTimeout(() => document.getElementById('boot-connect')?.click(), 120)
  await bootDone
  hud.toggleConsole(true)
  hud.setTab('call')
  hud.setCallState('active')
  hud.setLinkStatus(true, 'LINK OK')
  hud.sysLog('iOS core synced with main interaction ownership + diagnostic voice path')
  hud.sysLog('语言链路：中文输入 / 中文字幕 → 日语角色语音')

  // Match main: block only until hello has STARTED. Never wait on the ended DOM
  // event to release the whole application. Player-level watchdogs still close
  // every onEnd waiter if WebKit loses the event later.
  busy = true
  presentLine('Connection established.', { log: false, rine: false })
  beginVoiceTrace('CONNECT OGG')
  voiceDiagnostic('CONFIG', 'SKIP', 'hello')
  const hello = await playReferenceVoice('hello', { onLevel: setMouth })
  busy = false
  if (!hello.played) hud.sysLog(`Connect OGG playback failed: ${hello.error?.message || 'unknown'}`)
  if (!uiTest) setTimeout(() => hud.setCallSubtitle(''), 2600)

  if (usingRemoteApi()) {
    checkServer().then((ok) => hud.sysLog(ok ? 'LLM API 已连接' : 'LLM API 配置存在，但当前连接失败'))
  }

  async function runUiTestMode() {
    if (!uiTest) return
    testState.ready = 1
    updateTestProbe()
    if (uiTestMode === 'scroll') {
      hud.setCallSubtitle('这是用于 iOS WKWebView 实机滚动回归测试的长文本。'.repeat(80))
      await wait(250)
      updateTestProbe()
    }
    if (uiTestMode === 'tts') {
      await wait(150)
      beginVoiceTrace('TTS TRANSPORT TEST')
      setTtsConfig({ endpoint: 'http://127.0.0.1:9882', enabled: true })
      voiceDiagnostic('CONFIG', 'OK', 'mock endpoint')
      voiceDiagnostic('HEALTH', 'WORK')
      const health = await checkTtsServer()
      if (!health.ok) {
        voiceDiagnostic('HEALTH', 'FAIL', health.reason || String(health.status || 'unreachable'))
        return
      }
      voiceDiagnostic('HEALTH', 'OK', `HTTP ${health.status || 200}`)
      voiceDiagnostic('TRANSLATE', 'SKIP', 'fixture Japanese')
      const generated = await synthesizeTts('接続テストです。', { language: 'ja', mood: 'normal' })
      let resolveEnd
      const ended = new Promise((resolve) => { resolveEnd = resolve })
      const result = await playAudioBlob(generated.blob, { onEnd: resolveEnd })
      if (result.played) await ended
    }
  }
  void runUiTestMode()

  window.__amaPet = { pet, app, hud, bubble, settings, mobileUi, brain, playTouch }
  window.addEventListener('beforeunload', () => {
    unmountStageTap()
    unmountTranscriptScroll()
    mobileUi?.dispose?.()
    window.removeEventListener('ama-voice-diagnostics', onDiagnostic)
    window.removeEventListener('ama-transcript-scroll', onTranscriptScroll)
    app?.dispose?.()
  })
}

boot().catch((err) => {
  console.error(err)
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ffb0b0;font:14px monospace;padding:20px;text-align:center;background:rgba(10,20,40,.96);z-index:9999'
  el.textContent = `启动失败：${err?.message || err}`
  document.body.appendChild(el)
})
