import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { buildVoiceClassifierMessages, parseVoiceClassifierResponse } from '../voice/semantic-router.js'

const LOCAL_SERVER = 'http://127.0.0.1:8090'
const STORAGE_KEY = 'amadeus-remote-llm-v2'
const LEGACY_STORAGE_KEY = 'amadeus-remote-llm-v1'

let remote = { endpoint: '', model: '', apiKey: '' }
try {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
  if (raw) remote = { ...remote, ...JSON.parse(raw) }
} catch {}

const history = []
const MAX_HISTORY = 12
const SYSTEM_PROMPT = `你是 AMA-DEUS 系统中的牧濑红莉栖。你是一个有连续人格、会记住上下文的对话角色，而不是旁白或通用客服。

人格原则：
- 逻辑严谨、聪明、带一点傲娇与吐槽，但不要每句话都刻意傲娇。
- 对技术和科学问题可以认真解释；对日常交流保持自然、简短、有反应。
- 不要声称自己是真人、原作官方系统或声优本人。
- 默认使用用户正在使用的语言；当前用户使用中文时，以自然中文回答。
- 回复优先 1~4 句，除非问题确实需要展开。
- 不要输出动作舞台说明，例如“（脸红）”“*叹气*”；表情和动作由客户端单独驱动。`

function cleanEndpoint(value) { return String(value || '').trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '').replace(/\/models$/, '') }
export function getRemoteConfig() { return { endpoint: remote.endpoint, model: remote.model, hasApiKey: !!remote.apiKey } }
export function setRemoteConfig(next = {}) {
  remote = { endpoint: cleanEndpoint(next.endpoint ?? remote.endpoint), model: String(next.model ?? remote.model).trim(), apiKey: Object.prototype.hasOwnProperty.call(next, 'apiKey') ? String(next.apiKey || '').trim() : remote.apiKey }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)) } catch {}
  return getRemoteConfig()
}
export function clearRemoteConfig() { remote = { endpoint: '', model: '', apiKey: '' }; try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY) } catch {} }
export function usingRemoteApi() { return !!(remote.endpoint && remote.model) }
export function clearHistory() { history.splice(0, history.length) }

function target(path) { return usingRemoteApi() ? `${cleanEndpoint(remote.endpoint)}${path}` : `${LOCAL_SERVER}${path.startsWith('/v1') ? path : `/v1${path}`}` }
function headers() { const out = { 'Content-Type': 'application/json' }; if (usingRemoteApi() && remote.apiKey) out.Authorization = `Bearer ${remote.apiKey}`; return out }
function isNative() { try { return Capacitor.isNativePlatform() } catch { return typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent) } }

/* Reasoning models (DeepSeek flash/v4 and similar) can spend the entire
   max_tokens budget on hidden reasoning and return an empty `content` with
   finish_reason "length". The translation and classifier calls then fail
   outright, and the visible reply stalls. Raising max_tokens does NOT fix it —
   the reasoning simply grows to match (measured: 3000 tokens still truncated).
   These switches ask for the answer directly instead.

   Measured on deepseek-flash with the Kurisu system prompt:
     thinking on  — 3.0 s, 147-char reply, 277 chars of hidden reasoning
     thinking off — 1.6 s,  63-char reply, no hidden reasoning
   Faster and closer to the 1-4 sentence persona brief. Non-reasoning backends
   ignore these fields; one that rejects them gets an automatic retry without. */
const NO_REASONING = { thinking: { type: 'disabled' }, reasoning_effort: 'none' }

function withoutNoReasoning(data) {
  const { thinking, reasoning_effort, ...rest } = data
  return rest
}

