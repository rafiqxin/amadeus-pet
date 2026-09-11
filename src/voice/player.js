import { getVoiceAudioUrl, getVoiceCatalogEntry } from './catalog.js'

let activeAudio = null
let activeObjectUrl = ''
let audioCtx = null
let analyserFrame = null
let analyser = null
let activeLevelCallback = null

function releaseObjectUrl() {
  if (!activeObjectUrl) return
  try { URL.revokeObjectURL(activeObjectUrl) } catch {}
  activeObjectUrl = ''
}

function stopAnalyser(onLevel = activeLevelCallback) {
  if (analyserFrame) cancelAnimationFrame(analyserFrame)
  analyserFrame = null
  analyser = null
  activeLevelCallback = null
  onLevel?.(0)
}

/**
 * Prime/resume WebAudio while we are still inside a real user gesture.
 *
 * iOS can leave an AudioContext suspended even though HTMLMediaElement playback
 * itself is allowed.  If a media element is connected to a suspended WebAudio
 * graph it becomes effectively silent, so callers should try to unlock early.
 * Failure is deliberately non-fatal: direct <audio> playback is our audible
 * fallback and lipsync is sacrificed for that utterance rather than the voice.
 */
export async function unlockVoiceAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return false
  try {
    audioCtx ||= new AudioContextCtor()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    if (audioCtx.state !== 'running') return false

    // A one-sample silent source keeps this function useful when called from a
    // touch/click gesture before the later asynchronous LLM/TTS work begins.
    const buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate || 44100)
    const source = audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(audioCtx.destination)
    source.start(0)
    return true
  } catch {
    return false
  }
}

async function monitor(audio, onLevel) {
  if (!onLevel) return false
  try {
    const running = await unlockVoiceAudio()
    if (!running || !audioCtx || audioCtx.state !== 'running') {
      // Critical iOS fallback: do NOT call createMediaElementSource when the
      // AudioContext is suspended.  Keeping the element outside the graph lets
      // WKWebView play it through the normal device audio path.
      onLevel(0)
      return false
    }

    const source = audioCtx.createMediaElementSource(audio)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyser.connect(audioCtx.destination)
    activeLevelCallback = onLevel

    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      if (!analyser) { onLevel(0); return }
      if (audio.ended) { stopAnalyser(onLevel); return }
      if (audio.paused) { analyserFrame = requestAnimationFrame(tick); return }
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const x of data) {
        const v = (x - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      onLevel(Math.max(0, Math.min(1, (rms - 0.012) * 5.5)))
      analyserFrame = requestAnimationFrame(tick)
    }
    tick()
    return true
  } catch {
    // If WebAudio setup fails after an iOS route/category change, leave the
    // media element un-routed so the user still hears the character.
    analyser = null
    activeLevelCallback = null
    onLevel(0)
    return false
  }
}

export function stopVoicePlayback() {
  try { activeAudio?.pause() } catch {}
  try { window.speechSynthesis?.cancel() } catch {}
  stopAnalyser()
  activeAudio = null
  releaseObjectUrl()
}

export async function playAudioUrl(url, {
  volume = 0.96,
  onLevel = null,
  onStart = null,
  onEnd = null,
  objectUrl = false,
} = {}) {
  stopVoicePlayback()
  if (!url) {
    onLevel?.(0)
    onEnd?.()
    return { played: false }
  }

  const audio = new Audio(url)
  activeAudio = audio
  if (objectUrl) activeObjectUrl = url
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.preload = 'auto'
  audio.playsInline = true

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    stopAnalyser(onLevel)
    if (activeAudio === audio) activeAudio = null
    if (objectUrl && activeObjectUrl === url) releaseObjectUrl()
    onEnd?.()
  }
  audio.onended = finish
  audio.onerror = finish

  // Await WebAudio setup before play().  Most importantly, monitor() leaves
  // the element completely outside a suspended graph on iOS.
  const lipsyncActive = await monitor(audio, onLevel)
  try {
    await audio.play()
    onStart?.()
    return { played: true, audio, lipsyncActive }
  } catch (error) {
    finish()
    return { played: false, error, lipsyncActive: false }
  }
}

export async function playReferenceVoice(id, opts = {}) {
  const entry = getVoiceCatalogEntry(id)
  if (!entry) {
    opts.onLevel?.(0)
    opts.onEnd?.()
    return { played: false, entry: null }
  }
  const result = await playAudioUrl(getVoiceAudioUrl(id), opts)
  return { ...result, entry }
}

export async function playAudioBlob(blob, opts = {}) {
  if (!(blob instanceof Blob) || !blob.size) {
    opts.onLevel?.(0)
    opts.onEnd?.()
    return { played: false, error: new Error('empty TTS audio') }
  }
  return playAudioUrl(URL.createObjectURL(blob), { ...opts, objectUrl: true })
}
