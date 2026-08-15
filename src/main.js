/* AMA·DEUS desktop pet — renderer entry.
   Boot sequence → Live2D pipeline (Cubism 5 native / Cubism 2 via PIXI)
   + HUD (terminal/call views) + bubble + dialogue + lip-sync +
   window interactions + settings + optional voice. */
import './style.css'

import { createPetApp } from './live2d/app.js'
import { createPetAppCubism2 } from './live2d/cubism2app.js'
import * as Define from './live2d/define.js'
import { mountHud } from './ui/hud.js'
import { mountBubble } from './ui/bubble.js'
import { mountBoot } from './ui/boot.js'
import { mountInteractions } from './pet/interactions.js'
import { createDialogue } from './pet/dialogue.js'
import { createSettings, applyVisualSettings } from './pet/settings.js'
import { speak, voiceAvailable } from './pet/voice.js'
import { playRingTone } from './pet/tone.js'
import { chat, checkServer, llmAvailable } from './pet/llm.js'
import { remember, recall } from './pet/memory.js'

const MODELS = [
  { dir: './models/kurisu/', json: 'kurisu.model.json', name: 'KURISU // 助手', format: 'cubism2' },
  { dir: './models/Haru/', json: 'Haru.model3.json', name: 'HARU // 助手·A型', format: 'cubism5' },
  { dir: './models/Mao/', json: 'Mao.model3.json', name: 'MAO // 观测型', format: 'cubism5' },
  { dir: './models/Wanko/', json: 'Wanko.model3.json', name: 'WANKO // 吉祥物', format: 'cubism5' },
]

