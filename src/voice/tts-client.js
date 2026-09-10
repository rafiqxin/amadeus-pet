const STORAGE_KEY = 'amadeus-tts-v1'
const DEFAULT_DESKTOP_ENDPOINT = 'http://127.0.0.1:9881'

let config = { endpoint: '', enabled: true }
try { config = { ...config, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) } } catch {}

function isNativeMobile() { return typeof navigator !== 'undefined' && /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) }
function defaultEndpoint() { return isNativeMobile() ? '' : DEFAULT_DESKTOP_ENDPOINT }
function baseUrl() { return String(config.endpoint || defaultEndpoint()).trim().replace(/\/$/, '') }

export function getTtsConfig() { return { endpoint: config.endpoint || defaultEndpoint(), enabled: config.enabled !== false } }
export function setTtsConfig(next = {}) {
  config = {
    endpoint: String(next.endpoint ?? config.endpoint ?? '').trim().replace(/\/$/, ''),
    enabled: Object.prototype.hasOwnProperty.call(next, 'enabled') ? next.enabled !== false : config.enabled !== false,
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch {}
  return getTtsConfig()
}
export function clearTtsConfig() { config = { endpoint: '', enabled: true }; try { localStorage.removeItem(STORAGE_KEY) } catch {} }
export function ttsConfigured() { return config.enabled !== false && !!baseUrl() }
export function inferTtsLanguage(text) {
  const s = String(text || '')
  if (/[\u3040-\u30ff]/.test(s)) return 'ja'
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh'
  return 'ja'
}

export async function checkTtsServer({ signal = null } = {}) {
  if (!ttsConfigured()) return { ok: false, reason: 'not-configured' }
  try {
    const timeout = AbortSignal.timeout(5000)
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(`${baseUrl()}/health`, { signal: sig })
    const body = await response.json().catch(() => ({}))
    return { ok: response.ok && body?.ok !== false, status: response.status, body }
  } catch (error) { return { ok: false, reason: error?.message || 'network-error' } }
}

export async function synthesizeTts(text, { language = null, mood = 'normal', signal = null } = {}) {
  const sentence = String(text || '').trim()
  if (!sentence) throw new Error('TTS text is empty')
  if (!ttsConfigured()) throw new Error('Kurisu TTS endpoint is not configured')
  const timeout = AbortSignal.timeout(120000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(`${baseUrl()}/v1/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sentence, language: language || inferTtsLanguage(sentence), mood: String(mood || 'normal') }),
    signal: sig,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Kurisu TTS ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`)
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('Kurisu TTS returned empty audio')
  return { blob, contentType: response.headers.get('content-type') || blob.type || 'audio/wav', engine: response.headers.get('x-amadeus-tts-engine') || 'kurisu-tts' }
}