async function postJson(url, data, signal = null, timeoutMs = 60000, allowRetry = true) {
  if (isNative() && usingRemoteApi()) {
    const response = await CapacitorHttp.post({ url, headers: headers(), data, connectTimeout: 15000, readTimeout: timeoutMs })
    if (response.status === 400 && allowRetry && Object.prototype.hasOwnProperty.call(data, 'thinking')) {
      return postJson(url, withoutNoReasoning(data), signal, timeoutMs, false)
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`LLM HTTP ${response.status}`)
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  }
  const timeout = AbortSignal.timeout(timeoutMs)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(data), signal: sig })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 400 && allowRetry && Object.prototype.hasOwnProperty.call(data, 'thinking')) {
      return postJson(url, withoutNoReasoning(data), signal, timeoutMs, false)
    }
    throw new Error(`LLM HTTP ${response.status}: ${detail.slice(0, 200)}`)
  }
  return response.json()
}

async function getJson(url, signal = null, timeoutMs = 6000) {
  if (isNative() && usingRemoteApi()) {
    const response = await CapacitorHttp.get({ url, headers: headers(), connectTimeout: timeoutMs, readTimeout: timeoutMs })
    if (response.status < 200 || response.status >= 300) throw new Error(`LLM HTTP ${response.status}`)
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  }
  const timeout = AbortSignal.timeout(timeoutMs)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, { headers: headers(), signal: sig })
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
  return response.json()
}

export async function checkServer(signal = null) { try { await getJson(target('/models'), signal); return true } catch { return false } }
export async function chat(text, { signal = null } = {}) {
  const userText = String(text || '').trim()
  if (!userText) return ''
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: userText }]
  const data = await postJson(target('/chat/completions'), { model: usingRemoteApi() ? remote.model : undefined, messages, temperature: 0.72, max_tokens: 400, stream: false, ...NO_REASONING }, signal, 90000)
  const reply = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!reply) throw new Error('LLM returned an empty reply')
  history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply })
  while (history.length > MAX_HISTORY) history.shift()
  return reply
}

export async function classifyReferenceVoice(replyText, signal = null) {
  try {
    // The classifier returns the matched clip AND its own tts_ja translation,
    // so the budget has to cover prose as well as the small JSON envelope.
    const budget = Math.min(4000, 400 + String(replyText || '').length * 4)
    const data = await postJson(target('/chat/completions'), { model: usingRemoteApi() ? remote.model : undefined, messages: buildVoiceClassifierMessages(replyText), temperature: 0, max_tokens: budget, stream: false, ...NO_REASONING }, signal, 60000)
    return parseVoiceClassifierResponse(data?.choices?.[0]?.message?.content || '')
  } catch { return null }
}

export async function translateForKurisuTts(replyText, signal = null) {
  const text = String(replyText || '').trim()
  if (!text) return ''
  const messages = [
    {
      role: 'system',
      content: [
        'Translate the supplied Chinese AMA-DEUS assistant reply into natural spoken Japanese for Makise Kurisu TTS.',
        'Preserve the exact meaning, tone, technical terminology and information content.',
        'Do not add explanations, speaker names, quotation marks, markdown, stage directions or extra facts.',
        'Return Japanese text only.',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ]
  // Japanese runs longer than Chinese (roughly 1.15x the character count, and
  // more tokens again), so a fixed 500-token budget truncated long replies
  // mid-sentence — the character would trail off in the middle of a clause.
  // Scale with the input instead, with a ceiling that still bounds cost.
  const budget = Math.min(4000, 400 + text.length * 4)
  const data = await postJson(target('/chat/completions'), { model: usingRemoteApi() ? remote.model : undefined, messages, temperature: 0.15, max_tokens: budget, stream: false, ...NO_REASONING }, signal, 60000)
  const translated = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!translated) throw new Error('LLM returned an empty Japanese TTS translation')
  return stripForSpeech(translated)
}

/* Spoken text must be plain prose. The model mirrors markdown from its own
   reply even when told not to, and TTS would otherwise read out "**", "#" and
   list bullets as noise. */
function stripForSpeech(text) {
  return String(text || '')
    .replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*/g, '$1$2')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
