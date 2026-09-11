import { getVoiceAudioUrl, getVoiceCatalogEntry } from './catalog.js'
import { voiceDiagnostic } from './diagnostics.js'

let activeAudio = null
let activeObjectUrl = ''
let activeFinish = null
let audioCtx = null
let analyserFrame = null
let envelope = null
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
  envelope = null
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
 * session instead. It is resumed by the next gesture (unlockVoiceAudio on send
 * or tap). Playback itself no longer depends on the context either way: lip sync
 * decodes offline, so the element always outputs directly. */
export async function suspendVoiceAudio() {
  stopVoicePlayback('voice-capture')
  const ctx = audioCtx
  if (!ctx) return
  try {
    if (ctx.state === 'running') await ctx.suspend()
  } catch {}
}

/* ---- Lip sync ------------------------------------------------------------
 *
 * The mouth is driven from an amplitude envelope computed OFFLINE from the
 * clip's own samples, then sampled by the audio element's currentTime.
 *
 * The previous approach routed the element through the Web Audio graph with
 * createMediaElementSource() to read a live AnalyserNode. That has a fatal
 * property on WKWebView: creating the source node *removes* the element's direct
 * output, so from then on the audio only reaches the speakers through the graph.
 * On this device the routed path was silent, which is why mobile had to skip lip
 * sync entirely and the mouth then only moved with the model's own motion data —
 * visibly out of step with the voice.
 *
 * Decoding to PCM touches no output path at all, so the element keeps playing
 * directly (audible) and the mouth follows it. The envelope is built in the
 * background and never delays playback; if decoding fails the mouth simply stays
 * closed, as it did before. */

const ENVELOPE_FPS = 25
const ENVELOPE_FRAME_MS = Math.round(1000 / ENVELOPE_FPS)

/* Same response curve the live analyser used, so the mouth keeps the feel it had
   where that path did work (desktop). */
function levelFromRms(rms) {
  return Math.max(0, Math.min(1, (rms - 0.012) * 5.5))
}

function envelopeFromChannels(channels, sampleRate) {
  const frames = channels[0]?.length || 0
  if (!frames || !sampleRate) return null
  const frameSize = Math.max(1, Math.round(sampleRate / ENVELOPE_FPS))
  const out = new Float32Array(Math.ceil(frames / frameSize))
  for (let f = 0; f < out.length; f += 1) {
    const start = f * frameSize
    const end = Math.min(start + frameSize, frames)
    let sum = 0
    let n = 0
    for (let i = start; i < end; i += 1) {
      for (const channel of channels) {
        const v = channel[i]
        sum += v * v
        n += 1
      }
    }
    out[f] = n ? levelFromRms(Math.sqrt(sum / n)) : 0
  }
  return out
}

/* Minimal RIFF/WAVE reader. The Kurisu TTS server returns 32 kHz 16-bit mono
   PCM, so the common case needs no decoding API at all — which also sidesteps
   WKWebView's lack of Ogg Vorbis support for the bundled clips. */
function parseWavChannels(buffer) {
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 44) return null
    if (view.getUint32(0, false) !== 0x52494646) return null // 'RIFF'
    if (view.getUint32(8, false) !== 0x57415645) return null // 'WAVE'
    let offset = 12
    let format = null
    let dataOffset = -1
    let dataLength = 0
    while (offset + 8 <= view.byteLength) {
      const id = view.getUint32(offset, false)
      const size = view.getUint32(offset + 4, true)
      const body = offset + 8
      if (id === 0x666d7420) { // 'fmt '
        format = {
          code: view.getUint16(body, true),
          channels: view.getUint16(body + 2, true),
          sampleRate: view.getUint32(body + 4, true),
          bits: view.getUint16(body + 14, true),
        }
      } else if (id === 0x64617461) { // 'data'
        dataOffset = body
        dataLength = size
      }
      offset = body + size + (size % 2)
    }
    if (!format || dataOffset < 0) return null
    if (format.code !== 1 || format.bits !== 16 || !format.channels) return null
    const available = Math.min(dataLength, view.byteLength - dataOffset)
    const frames = Math.floor(available / (2 * format.channels))
    if (frames <= 0) return null
    const channels = []
    for (let c = 0; c < format.channels; c += 1) channels.push(new Float32Array(frames))
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < format.channels; c += 1) {
        channels[c][i] = view.getInt16(dataOffset + (i * format.channels + c) * 2, true) / 32768
      }
    }
    return { channels, sampleRate: format.sampleRate }
  } catch {
    return null
  }
}

