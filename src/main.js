/* AMA·DEUS renderer entry. */
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
import { speak, voiceAvailable, matchReferenceVoice } from './pet/voice.js'
import { planReaction, applyReaction } from './pet/reaction.js'
import { playRingTone } from './pet/tone.js'
import { chat, checkServer, llmAvailable } from './pet/llm.js'
import { remember, recall } from './pet/memory.js'
import { mountMobileUi } from './ui/mobile.js'

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

  let pet = null
  let app5 = null
  let app2 = null
  let modelIndex = 0
  let firstLoad = false

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  document.body.classList.toggle('mobile-ios', isIOS)

  function viewportSize() {
    if (isIOS) {
      const r = stage.getBoundingClientRect()
      return {
        w: Math.max(1, Math.round(r.width || window.innerWidth || 393)),
        h: Math.max(1, Math.round(r.height || window.innerHeight || 852)),
      }
    }
    return { w: 480, h: 853 }
  }

  const bubble = mountBubble(hudRoot)
  const dialogue = createDialogue()
  let bootScreen = null
  const bootDone = new Promise((resolve) => {
    bootScreen = mountBoot(hudRoot, {
      onConnect: () => { playRingTone(); resolve() },
      onCancel: () => ipc?.quit(),
    })
  })

  let currentTab = 'term'
  let consoleOpen = false

  const sayLine = (line, duration, reactionHint = {}) => {
    if (!line) return
    if (!consoleOpen) bubble.say(line, duration)
    hud.aiLog(line)
    hud.setCallSubtitle(line)
    hud.rineHer(line, { read: true, quick: true })

    // LLM output is the semantic source. If it resembles one of the 45
    // reference reactions, that line's original mood and OGG take priority.
    const voiceMatch = matchReferenceVoice(line)
    const reaction = planReaction(line, { ...reactionHint, voiceMatch })
    applyReaction(pet, reaction, { playMotion: true })

    const voiceOn = settings.get('voice') !== false && voiceAvailable()
    const res = speak(line, {
      enabled: voiceOn,
      onLevel: (level) => pet?.setMouthOpen(level),
      onEnd: () => pet?.setMouthOpen(0),
    })
    // Never fake mouth motion for text-only replies. Lip motion now comes
    // exclusively from the actual OGG waveform (or native TTS in the future).
    if (!res.played) pet?.setMouthOpen(0)

    window.__amaLastReaction = { ...reaction, voicePlayed: !!res.played, voiceScore: voiceMatch?.score || 0 }
  }

  let brainSeq = 0
  let brainAbort = null
  async function brain(text) {
    remember(text)
    if (llmAvailable()) {
      const mySeq = ++brainSeq
      if (brainAbort) brainAbort.abort()
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
        if (mySeq !== brainSeq) return
        if (!consoleOpen) bubble.say(delta || '……', 60000)
      })
      if (mySeq !== brainSeq) return
      if (reply) { sayLine(reply, undefined, { mood: ctx.mood }); return }
    }
    hud.sysLog('LLM 内核离线，临时使用本地台词库')
    sayLine(dialogue.respond(text))
  }

  let modelTapHandled = false
  const petHooks = {
    onLoaded: async () => {
      hud.sysLog(`记忆数据同步完成（${MODELS[modelIndex].name}）`)
      hud.setLinkStatus(true)
      { const v = viewportSize(); pet?.resize(v.w, v.h) }
      if (firstLoad) return
      firstLoad = true
      await bootDone
      sayLine(dialogue.amadeusAware(), 3600)
      if (settings.get('idleChat')) {
        dialogue.startIdle((line) => {
          if (Math.random() < 0.05) {
            hud.dRine(dialogue.dRineLine())
            hud.sysLog('收到 D-Rine 消息')
          } else sayLine(line)
        })
      }
    },
    onTap({ hit }) {
      if (!hit) return
      modelTapHandled = true
      if (hit.area === 'head' || hit.area === 'mouth') hit.model.setRandomExpression()
      else hit.model.startRandomMotion(Define.MotionGroupTapBody, Define.PriorityNormal)
      sayLine(dialogue.clickLine())
    },
  }

  async function getApp(format) {
    if (format === 'cubism2') {
      canvas2.style.display = 'block'; canvas5.style.display = 'none'
      if (!app2) app2 = await createPetAppCubism2(canvas2, petHooks)
      return app2
    }
    canvas5.style.display = 'block'; canvas2.style.display = 'none'
    if (!app5) app5 = await createPetApp(canvas5, petHooks)
    return app5
  }

  async function switchModel() {
    modelIndex = (modelIndex + 1) % MODELS.length
    const m = MODELS[modelIndex]
    hud.sysLog(`切换记忆数据：${m.name}`)
    pet = await getApp(m.format)
    { const v = viewportSize(); pet.resize(v.w, v.h) }
    pet.loadModel(m.dir, m.json)
  }

  const hud = mountHud(hudRoot, {
    onToggle(open) {
      consoleOpen = open
      interactions.setConsoleOpen(open)
      document.body.classList.toggle('console-open', open)
    },
    onCommand(text) { brain(text) },
    onPark() { ipc?.snapBottom(); sayLine(dialogue.parkLine()) },
    onResize(dir) {
      const s = Math.min(1.5, Math.max(0.6, (settings.get('scale') || 1) + dir * 0.05))
      settings.set('scale', s); interactions.setHitScale(s); hud.sysLog(`显示倍率 ${s.toFixed(2)}`)
    },
    onOpacity(dir) {
      const o = Math.min(1, Math.max(0.2, (settings.get('opacity') ?? 1) + dir * 0.1))
      settings.set('opacity', o); hud.sysLog(`不透明度 ${Math.round(o * 100)}%`)
    },
    onVoice() {
      const next = settings.get('voice') === false
      settings.set('voice', next)
      hud.setVoiceState(next)
      hud.sysLog(next ? '原版语音反应已开启' : '语音输出已关闭')
    },
    onModel() { switchModel() },
    onQuickReply(text) { brain(text) },
    onTab(tab) { currentTab = tab; document.body.classList.toggle('call-mode', tab === 'call') },
    onIncoming(action) {
      if (action === 'accept') { hud.setCallState('active'); sayLine(dialogue.amadeusAware()) }
    },
    onQuit() { ipc?.quit() },
  })

  const mobileUi = isIOS ? mountMobileUi(hudRoot, {
    onSend(text) { hud.userLog(text); hud.rineUser(text); brain(text) },
    onVoiceState() { hud.sysLog('iOS 语音输入已停用；将在 Android 版本接入') },
  }) : null

  hud.setVoiceState(settings.get('voice') !== false && voiceAvailable())

  const interactions = mountInteractions(stage, {
    onClick() {
      if (modelTapHandled) { modelTapHandled = false; return }
      sayLine(dialogue.clickLine())
    },
    onDragStart() {
      modelTapHandled = false
      if (!consoleOpen) bubble.say(dialogue.dragLine(), 2600)
    },
    onDoubleClick() { ipc?.snapBottom(); hud.sysLog('双击：已停靠屏幕底部') },
  })

  {
    const consoleEl = hud.el.querySelector('.hud-console')
    let cDrag = false, cLastX = 0, cLastY = 0
    const cSkip = (e) => e.target.closest('button, input, textarea, a, select, .hud-log, .rine-log, .diary-log, .hud-tabs, .hud-header, .hud-footer')
    consoleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || cSkip(e)) return
      cDrag = true; cLastX = e.screenX; cLastY = e.screenY; ipc?.dragStart()
    })
    consoleEl.addEventListener('pointermove', (e) => {
      if (!cDrag) return
      if (e.screenX !== cLastX || e.screenY !== cLastY) ipc?.dragMove()
      cLastX = e.screenX; cLastY = e.screenY
    })
    const cEnd = () => { if (!cDrag) return; cDrag = false; ipc?.dragEnd() }
    consoleEl.addEventListener('pointerup', cEnd)
    consoleEl.addEventListener('pointercancel', cEnd)
  }

  const chatForm = document.getElementById('chat-form')
  const chatInput = document.getElementById('chat-input')
  function sendChat(text) {
    chatInput.value = ''; hud.userLog(text); hud.rineUser(text); brain(text)
  }
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); const text = chatInput.value.trim(); if (text) sendChat(text)
  })
  chatForm.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); ipc?.focus(); chatInput.focus()
  })
  window.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('console-open')) return
    const t = e.target
    if (t === chatInput || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      chatInput.focus(); chatInput.value += e.key; e.preventDefault()
    } else if (e.key === 'Enter') {
      const text = chatInput.value.trim(); if (text) sendChat(text); e.preventDefault()
    } else if (e.key === 'Backspace') {
      chatInput.focus(); chatInput.value = chatInput.value.slice(0, -1); e.preventDefault()
    }
  })

  hud.sysLog('AMA·DEUS 启动中…')
  hud.sysLog('正在建立记忆数据链路…')
  hud.sysLog(isIOS ? 'iOS：仅匹配原版语音反应；未命中时保持纯文字' : '语音模块初始化完成')

  pet = await getApp(MODELS[modelIndex].format)
  { const v = viewportSize(); pet.resize(v.w, v.h) }
  pet.loadModel(MODELS[modelIndex].dir, MODELS[modelIndex].json)

  if (isIOS) {
    let resizeTimer = null
    const syncViewport = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { const v = viewportSize(); pet?.resize(v.w, v.h) }, 80)
    }
    window.addEventListener('resize', syncViewport)
    window.addEventListener('orientationchange', syncViewport)
  }

  window.__amaPet = { pet, hud, bubble, settings, mobileUi }

  if (location.hash === '#call') setTimeout(() => { hud.toggleConsole(true); hud.setTab('call') }, 3500)
  else if (location.hash === '#rine') setTimeout(() => { hud.toggleConsole(true); hud.setTab('rine') }, 3500)
  else if (location.hash === '#diary') setTimeout(() => { hud.toggleConsole(true); hud.setTab('diary') }, 3500)
  else if (location.hash === '#m1') setTimeout(() => switchModel(), 4000)

  function scheduleProactive() {
    setTimeout(() => {
      if (settings.get('idleChat') && !consoleOpen) sayLine(dialogue.proactiveLine())
      scheduleProactive()
    }, 10 * 60000 + Math.random() * 10 * 60000)
  }
  scheduleProactive()

  function scheduleIncoming() {
    setTimeout(() => { hud.incomingCall(); playRingTone(); scheduleIncoming() }, 20 * 60000 + Math.random() * 20 * 60000)
  }
  scheduleIncoming()

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
