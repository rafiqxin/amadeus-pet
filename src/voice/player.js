import { getVoiceAudioUrl, getVoiceCatalogEntry } from './catalog.js'
import { voiceDiagnostic } from './diagnostics.js'
import { isNativeMobileRuntime } from '../platform/runtime.js'

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

/* Hand the audio session back before anything else claims the microphone.
 *
 * A live AudioContext puts iOS in a playback session. `kAFAssistantErrorDomain
 * error 209` is what the Speech framework returns when SFSpeechRecognizer then
 * tries to start its AVAudioEngine in that session: recognition reports
 * "The operation couldn't be completed" and stays broken until the session is
 * free again. startVoice() used to call unlockVoiceAudio() immediately before
 * recognizeOnce(), which armed exactly that conflict, so it now releases the
 * session instead.
 *
 * Suspending is also the safe direction for playback: with the context
 * suspended, monitor() declines to reroute the audio element through WebAudio
 * and the element plays directly, which is the path that demonstrably works on
 * device. It is resumed by the next gesture (unlockVoiceAudio on send or tap). */
export async function suspendVoiceAudio() {
  stopVoicePlayback('voice-capture')
  const ctx = audioCtx
  if (!ctx) return
  try {
    if (ctx.state === 'running') await ctx.suspend()
  } catch {}
}

/* Lip sync is opportunistic. It must never be allowed to block or delay the
   audible HTMLMediaElement path on WKWebView.
 *
 * On native mobile it is skipped entirely, and that is deliberate.
 * createMediaElementSource() *removes* the element's direct output: from then on
 * the audio only reaches the speakers through the AudioContext graph. Measured
 * on device, the two paths behave differently:
 *
 *   bundled OGG at boot, no gesture yet, context suspended
 *     -> PLAY OK "media direct"      audible
 *   anything after a gesture armed the AudioContext (unlockVoiceAudio)
 *     -> PLAY OK "media + lipsync"   routed through WebAudio
 *
 * The reported failure is that LLM replies synthesised fine server-side (the
 * TTS log shows the WAVs being produced) and then produced no sound, i.e. the
 * routed path. Direct playback is the only path demonstrated to make noise on
 * this device, so mobile takes it and gives up the analyser. The mouth is inert
 * either way unless the graph is running, so nothing that currently works is
 * lost. Desktop keeps the analyser and its lip sync. */
function monitor(audio, onLevel) {
  if (!onLevel) return false
  if (isNativeMobileRuntime()) { onLevel(0); return false }
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
  fallbackBlob = null,
} = {}) {
  stopVoicePlayback('replaced')
  if (!url) {
    onLevel?.(0)
    voiceDiagnostic('PLAY', 'FAIL', 'empty URL')
    onEnd?.({ failed: true, reason: 'empty-url' })
    return { played: false, error: new Error('empty audio URL') }
  }

  let currentUrl = url
  let usedFallback = false
  let audio = new Audio()
  activeAudio = audio
  if (objectUrl) activeObjectUrl = url
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.preload = 'auto'
  audio.playsInline = true
  audio.src = currentUrl

  let finished = false
  const finish = (meta = {}) => {
    if (finished) return
    finished = true
    clearWatchdog()
    if (activeFinish === finish) activeFinish = null
    stopAnalyser(onLevel)
    if (activeAudio === audio) activeAudio = null
    if (objectUrl && activeObjectUrl === currentUrl) releaseObjectUrl()

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

  /* WKWebView can refuse to load a `blob:` URL into a media element. That shows
     up as a media error before any playback, and a `data:` URL is loaded by a
     different path, so it is worth one retry. This only ever runs after the
     first attempt already failed, and it reports that it ran so the diagnostic
     line says which path actually produced the audio. */
  const retryWithDataUrl = async () => {
    if (usedFallback || !fallbackBlob || typeof FileReader === 'undefined') return false
    usedFallback = true
    let dataUrl = ''
    try {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('blob read failed'))
        reader.readAsDataURL(fallbackBlob)
      })
    } catch { return false }
    if (!dataUrl) return false

    voiceDiagnostic('PLAY', 'WORK', 'retry as data URL')
    releaseObjectUrl()
    finished = false
    audio = new Audio()
    activeAudio = audio
    currentUrl = dataUrl
    audio.volume = Math.max(0, Math.min(1, volume))
    audio.preload = 'auto'
    audio.playsInline = true
    attach(audio)
    audio.src = dataUrl
    const nowLipsync = monitor(audio, onLevel)
    try {
      await audio.play()
      const durationSec = Number.isFinite(audio.duration) ? audio.duration : 0
      armWatchdog(durationSec)
      voiceDiagnostic('PLAY', 'OK', `data URL${nowLipsync ? ' + lipsync' : ''}`)
      onStart?.({ audio, durationSec, lipsyncActive: nowLipsync, dataUrlFallback: true })
      return true
    } catch (error) {
      voiceDiagnostic('PLAY', 'FAIL', `data URL ${error?.message || error}`)
      finish({ failed: true, reason: error?.message || 'play rejected' })
      return false
    }
  }

  function attach(el) {
    el.onended = () => finish({ ended: true })
    el.onerror = async () => {
      if (await retryWithDataUrl()) return
      const mediaError = el.error?.message || (el.error?.code ? `media error ${el.error.code}` : 'media error')
      finish({ failed: true, reason: mediaError })
    }
    el.onloadedmetadata = () => armWatchdog(el.duration)
  }

  attach(audio)

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
    if (await retryWithDataUrl()) return { played: true, audio, durationSec: 0, lipsyncActive: false }
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
  return playAudioUrl(URL.createObjectURL(blob), { ...opts, objectUrl: true, fallbackBlob: blob })
}
