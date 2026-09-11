/* AMA-DEUS iOS renderer: preserve the mobile CALL presentation while using
   the same conversation / voice core as main. */
import './style.css'

import { createPetAppCubism2 } from './live2d/cubism2app.js'
import { mountHud } from './ui/hud.js'
import { mountBubble } from './ui/bubble.js'
import { mountBoot } from './ui/boot.js'
import { mountMobileUi } from './ui/mobile.js'
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
import { playReferenceVoice, stopVoicePlayback, unlockVoiceAudio } from './voice/player.js'

const MODEL_DIR = './models/kurisu/'
const MODEL_FILE = 'kurisu.model.json'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function boot() {
  const stage = document.getElementById('stage')
  const canvas = document.getElementById('l2d-canvas2')
  const hudRoot = document.getElementById('hud-root')
  if (!stage || !canvas || !hudRoot) throw new Error('iOS CALL surface is incomplete')

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  document.body.classList.toggle('mobile-ios', isIOS)

  const settings = createSettings()
  // The mobile product has no exposed voice-off control. A stale desktop/iOS
  // localStorage value must never silently disable all tap OGG and TTS output.
  if (isIOS && settings.get('voice') === false) settings.set('voice', true)
  applyVisualSettings(stage, canvas, settings)
  const dialogue = createDialogue()
  const bubble = mountBubble(hudRoot)

  let app = null
  let pet = null
  let consoleOpen = false
  // Conversation/TTS owns this lock. Idle character taps do not acquire it, so
  // repeated physical taps can advance the 45-clip shuffle without waiting for
  // a previous tap coroutine to finish.
  let busy = false

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
    // Resume WebAudio directly from the pointer-up gesture before any later
    // asynchronous work. The player still falls back to direct <audio> output.
    void unlockVoiceAudio()
    const reaction = nextTouchReaction(hit?.area || 'body')
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

  async function speakReply(reply, mood = 'normal') {
    const line = String(reply || '').trim()
    if (!line) return
    const reaction = planReaction(line, { mood })
    applyReaction(pet, reaction, { playMotion: true })
    hud.aiLog(line)
    hud.rineHer(line, { read: true, quick: true })

    // CALL is a readable transcript surface, not karaoke. Show the complete
    // Chinese reply as soon as the LLM returns; mobile CSS makes this box
    // vertically scrollable for long answers while Japanese speech is playing.
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
      // Keep the alpha.2 player contract: one start callback and one final end
      // callback. Long-reply chunking stays entirely inside the voice pipeline.
      onStart: () => {},
      onEnd: () => resolveEnd(),
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
      // Desktop HUD compatibility only. On the iOS CALL product the mobile
      // surface keeps role voice enabled permanently.
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
    onTap: ({ hit }) => playTouch(hit),
    onLoaded: () => hud.sysLog('Kurisu / Cubism2 载入完成'),
  })
  pet = app.getManager()
  resize()
  await app.loadModel(MODEL_DIR, MODEL_FILE)
  resize()

  const syncViewport = () => setTimeout(resize, 60)
  window.addEventListener('resize', syncViewport)
  window.addEventListener('orientationchange', syncViewport)

  await bootDone
  hud.toggleConsole(true)
  hud.setTab('call')
  hud.setCallState('active')
  hud.setLinkStatus(true, 'LINK OK')
  hud.sysLog('iOS core synced with main: LLM / OGG router / Kurisu TTS / lipsync ready')
  hud.sysLog('语言链路：中文输入 / 中文字幕 → 日语角色语音')

  busy = true
  try {
    presentLine('Connection established.', { log: false, rine: false })
    let resolveEnd
    const ended = new Promise((resolve) => { resolveEnd = resolve })
    const hello = await playReferenceVoice('hello', { onLevel: setMouth, onEnd: () => resolveEnd() })
    if (hello.played) await ended
  } finally {
    busy = false
    setMouth(0)
    hud.setCallSubtitle('')
  }

  if (usingRemoteApi()) {
    checkServer().then((ok) => hud.sysLog(ok ? 'LLM API 已连接' : 'LLM API 配置存在，但当前连接失败'))
  }

  window.__amaPet = { pet, hud, bubble, settings, mobileUi, brain }
  window.addEventListener('beforeunload', () => app?.dispose?.())
}

boot().catch((err) => {
  console.error(err)
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ffb0b0;font:14px monospace;padding:20px;text-align:center;background:rgba(10,20,40,.96);z-index:9999'
  el.textContent = `启动失败：${err?.message || err}`
  document.body.appendChild(el)
})
