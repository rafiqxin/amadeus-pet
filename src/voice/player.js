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

/** Prime WebAudio while a real user gesture is still active. */
export async function unlockVoiceAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return false
  try {
    audioCtx ||= new AudioContextCtor()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    if (audioCtx.state !== 'running') return false

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

/*
 * Lip sync must never be allowed to gate sound output on iOS.  The previous
 * implementation awaited AudioContext resume and graph creation before calling
 * HTMLMediaElement.play(); after LLM/TTS latency that extra async boundary could
 * lose the WKWebView playback path.  Attach the analyser only when WebAudio is
 * already running.  Otherwise leave the media element completely outside the
 * graph and let it play directly through WebKit.
 */
function monitor(audio, onLevel) {
  if (!onLevel) return false
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) { onLevel(0); return false }
    audioCtx ||= new AudioContextCtor()
    if (audioCtx.state !== 'running') { onLevel(0); return false }

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
      // Playback starts after monitor() is installed. A paused first frame is
      // expected; keep sampling instead of permanently dropping lip sync.
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

  const audio = new Audio()
  activeAudio = audio
  if (objectUrl) activeObjectUrl = url
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.preload = 'auto'
  audio.playsInline = true
  audio.src = url

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

  // Synchronous and optional. Audible playback is the primary contract.
  const lipsyncActive = monitor(audio, onLevel)
  try {
    await audio.play()
    const durationSec = Number.isFinite(audio.duration) ? audio.duration : 0
    onStart?.({ audio, durationSec, lipsyncActive })
    return { played: true, audio, durationSec, lipsyncActive }
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
