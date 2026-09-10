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
const uiRoot = document.querySelector('#ui-root')

let ui = null
let connected = false
let thinking = false
let pet = null
let app = null

function setMouth(v) { app?.setMouthOpen?.(v) }
function resize() { app?.resize?.(window.innerWidth, window.innerHeight) }

async function handleTap({ hit }) {
  if (!connected || !pet || thinking) return
  const area = hit?.area || 'body'
  const reaction = nextTouchReaction(area)
  applyReaction(pet, reaction)
  ui?.setSubtitle(reaction.text, 5200)
  ui?.setStatus(`OGG · ${reaction.voice}`)
  const result = await playReferenceVoice(reaction.voice, { onLevel: setMouth })
  ui?.setStatus(result.played ? 'READY' : 'OGG PLAYBACK ERROR')
}

app = await createPetAppCubism2(canvas, { onTap: handleTap })
await app.loadModel(MODEL_DIR, MODEL_FILE)
pet = app.getManager()
resize()
window.addEventListener('resize', resize)

async function sendToKurisu(text) {
  const input = String(text || '').trim()
  if (!input || thinking) return
  thinking = true
  ui?.setStatus('THINKING · ZH')
  try {
    // Product language contract:
    // Chinese user/STT -> Chinese visible LLM reply -> Japanese speech.
    const reply = await chat(input)
    const reaction = planReaction(reply)
    applyReaction(pet, reaction)
    ui?.setSubtitle(reply, 12000)
    ui?.setStatus('VOICE ROUTING')
    const route = await routeAndSpeak(reply, {
      classify: classifyReferenceVoice,
      translateTts: translateForKurisuTts,
      mood: reaction.emotion,
      onLevel: setMouth,
    })
    if (route.kind === 'ogg') ui?.setStatus(`OGG · ${route.id}`)
    else if (route.kind === 'tts' && route.played) ui?.setStatus('KURISU TTS · JA')
    else if (route.kind === 'text') ui?.setStatus('TEXT ONLY')
    setTimeout(() => ui?.setStatus('READY'), 1800)
  } catch (error) {
    ui?.setSubtitle(`连接失败：${error?.message || error}`, 6500)
    ui?.setStatus('LLM ERROR')
  } finally {
    thinking = false
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
  const hello = await playReferenceVoice('hello', { onLevel: setMouth })
  if (!hello.played) ui.setStatus('READY · AUDIO LOCKED')
}

mountBoot(uiRoot, {
  onConnect: connect,
  onCancel: () => { uiRoot.innerHTML = '<div class="ama-disconnected">DISCONNECTED</div>' },
})

window.addEventListener('beforeunload', () => app?.dispose?.())
