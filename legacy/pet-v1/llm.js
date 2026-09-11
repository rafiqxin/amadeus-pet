/* Local LLM client (llama.cpp server, OpenAI-compatible API).
   The LLM is the ONLY dialogue generator while the server is alive:
   every user utterance goes through it. The persona material below is
   injected BEFORE generation as prompt reference (never used to pick a
   canned template reply).

   The three-layer persona prompt is built from the user's own Prompts/
   reference files, digested into facts + measured style statistics only:
     Layer 1  — personality traits   (Prompts/Kurisu_EN.md)
     Layer 2  — world & relationships (Prompts/Story_EN.md)
     Layer 3  — speech style profile  (Prompts/SG_Dialogues_EN.md,
               741 lines analysed: median 33 chars, ~31% end in '?',
               top openers I/What/You/No/Hey, 16% '!', 15% '...')
   No verbatim dialogue from any work is reproduced here. */

const LOCAL_SERVER = 'http://127.0.0.1:8090'
const REMOTE_KEY = 'amadeus-remote-llm-v1'

let remote = { endpoint: '', apiKey: '', model: '' }
try {
  remote = { ...remote, ...(JSON.parse(localStorage.getItem(REMOTE_KEY) || '{}')) }
} catch { /* ignore malformed saved config */ }

function activeServer() {
  return remote.endpoint ? remote.endpoint.replace(/\/$/, '') : LOCAL_SERVER
}

export function getRemoteConfig() {
  return {
    endpoint: remote.endpoint,
    model: remote.model,
    apiKey: remote.apiKey ? '••••••••' : '',
    hasApiKey: !!remote.apiKey,
  }
}

export function setRemoteConfig(next = {}) {
  const hasNewKey = Object.prototype.hasOwnProperty.call(next, 'apiKey')
  remote = {
    endpoint: String(next.endpoint ?? remote.endpoint ?? '').trim().replace(/\/$/, ''),
    apiKey: hasNewKey ? String(next.apiKey || '').trim() : remote.apiKey,
    model: String(next.model ?? remote.model ?? '').trim(),
  }
  try { localStorage.setItem(REMOTE_KEY, JSON.stringify(remote)) } catch { /* ignore */ }
  available = false
}

export function clearRemoteConfig() {
  remote = { endpoint: '', apiKey: '', model: '' }
  try { localStorage.removeItem(REMOTE_KEY) } catch { /* ignore */ }
  available = false
}

export function usingRemoteApi() { return !!remote.endpoint }

/* ---- Persona material ------------------------------------------------
   The three layers and the mood steers are defined once in ../llm/persona.js
   and imported here, so the local llama.cpp path and the remote OpenAI-compatible
   path cannot drift apart. They used to be duplicated in this file only. */
import { LAYER1_PERSONA, LAYER2_WORLD, LAYER3_STYLE, MOOD_LINES } from '../llm/persona.js'

let available = false
let history = [] // [{role:'user'|'assistant', content}]

export async function checkServer() {
  try {
    if (remote.endpoint) {
      const headers = remote.apiKey ? { Authorization: `Bearer ${remote.apiKey}` } : {}
      const r = await fetch(`${activeServer()}/models`, { headers, signal: AbortSignal.timeout(5000) })
      available = r.ok
    } else {
      const r = await fetch(`${LOCAL_SERVER}/health`, { signal: AbortSignal.timeout(2500) })
      available = r.ok
    }
  } catch {
    available = false
  }
  return available
}

export function llmAvailable() {
  return available
}

/* chat(userText, ctx, onDelta)
   ctx = {
     memories : [string]   — recalled keyword memories, injected as context
     styleRef : [string]   — matching dialogue-bank lines, injected as
                             wording reference BEFORE generation (the LLM
                             rephrases in its own words, never echoes them)
     mood     : string     — 'annoyed' | 'flustered' | 'curious' | 'normal'
   }
   onDelta(fullText) fires progressively while streaming. */
export async function chat(userText, ctx = {}, onDelta = null) {
  if (!available) return null
  const { memories = [], styleRef = [], mood = null, signal = null } = ctx
  const messages = [{ role: 'system', content: LAYER1_PERSONA + LAYER2_WORLD + LAYER3_STYLE }]
  messages.push({ role: 'system', content: `【当前时间】${new Date().toLocaleString('zh-CN')}。` })
  if (mood && MOOD_LINES[mood]) {
    messages.push({ role: 'system', content: MOOD_LINES[mood] })
  }
  if (styleRef.length) {
    messages.push({
      role: 'system',
      content: '【风格参考】以下是「你」过去面对类似话题时的措辞样本。' +
        '只把它们当作说话风格的参考，务必用自己的话重新组织、结合当前语境回应，不要整句照搬：\n' +
        styleRef.join('\n'),
    })
  }
  if (memories.length) {
    messages.push({ role: 'system', content: `【你记得的相关往事】${memories.join('；')}` })
  }
  for (const m of history.slice(-8)) messages.push(m)
  messages.push({ role: 'user', content: userText })

  // 180s: the first request after a prompt change must re-evaluate the whole
  // system prompt from scratch (llama.cpp cache miss), which can take a while
  // on a busy machine; 90s cut it off before the first token arrived.
  const timeout = AbortSignal.timeout(180000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    const target = remote.endpoint
      ? `${activeServer()}/chat/completions`
      : `${LOCAL_SERVER}/v1/chat/completions`
    const headers = { 'Content-Type': 'application/json' }
    if (remote.apiKey) headers.Authorization = `Bearer ${remote.apiKey}`
    const r = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages,
        ...(remote.model ? { model: remote.model } : {}),
        max_tokens: 150,
        temperature: 0.8,
        top_p: 0.9,
        stream: true,
      }),
      signal: sig,
    })
    if (!r.ok) return null
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          const delta = j.choices?.[0]?.delta?.content || ''
          if (delta) {
            full += delta
            onDelta?.(full)
          }
        } catch { /* partial */ }
      }
    }
    const reply = full.trim()
    if (!reply) return null
    history.push({ role: 'user', content: userText })
    history.push({ role: 'assistant', content: reply })
    if (history.length > 20) history = history.slice(-20)
    return reply
  } catch {
    return null
  }
}

export function resetHistory() {
  history = []
}
