import './style.css'
import { createPetAppCubism2 } from './live2d/cubism2app.js'
import { mountBoot } from './ui/boot.js'
import { mountAmadeusUi } from './ui/amadeus.js'
import { chat, classifyReferenceVoice, translateForKurisuTts } from './llm/client.js'
import { planReaction, applyReaction } from './pet/reaction.js'
import { nextTouchReaction } from './pet/touch-reactions.js'
import { playReferenceVoice } from './voice/player.js'
import { routeAndSpeak } from './voice/pipeline.js'
import { nativeSpeechAvailablePlatform, recognizeOnce } from './platform/speech.js'

const MODEL_DIR = './models/kurisu/'
const MODEL_FILE = 'kurisu.model.json'
const canvas = document.querySelector('#l2d-canvas')
const stage = document.querySelector('#stage')
const phone = document.querySelector('#phone')
const uiRoot = document.querySelector('#ui-root')

let ui = null
let connected = false
/* True from the moment a line is sent until its voice has finished playing.
   The window is single-voice: a touch reaction firing mid-flight would call
   stopVoicePlayback() and cut the reply off, so taps are ignored while busy. */
let busy = false
let pet = null
let app = null

function setMouth(v) { app?.setMouthOpen?.(v) }
function resize() {
  const rect = stage.getBoundingClientRect()
  app?.resize?.(Math.round(rect.width), Math.round(rect.height))
}

/* The forehead of the handset is the window's grab handle. The screen is never
   a handle, so a grab that lands on the character stays a tap instead of
   starting a drag; and the outermost ring is left to the OS resize border,
   because starting a custom drag inside it makes the window manager and the
   drag fight over the geometry. */
const SHELL_RESIZE_MARGIN = 10
function mountShellDrag() {
  const ipc = window.amadeus
  if (!ipc?.dragStart) return
  let dragging = false

  phone.addEventListener('pointerdown', (e) => {
    const r = phone.getBoundingClientRect()
    const inResizeBorder =
      e.clientX - r.left < SHELL_RESIZE_MARGIN ||
      r.right - e.clientX < SHELL_RESIZE_MARGIN ||
      e.clientY - r.top < SHELL_RESIZE_MARGIN ||
      r.bottom - e.clientY < SHELL_RESIZE_MARGIN
    if (inResizeBorder) return

    const onHandle = !!e.target.closest?.('.phone-top') || e.target === phone
    if (!onHandle) return

    dragging = true
    phone.classList.add('dragging')
    ipc.dragStart()
    try { phone.setPointerCapture?.(e.pointerId) } catch {}
  })
  phone.addEventListener('pointermove', () => { if (dragging) ipc.dragMove() })
  const endDrag = () => {
    if (!dragging) return
    dragging = false
    phone.classList.remove('dragging')
    ipc.dragEnd()
  }
  phone.addEventListener('pointerup', endDrag)
  phone.addEventListener('pointercancel', endDrag)
}

async function handleTap({ hit }) {
  if (!connected || !pet || busy) return
  const area = hit?.area || 'body'
  const reaction = nextTouchReaction(area)
  applyReaction(pet, reaction)
  ui?.setSubtitle(reaction.text, 5200)
  // Deliberately no "OGG · <id>" here: the clip id is an internal identifier and
  // the user just touched the character, so they do not need to be told which
  // file answered them.
  const result = await playReferenceVoice(reaction.voice, { onLevel: setMouth })
  ui?.setStatus(result.played ? 'READY' : 'OGG PLAYBACK ERROR')
}

/* Only used when nothing is spoken (TTS unavailable/failed), so the line still
   stays up long enough to read. Real audio is timed by its own start/end. */
function subtitleMsFor(text) {
  return Math.max(2200, Math.min(14000, String(text || '').length * 240))
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app = await createPetAppCubism2(canvas, { onTap: handleTap })
await app.loadModel(MODEL_DIR, MODEL_FILE)
pet = app.getManager()
resize()
window.addEventListener('resize', resize)
// The stage is inset inside the phone shell, so it also changes when the shell
// does (window resize, DPI change) without the window event necessarily firing.
new ResizeObserver(resize).observe(stage)
mountShellDrag()
document.querySelector('[data-window="quit"]')?.addEventListener('click', () => window.amadeus?.quit?.())

async function sendToKurisu(text) {
  const input = String(text || '').trim()
  if (!input || busy) return
  busy = true
  // Dots hold the subtitle slot while the LLM thinks and the voice is rendered,
  // so the line never shows seconds before the audio it belongs to.
  ui?.setThinking(true)
  ui?.setStatus('THINKING · ZH')
  try {
    // Product language contract:
    // Chinese user/STT -> Chinese visible LLM reply -> Japanese speech.
    const reply = await chat(input)
    const reaction = planReaction(reply)
    applyReaction(pet, reaction)

    ui?.setStatus('VOICE ROUTING')
    let resolveVoice
    const voiceFinished = new Promise((resolve) => { resolveVoice = resolve })

    const route = await routeAndSpeak(reply, {
      classify: classifyReferenceVoice,
      translateTts: translateForKurisuTts,
      mood: reaction.emotion,
      onLevel: setMouth,
      // Fires when playback actually begins, not when the blob is ready.
      onStart: () => { ui?.setThinking(false); ui?.setSubtitle(reply, 0) },
      onEnd: () => resolveVoice(),
    })

    // Report the voice PATH, not the catalog id: "OGG" vs "KURISU TTS · JA" is
    // what tells the user whose voice they just heard.
    if (route.kind === 'ogg') ui?.setStatus('OGG')
    else if (route.kind === 'tts' && route.played) ui?.setStatus('KURISU TTS · JA')
    else if (route.kind === 'text') ui?.setStatus('TEXT ONLY')

    if (route.played) {
      ui?.setSubtitle(reply, 0)   // in case onStart raced an instant failure
      await voiceFinished
      await wait(350)             // beat before the line drops, not a hard cut
    } else {
      ui?.setThinking(false)
      ui?.setSubtitle(reply, subtitleMsFor(reply))
      await wait(subtitleMsFor(reply))
    }
    ui?.setSubtitle('', 0)
    setTimeout(() => ui?.setStatus('READY'), 1200)
  } catch (error) {
    ui?.setThinking(false)
    ui?.setSubtitle(`连接失败：${error?.message || error}`, 6500)
    ui?.setStatus('LLM ERROR')
  } finally {
    ui?.setThinking(false)
    busy = false
    setMouth(0)
  }
}

async function connect() {
  if (connected) return
  connected = true
  document.body.classList.add('connected')
  ui = mountAmadeusUi(uiRoot, {
    onSend: sendToKurisu,
    // User speech recognition remains Chinese even though TTS output is Japanese.
    onRecognize: nativeSpeechAvailablePlatform() ? () => recognizeOnce({ language: 'zh-CN' }) : null,
  })
  ui.setStatus('READY')
  ui.setSubtitle('Connection established.', 2600)
  busy = true
  const hello = await playReferenceVoice('hello', { onLevel: setMouth })
  busy = false
  if (!hello.played) ui.setStatus('READY · AUDIO LOCKED')
}

mountBoot(uiRoot, {
  onConnect: connect,
  onCancel: () => { uiRoot.innerHTML = '<div class="ama-disconnected">DISCONNECTED</div>' },
})

window.addEventListener('beforeunload', () => app?.dispose?.())
