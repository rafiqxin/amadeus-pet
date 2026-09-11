import { getVoiceAudioUrl, getVoiceCatalogEntry } from './catalog.js'
import { voiceDiagnostic } from './diagnostics.js'

let activeAudio = null
let activeObjectUrl = ''
let activeFinish = null
let audioCtx = null
let analyserFrame = null
let analyser = null
let activeLevelCallback = null
let activeWatchdog = null

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

function clearWatchdog() {
  if (activeWatchdog) clearTimeout(activeWatchdog)
  activeWatchdog = null
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

/* Lip sync is opportunistic. It must never be allowed to block or delay the
   audible HTMLMediaElement path on WKWebView. */
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

export function stopVoicePlayback(reason = 'interrupted') {
  const finish = activeFinish
  activeFinish = null
  clearWatchdog()
  try { activeAudio?.pause() } catch {}
  try { window.speechSynthesis?.cancel() } catch {}
  stopAnalyser()
  activeAudio = null
  try { finish?.({ interrupted: true, reason }) } catch {}
  releaseObjectUrl()
}

export async function playAudioUrl(url, {
  volume = 0.96,
  onLevel = null,
  onStart = null,
  onEnd = null,
  objectUrl = false,
} = {}) {
  stopVoicePlayback('replaced')
  if (!url) {
    onLevel?.(0)
    voiceDiagnostic('PLAY', 'FAIL', 'empty URL')
    onEnd?.({ failed: true, reason: 'empty-url' })
    return { played: false, error: new Error('empty audio URL') }
  }

  const audio = new Audio()
  activeAudio = audio
  if (objectUrl) activeObjectUrl = url
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.preload = 'auto'
  audio.playsInline = true
  audio.src = url

  let finished = false
  const finish = (meta = {}) => {
    if (finished) return
    finished = true
    clearWatchdog()
    if (activeFinish === finish) activeFinish = null
    stopAnalyser(onLevel)
    if (activeAudio === audio) activeAudio = null
    if (objectUrl && activeObjectUrl === url) releaseObjectUrl()

    if (meta.failed) voiceDiagnostic('END', 'FAIL', meta.reason || 'media error')
    else if (meta.timedOut) voiceDiagnostic('END', 'FAIL', 'watchdog timeout')
    else if (meta.interrupted) voiceDiagnostic('END', 'SKIP', meta.reason || 'interrupted')
    else voiceDiagnostic('END', 'OK')
    onEnd?.(meta)
  }
  activeFinish = finish

  const armWatchdog = (durationSec = 0) => {
    clearWatchdog()
    const knownMs = Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 + 5000 : 120000
    const timeoutMs = Math.max(8000, Math.min(180000, knownMs))
    activeWatchdog = setTimeout(() => finish({ timedOut: true, reason: 'watchdog' }), timeoutMs)
  }

  audio.onended = () => finish({ ended: true })
  audio.onerror = () => {
    const mediaError = audio.error?.message || (audio.error?.code ? `media error ${audio.error.code}` : 'media error')
    finish({ failed: true, reason: mediaError })
  }
  audio.onloadedmetadata = () => armWatchdog(audio.duration)

  const lipsyncActive = monitor(audio, onLevel)
  voiceDiagnostic('PLAY', 'WORK', objectUrl ? 'blob URL' : 'bundled media')
  try {
    await audio.play()
    const durationSec = Number.isFinite(audio.duration) ? audio.duration : 0
    armWatchdog(durationSec)
    voiceDiagnostic('PLAY', 'OK', lipsyncActive ? 'media + lipsync' : 'media direct')
    onStart?.({ audio, durationSec, lipsyncActive })
    return { played: true, audio, durationSec, lipsyncActive }
  } catch (error) {
    voiceDiagnostic('PLAY', 'FAIL', error?.message || String(error))
    finish({ failed: true, reason: error?.message || 'play rejected' })
    return { played: false, error, lipsyncActive: false }
  }
}

export async function playReferenceVoice(id, opts = {}) {
  const entry = getVoiceCatalogEntry(id)
  if (!entry) {
    opts.onLevel?.(0)
    voiceDiagnostic('PLAY', 'FAIL', `unknown OGG ${id || '(empty)'}`)
    opts.onEnd?.({ failed: true, reason: 'unknown-reference-voice' })
    return { played: false, entry: null }
  }
  const result = await playAudioUrl(getVoiceAudioUrl(id), opts)
  return { ...result, entry }
}

export async function playAudioBlob(blob, opts = {}) {
  if (!(blob instanceof Blob) || !blob.size) {
    opts.onLevel?.(0)
    voiceDiagnostic('DECODE', 'FAIL', 'empty audio blob')
    opts.onEnd?.({ failed: true, reason: 'empty-audio-blob' })
    return { played: false, error: new Error('empty TTS audio') }
  }
  return playAudioUrl(URL.createObjectURL(blob), { ...opts, objectUrl: true })
}
