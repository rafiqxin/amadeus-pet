import { getVoiceAudioUrl, getVoiceCatalogEntry } from './catalog.js'

let activeAudio = null
let activeObjectUrl = ''
let audioCtx = null
let analyserFrame = null
let analyser = null

function releaseObjectUrl() {
  if (!activeObjectUrl) return
  try { URL.revokeObjectURL(activeObjectUrl) } catch {}
  activeObjectUrl = ''
}
function stopAnalyser(onLevel) {
  if (analyserFrame) cancelAnimationFrame(analyserFrame)
  analyserFrame = null
  analyser = null
  onLevel?.(0)
}
function monitor(audio, onLevel) {
  if (!onLevel) return
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    audioCtx.resume?.()
    const source = audioCtx.createMediaElementSource(audio)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyser.connect(audioCtx.destination)
    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      if (!analyser || audio.paused || audio.ended) { onLevel(0); return }
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const x of data) { const v = (x - 128) / 128; sum += v * v }
      const rms = Math.sqrt(sum / data.length)
      onLevel(Math.max(0, Math.min(1, (rms - 0.012) * 5.5)))
      analyserFrame = requestAnimationFrame(tick)
    }
    tick()
  } catch { onLevel(0) }
}

export function stopVoicePlayback() {
  try { activeAudio?.pause() } catch {}
  try { window.speechSynthesis?.cancel() } catch {}
  stopAnalyser()
  activeAudio = null
  releaseObjectUrl()
}

export async function playAudioUrl(url, { volume = 0.96, onLevel = null, onEnd = null, objectUrl = false } = {}) {
  stopVoicePlayback()
  if (!url) { onLevel?.(0); onEnd?.(); return { played: false } }
  const audio = new Audio(url)
  activeAudio = audio
  if (objectUrl) activeObjectUrl = url
  audio.volume = Math.max(0, Math.min(1, volume))
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
  monitor(audio, onLevel)
  try { await audio.play(); return { played: true, audio } }
  catch (error) { finish(); return { played: false, error } }
}

export async function playReferenceVoice(id, opts = {}) {
  const entry = getVoiceCatalogEntry(id)
  if (!entry) { opts.onLevel?.(0); opts.onEnd?.(); return { played: false, entry: null } }
  const result = await playAudioUrl(getVoiceAudioUrl(id), opts)
  return { ...result, entry }
}

export async function playAudioBlob(blob, opts = {}) {
  if (!(blob instanceof Blob) || !blob.size) { opts.onLevel?.(0); opts.onEnd?.(); return { played: false, error: new Error('empty TTS audio') } }
  return playAudioUrl(URL.createObjectURL(blob), { ...opts, objectUrl: true })
}
