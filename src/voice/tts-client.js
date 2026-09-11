import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { voiceDiagnostic } from './diagnostics.js'

const STORAGE_KEY = 'amadeus-tts-v1'
const DEFAULT_DESKTOP_ENDPOINT = 'http://127.0.0.1:9881'
export const TTS_OUTPUT_LANGUAGE = 'ja'

let config = { endpoint: '', enabled: true }
try { config = { ...config, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) } } catch {}

function isNativeMobile() {
  try { return Capacitor.isNativePlatform() } catch { return typeof navigator !== 'undefined' && /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) }
}
function defaultEndpoint() { return isNativeMobile() ? '' : DEFAULT_DESKTOP_ENDPOINT }
function baseUrl() { return String(config.endpoint || defaultEndpoint()).trim().replace(/\/$/, '') }
function header(headers, name) {
  if (!headers) return ''
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? String(headers[key] || '') : ''
}

function base64Blob(value, contentType = 'audio/wav') {
  if (value instanceof ArrayBuffer) return new Blob([value], { type: contentType })
  if (ArrayBuffer.isView(value)) return new Blob([value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)], { type: contentType })
  if (Array.isArray(value)) return new Blob([Uint8Array.from(value)], { type: contentType })

  let raw = String(value || '').trim()
  if (!raw) return new Blob([], { type: contentType })
  const comma = raw.indexOf(',')
  if (raw.startsWith('data:') && comma >= 0) raw = raw.slice(comma + 1)
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: contentType })
}

export function decodeNativeAudioResponse(response = {}) {
  const contentType = header(response.headers, 'content-type') || 'audio/wav'
  const blob = base64Blob(response.data, contentType)
  return {
    blob,
    contentType,
    engine: header(response.headers, 'x-amadeus-tts-engine') || 'kurisu-tts',
    language: TTS_OUTPUT_LANGUAGE,
  }
}

export function getTtsConfig() {
  return { endpoint: config.endpoint || defaultEndpoint(), enabled: config.enabled !== false, outputLanguage: TTS_OUTPUT_LANGUAGE }
}
export function setTtsConfig(next = {}) {
  config = {
    endpoint: String(next.endpoint ?? config.endpoint ?? '').trim().replace(/\/$/, ''),
    enabled: Object.prototype.hasOwnProperty.call(next, 'enabled') ? next.enabled !== false : config.enabled !== false,
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch {}
  return getTtsConfig()
}
export function clearTtsConfig() {
  config = { endpoint: '', enabled: true }
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}
export function ttsConfigured() { return config.enabled !== false && !!baseUrl() }

export async function checkTtsServer({ signal = null } = {}) {
  if (!ttsConfigured()) return { ok: false, reason: 'not-configured' }
  const url = `${baseUrl()}/health`
  try {
    if (isNativeMobile()) {
      const response = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 5000, readTimeout: 5000 })
      const body = typeof response.data === 'string' ? JSON.parse(response.data || '{}') : (response.data || {})
      return { ok: response.status >= 200 && response.status < 300 && body?.ok !== false, status: response.status, body }
    }
    const timeout = AbortSignal.timeout(5000)
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(url, { signal: sig, cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    return { ok: response.ok && body?.ok !== false, status: response.status, body }
  } catch (error) {
    return { ok: false, reason: error?.message || 'network-error' }
  }
}

export async function synthesizeTts(text, { language = TTS_OUTPUT_LANGUAGE, mood = 'normal', signal = null } = {}) {
  const sentence = String(text || '').trim()
  if (!sentence) throw new Error('TTS text is empty')
  if (!ttsConfigured()) throw new Error('Kurisu TTS endpoint is not configured')
  if (String(language || '').toLowerCase() !== TTS_OUTPUT_LANGUAGE) throw new Error('AMA-DEUS Kurisu TTS accepts Japanese speech text only')

  const url = `${baseUrl()}/v1/tts`
  const payload = { text: sentence, language: TTS_OUTPUT_LANGUAGE, mood: String(mood || 'normal') }
  voiceDiagnostic('SYNTH', 'WORK', `${sentence.length} ja chars`)

  if (isNativeMobile()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      data: payload,
      responseType: 'arraybuffer',
      connectTimeout: 15000,
      readTimeout: 300000,
    })
    if (response.status < 200 || response.status >= 300) {
      voiceDiagnostic('SYNTH', 'FAIL', `HTTP ${response.status}`)
      throw new Error(`Kurisu TTS HTTP ${response.status}`)
    }
    voiceDiagnostic('SYNTH', 'OK', `HTTP ${response.status}`)
    try {
      const decoded = decodeNativeAudioResponse(response)
      if (!decoded.blob.size) throw new Error('Kurisu TTS returned empty audio')
      voiceDiagnostic('DECODE', 'OK', `${decoded.blob.size} B`)
      return decoded
    } catch (error) {
      voiceDiagnostic('DECODE', 'FAIL', error?.message || String(error))
      throw error
    }
  }

  const timeout = AbortSignal.timeout(300000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: sig,
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    voiceDiagnostic('SYNTH', 'FAIL', `HTTP ${response.status}`)
    throw new Error(`Kurisu TTS ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`)
  }
  voiceDiagnostic('SYNTH', 'OK', `HTTP ${response.status}`)
  const blob = await response.blob()
  if (!blob.size) {
    voiceDiagnostic('DECODE', 'FAIL', '0 B')
    throw new Error('Kurisu TTS returned empty audio')
  }
  voiceDiagnostic('DECODE', 'OK', `${blob.size} B`)
  return {
    blob,
    contentType: response.headers.get('content-type') || blob.type || 'audio/wav',
    engine: response.headers.get('x-amadeus-tts-engine') || 'kurisu-tts',
    language: TTS_OUTPUT_LANGUAGE,
  }
}