async function boot() {
  const stage = document.getElementById('stage')
  const canvas5 = document.getElementById('l2d-canvas')
  const canvas2 = document.getElementById('l2d-canvas2')
  const hudRoot = document.getElementById('hud-root')
  const ipc = window.amadeus

  const settings = createSettings()
  applyVisualSettings(stage, canvas5, settings)
  applyVisualSettings(stage, canvas2, settings)

  let pet = null           // active app instance (either format)
  let app5 = null          // lazy Cubism 5 app
  let app2 = null          // lazy Cubism 2 app
  let modelIndex = 0
  let firstLoad = false

  // Fixed phone-ratio window (480×853). The canvas backing follows it once
  // per model load — no user resizing, no frame resize module.
  const WIN_W = 480
  const WIN_H = 853

  const bubble = mountBubble(hudRoot)
  const dialogue = createDialogue()
  let bootScreen = null
  const bootDone = new Promise((resolve) => {
    bootScreen = mountBoot(hudRoot, {
      onConnect: () => {
        playRingTone()
        resolve()
      },
      onCancel: () => ipc?.quit(),
    })
  })

  /* ---- lip-sync driver -------------------------------------- */
  // Research-recommended fallback: duration envelope × (5Hz sine base +
  // random pulses), with word-boundary bursts overriding when available.
  let flapTimer = null
  let burstUntil = 0
  function startFlap(durationMs, burst) {
    stopFlap()
    pet?.setMouthOpen(0.2)
    const t0 = Date.now()
    const total = Math.min(durationMs, 9000)
    const burstFn = burst || (() => { burstUntil = Date.now() + 180 })
    flapTimer = setInterval(() => {
      const t = Date.now() - t0
      const p = Math.min(1, t / total)
      const env = Math.min(1, p * 8, (1 - p) * 8) // head/tail envelope
      const wave = 0.5 + 0.5 * Math.sin((t / 1000) * Math.PI * 2 * 5)
      const base = env * Math.min(1, 0.35 * wave + 0.65 * Math.random())
      const burstVal = Date.now() < burstUntil ? 0.75 : 0
      pet?.setMouthOpen(Math.max(base, burstVal) * 0.9)
    }, 60)
    setTimeout(stopFlap, total + 150)
  }
  function stopFlap() {
    if (flapTimer) { clearInterval(flapTimer); flapTimer = null }
    burstUntil = 0
    pet?.setMouthOpen(0)
  }

  // Unified output: bubble + console log + call subtitle + RINE + TTS + lip-sync.
  let currentTab = 'term'
  let consoleOpen = false // bubble lives ONLY while the console is hidden
  const sayLine = (line, duration) => {
    // 控制台隐藏 → 头顶气泡；控制台显示 → 气泡禁用（CALL 字幕条 / COMM.LOG 承担）
    if (!consoleOpen) bubble.say(line, duration)
    hud.aiLog(line)
    hud.setCallSubtitle(line)
    hud.rineHer(line, { read: true, quick: true })
    const voiceOn = settings.get('voice') !== false && voiceAvailable()
    const burst = () => pet?.setMouthOpen(0.25 + Math.random() * 0.6)
    const res = speak(line, {
      enabled: voiceOn,
      onBoundary: burst,
      onEnd: () => pet?.setMouthOpen(0.05),
    })
    if (voiceOn || !voiceAvailable()) {
      startFlap(res.duration, burst)
    }
  }

  // Brain: the local LLM is the ONLY dialogue generator while it is alive.
  // The dialogue bank / persona materials are injected BEFORE generation as
  // prompt reference (styleRef + mood), never popped out as template replies.
  // Template lines survive solely as an offline fallback when the LLM dies.
  // New messages supersede older in-flight requests (abort + stale-stream guard).
  let brainSeq = 0
  let brainAbort = null
  async function brain(text) {
    remember(text)
    if (llmAvailable()) {
      const mySeq = ++brainSeq
      if (brainAbort) brainAbort.abort() // supersede any in-flight request
      brainAbort = new AbortController()
      const ctx = dialogue.bankHints(text)
      const mems = recall(text)
      if (!consoleOpen) bubble.say('……', 60000)
      else hud.setCallSubtitle('……')
      const reply = await chat(text, {
        memories: mems,
        styleRef: ctx.hints,
        mood: ctx.mood,
        signal: brainAbort.signal,
      }, (delta) => {
        if (mySeq !== brainSeq) return // a newer message owns the stage
        if (!consoleOpen) bubble.say(delta || '……', 60000)
      })
      if (mySeq !== brainSeq) return // superseded: drop silently
      if (reply) { sayLine(reply); return }
    }
    hud.sysLog('LLM 内核离线，临时使用本地台词库')
    sayLine(dialogue.respond(text))
  }

  /* ---- per-format app management ---------------------------- */
  // A press-release on the model fires BOTH the app's onTap and the
  // interaction layer's onClick on the same pointerup. This flag makes
  // them exclusive: one physical click = exactly one poke reaction.
  let modelTapHandled = false
  const petHooks = {
    onLoaded: async () => {
      hud.sysLog(`记忆数据同步完成（${MODELS[modelIndex].name}）`)
      hud.setLinkStatus(true)
      // keep the canvas backing store in step with the fixed window
      pet?.resize(WIN_W, WIN_H)
      if (firstLoad) return
      firstLoad = true
      await bootDone
      sayLine(dialogue.amadeusAware(), 3600)
      if (settings.get('idleChat')) {
        dialogue.startIdle((line) => {
          if (Math.random() < 0.05) {
            hud.dRine(dialogue.dRineLine())
            hud.sysLog('收到 D-Rine 消息')
          } else {
            sayLine(line)
          }
        })
      }
    },
    onTap({ hit }) {
      if (!hit) return
      modelTapHandled = true
      if (hit.area === 'head' || hit.area === 'mouth') {
        hit.model.setRandomExpression()
      } else {
        hit.model.startRandomMotion(Define.MotionGroupTapBody, Define.PriorityNormal)
      }
      sayLine(dialogue.clickLine())
    },
  }

  async function getApp(format) {
    if (format === 'cubism2') {
      canvas2.style.display = 'block'
      canvas5.style.display = 'none'
      if (!app2) app2 = await createPetAppCubism2(canvas2, petHooks)
      return app2
    }
    canvas5.style.display = 'block'
    canvas2.style.display = 'none'
    if (!app5) app5 = await createPetApp(canvas5, petHooks)
    return app5
  }

  async function switchModel() {
    modelIndex = (modelIndex + 1) % MODELS.length
    const m = MODELS[modelIndex]
    hud.sysLog(`切换记忆数据：${m.name}`)
    pet = await getApp(m.format)
    pet.resize(WIN_W, WIN_H)
    pet.loadModel(m.dir, m.json)
  }

  const hud = mountHud(hudRoot, {
    onToggle(open) {
      consoleOpen = open
      interactions.setConsoleOpen(open)
      document.body.classList.toggle('console-open', open)
    },
    onCommand(text) {
      brain(text)
    },
    onPark() {
      ipc?.snapBottom()
      sayLine(dialogue.parkLine())
    },
    onResize(dir) {
      const s = Math.min(1.5, Math.max(0.6, (settings.get('scale') || 1) + dir * 0.05))
      settings.set('scale', s)
      interactions.setHitScale(s)
      hud.sysLog(`显示倍率 ${s.toFixed(2)}`)
    },
    onOpacity(dir) {
      const o = Math.min(1, Math.max(0.2, (settings.get('opacity') ?? 1) + dir * 0.1))
      settings.set('opacity', o)
      hud.sysLog(`不透明度 ${Math.round(o * 100)}%`)
    },
    onVoice() {
      const next = settings.get('voice') === false
      settings.set('voice', next)
      hud.setVoiceState(next)
      hud.sysLog(next ? '语音输出已开启' : '语音输出已关闭')
    },
    onModel() {
      switchModel()
    },
    onQuickReply(text) {
      brain(text)
    },
    onTab(tab) {
      currentTab = tab
      document.body.classList.toggle('call-mode', tab === 'call')
    },
    onIncoming(action) {
      if (action === 'accept') {
        hud.setCallState('active')
        sayLine(dialogue.amadeusAware())
      }
    },
    onQuit() {
      ipc?.quit()
    },
  })

  hud.setVoiceState(settings.get('voice') !== false && voiceAvailable())

  const interactions = mountInteractions(stage, {
    onClick() {
      // the model tap already reacted on this same click → don't double-fire
      if (modelTapHandled) { modelTapHandled = false; return }
      sayLine(dialogue.clickLine())
    },
    onDragStart() {
      modelTapHandled = false // fresh press: re-arm the one-shot guard
      if (!consoleOpen) bubble.say(dialogue.dragLine(), 2600)
    },
    onDoubleClick() {
      ipc?.snapBottom()
      hud.sysLog('双击：已停靠屏幕底部')
    },
  })

  /* ---- console open → the SAME original drag on the frame ----
     Per-event screen deltas, applied immediately — identical to the model
     drag. Interactive controls (buttons/inputs/logs/header/footer) are
     excluded so they keep working normally. */
  {
    const consoleEl = hud.el.querySelector('.hud-console')
    let cDrag = false
    let cLastX = 0
    let cLastY = 0
    const cSkip = (e) => e.target.closest(
      'button, input, textarea, a, select, .hud-log, .rine-log, .diary-log, .hud-tabs, .hud-header, .hud-footer'
    )
    consoleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || cSkip(e)) return
      cDrag = true
      cLastX = e.screenX
      cLastY = e.screenY
    })
    consoleEl.addEventListener('pointermove', (e) => {
      if (!cDrag) return
      const dx = e.screenX - cLastX
      const dy = e.screenY - cLastY
      if (dx !== 0 || dy !== 0) ipc?.dragMove(dx, dy)
      cLastX = e.screenX
      cLastY = e.screenY
    })
    const cEnd = () => { cDrag = false }
    consoleEl.addEventListener('pointerup', cEnd)
    consoleEl.addEventListener('pointercancel', cEnd)
  }

  /* ---- direct chat bar under the character ------------------ */
  const chatForm = document.getElementById('chat-form')
  const chatInput = document.getElementById('chat-input')

  function sendChat(text) {
    chatInput.value = ''
    hud.userLog(text)
    hud.rineUser(text)
    brain(text)
  }
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = chatInput.value.trim()
    if (text) sendChat(text)
  })
  // don't start window-drag from the bar; grab OS focus for typing
  chatForm.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    ipc?.focus()
    chatInput.focus()
  })
  // keystrokes anywhere on the pet (console closed) go to the chat bar
  window.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('console-open')) return
    const t = e.target
    if (t === chatInput) return
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      chatInput.focus()
      chatInput.value += e.key
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const text = chatInput.value.trim()
      if (text) sendChat(text)
      e.preventDefault()
    } else if (e.key === 'Backspace') {
      chatInput.focus()
      chatInput.value = chatInput.value.slice(0, -1)
      e.preventDefault()
    }
  })

  /* ---- Live2D pet ------------------------------------------- */
  hud.sysLog('AMA·DEUS 启动中…')
  hud.sysLog('正在建立记忆数据链路…')
  if (!voiceAvailable()) {
    hud.sysLog('语音模块不可用（系统无可用语音），已切换纯文字模式')
  }

  pet = await getApp(MODELS[modelIndex].format)
  pet.loadModel(MODELS[modelIndex].dir, MODELS[modelIndex].json)
  window.__amaPet = { pet, hud, bubble, settings }

  // Test/demo hooks via URL hash.
  if (location.hash === '#call') {
    setTimeout(() => { hud.toggleConsole(true); hud.setTab('call') }, 3500)
  } else if (location.hash === '#rine') {
    setTimeout(() => { hud.toggleConsole(true); hud.setTab('rine') }, 3500)
  } else if (location.hash === '#diary') {
    setTimeout(() => { hud.toggleConsole(true); hud.setTab('diary') }, 3500)
  } else if (location.hash === '#m1') {
    setTimeout(() => switchModel(), 4000)
  }

  // Proactive chat: she starts conversations on her own (time-aware).
  function scheduleProactive() {
    setTimeout(() => {
      if (settings.get('idleChat') && !consoleOpenNow()) {
        sayLine(dialogue.proactiveLine())
      }
      scheduleProactive()
    }, 10 * 60000 + Math.random() * 10 * 60000)
  }
  function consoleOpenNow() {
    return consoleOpen
  }
  scheduleProactive()

  // Occasional incoming calls (Amadeus rings you), every 20–40 min.
  function scheduleIncoming() {
    setTimeout(() => {
      hud.incomingCall()
      playRingTone()
      scheduleIncoming()
    }, 20 * 60000 + Math.random() * 20 * 60000)
  }
  scheduleIncoming()

  // Local LLM core detection loop (llama.cpp server on 127.0.0.1:8090).
  async function llmWatch() {
    const ok = await checkServer()
    const was = window.__llmState
    if (ok !== was) {
      window.__llmState = ok
      hud.sysLog(ok ? 'LLM 内核已连接（灵魂注入完成）' : 'LLM 内核离线，使用本地台词库')
    }
    setTimeout(llmWatch, 30000)
  }
  llmWatch()
}

boot().catch((err) => {
  console.error(err)
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ffb0b0;font:14px monospace;padding:20px;text-align:center;background:rgba(10,20,40,.9)'
  el.textContent = `启动失败：${err.message}`
  document.body.appendChild(el)
})