async function decodeEnvelopeFromArrayBuffer(buffer) {
  const wav = parseWavChannels(buffer)
  if (wav) return envelopeFromChannels(wav.channels, wav.sampleRate)
  // Not PCM WAV (the bundled clips are Ogg Vorbis). OfflineAudioContext decodes
  // without ever opening the audio device or disturbing the playback session.
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Ctor) return null
  const ctx = new Ctor(1, 1, 44100)
  const decoded = await ctx.decodeAudioData(buffer.slice(0))
  const channels = []
  for (let c = 0; c < decoded.numberOfChannels; c += 1) channels.push(decoded.getChannelData(c))
  return envelopeFromChannels(channels, decoded.sampleRate)
}

function startEnvelopeLipSync(audio, frames, onLevel) {
  if (!frames?.length || typeof requestAnimationFrame !== 'function') return false
  envelope = frames
  activeLevelCallback = onLevel
  const tick = () => {
    if (!envelope || activeAudio !== audio) { onLevel(0); return }
    if (audio.ended) { stopAnalyser(onLevel); return }
    if (audio.paused) { analyserFrame = requestAnimationFrame(tick); return }
    const index = Math.floor(Number(audio.currentTime || 0) * ENVELOPE_FPS)
    onLevel(envelope[Math.max(0, Math.min(envelope.length - 1, index))] || 0)
    analyserFrame = requestAnimationFrame(tick)
  }
  tick()
  return true
}

/* Fire-and-forget: playback has already started by the time this resolves, and a
   failure just means no mouth movement. */
async function attachEnvelope(audio, source, onLevel) {
  if (!onLevel || !source) return false
  try {
    let buffer = null
    if (source.blob) buffer = await source.blob.arrayBuffer()
    else if (typeof fetch === 'function') buffer = await (await fetch(source.url)).arrayBuffer()
    if (!buffer || activeAudio !== audio) return false
    const frames = await decodeEnvelopeFromArrayBuffer(buffer)
    if (!frames || activeAudio !== audio) return false
    const started = startEnvelopeLipSync(audio, frames, onLevel)
    if (started) voiceDiagnostic('LIPSYNC', 'OK', `${frames.length} frames @ ${ENVELOPE_FRAME_MS}ms`)
    return started
  } catch (error) {
    voiceDiagnostic('LIPSYNC', 'SKIP', error?.message || 'decode failed')
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
  envelopeSource = null,
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
    void attachEnvelope(audio, envelopeSource, onLevel)
    try {
      await audio.play()
      const durationSec = Number.isFinite(audio.duration) ? audio.duration : 0
      armWatchdog(durationSec)
      voiceDiagnostic('PLAY', 'OK', 'data URL')
      onStart?.({ audio, durationSec, lipsyncActive: false, dataUrlFallback: true })
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

  // Playback first, mouth second: the envelope is decoded in the background and
  // must never sit between the user and the audio.
  const lipsyncActive = false
  void attachEnvelope(audio, envelopeSource, onLevel)
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
  const result = await playAudioUrl(getVoiceAudioUrl(id), { ...opts, envelopeSource: { url: getVoiceAudioUrl(id) } })
  return { ...result, entry }
}

export async function playAudioBlob(blob, opts = {}) {
  if (!(blob instanceof Blob) || !blob.size) {
    opts.onLevel?.(0)
    voiceDiagnostic('DECODE', 'FAIL', 'empty audio blob')
    opts.onEnd?.({ failed: true, reason: 'empty-audio-blob' })
    return { played: false, error: new Error('empty TTS audio') }
  }
  return playAudioUrl(URL.createObjectURL(blob), {
    ...opts,
    objectUrl: true,
    fallbackBlob: blob,
    // The WAV bytes are already in hand, so the mouth does not need a refetch.
    envelopeSource: { blob },
  })
}
