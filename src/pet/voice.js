/* Optional voice: Web Speech API (zero-dependency, system voices).
   Silently no-ops when no voice is available (e.g. Linux without
   speech-dispatcher), so bubbles/console keep working regardless.
   Exposes word-boundary events + duration estimate for lip-sync. */

let voices = []
let ready = false

function refreshVoices() {
  try {
    if (!window.speechSynthesis) return
    voices = window.speechSynthesis.getVoices()
    ready = voices.length > 0
  } catch {
    ready = false
  }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices()
  window.speechSynthesis.onvoiceschanged = refreshVoices
}

/** Estimate spoken duration in ms (fallback when no boundary events). */
export function estimateDuration(text, rate = 1.05) {
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length
  const other = text.length - cjk
  // ~260ms per CJK char, ~90ms per latin char at rate 1
  return Math.max(1200, (cjk * 260 + other * 90) / rate)
}

export function speak(text, {
  enabled = true,
  rate = 1.05,
  pitch = 1.05,
  onBoundary = null,
  onEnd = null,
} = {}) {
  if (!enabled || !ready) {
    if (onEnd) onEnd()
    return { duration: estimateDuration(text, rate) }
  }
  try {
    const u = new SpeechSynthesisUtterance(text)
    const zh = voices.find((v) => v.lang && v.lang.startsWith('zh'))
    if (zh) u.voice = zh
    u.rate = rate
    u.pitch = pitch
    u.volume = 0.9
    if (onBoundary) u.onboundary = (e) => onBoundary(e.charIndex, e.charLength)
    u.onend = () => onEnd && onEnd()
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    return { duration: estimateDuration(text, rate) }
  } catch {
    if (onEnd) onEnd()
    return { duration: estimateDuration(text, rate) }
  }
}

export function voiceAvailable() {
  return ready
}
