import { VOICE_CATALOG, getVoiceCatalogEntry, voiceCatalogPromptLines } from './catalog.js'

function norm(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}
function bigrams(value) {
  const s = norm(value)
  if (!s) return []
  if (s.length < 2) return [s]
  const out = []
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2))
  return out
}
function dice(a, b) {
  const aa = bigrams(a), bb = bigrams(b)
  if (!aa.length || !bb.length) return 0
  const bag = new Map()
  for (const x of aa) bag.set(x, (bag.get(x) || 0) + 1)
  let hit = 0
  for (const x of bb) {
    const count = bag.get(x) || 0
    if (count > 0) { hit += 1; bag.set(x, count - 1) }
  }
  return (2 * hit) / (aa.length + bb.length)
}
function keywordScore(text, tags = []) {
  const n = norm(text)
  if (!n || !tags.length) return 0
  let weightedHits = 0
  for (const tag of tags) {
    const t = norm(tag)
    if (t && n.includes(t)) weightedHits += Math.min(1, 0.45 + t.length * 0.08)
  }
  return Math.min(1, weightedHits / Math.max(1, Math.min(2.2, tags.length * 0.55)))
}

export function scoreVoiceLocally(text, entry) {
  if (!entry) return 0
  const compact = norm(text)
  if (!compact) return 0
  const zh = norm(entry.zh), en = norm(entry.en)
  if ((zh.length >= 2 && compact === zh) || (en.length >= 2 && compact === en)) return 1
  if ((zh.length >= 4 && compact.includes(zh)) || (en.length >= 5 && compact.includes(en))) return 0.98
  const surface = Math.max(dice(text, entry.zh), dice(text, entry.en))
  const tags = keywordScore(text, entry.tags)
  return Math.min(0.96, surface * 0.68 + tags * 0.32)
}

export function rankVoiceLocally(text, limit = 5) {
  return VOICE_CATALOG.map((entry) => ({ entry, score: scoreVoiceLocally(text, entry) }))
    .sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit))
}

export function localVoiceDecision(text, threshold = 0.9) {
  const best = rankVoiceLocally(text, 1)[0]
  if (!best || best.score < threshold) return null
  return { id: best.entry.id, confidence: Number(best.score.toFixed(3)), source: 'local', reason: 'high-confidence text metadata match' }
}

export function buildVoiceClassifierMessages(replyText) {
  return [
    {
      role: 'system',
      content: [
        'You are the AMA-DEUS reference-voice router and Japanese speech planner.',
        'The user speaks Chinese and the visible assistant reply is normally Chinese. Kurisu TTS must ALWAYS receive natural Japanese.',
        'You never listen to audio. The catalog below is the complete semantic metadata for the bundled original OGG clips.',
        'Choose a catalog voice only when the assistant reply expresses substantially the SAME utterance/intent, not merely the same topic.',
        'If no clip is a close semantic substitute, choose NONE.',
        'Also translate the complete assistant reply into natural spoken Japanese suitable for Makise Kurisu. Preserve meaning, tone, technical terms and sentence count as much as practical. Do not add information, role labels, quotes, ruby, stage directions or explanations.',
        'Return exactly one compact JSON object and nothing else:',
        '{"id":"<catalog id or NONE>","confidence":0.0,"reason":"short reason","tts_ja":"natural Japanese translation"}',
        'Use confidence >= 0.86 only for a genuinely close semantic substitute.',
        'Catalog:',
        voiceCatalogPromptLines().join('\n'),
      ].join('\n'),
    },
    { role: 'user', content: `Chinese-visible assistant reply to route and translate:\n${String(replyText || '')}` },
  ]
}

export function parseVoiceClassifierResponse(raw) {
  const text = String(raw || '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const id = String(parsed.id || '').trim()
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    const ttsJa = String(parsed.tts_ja || '').trim()
    const base = { confidence, source: 'llm', reason: String(parsed.reason || ''), ttsJa }
    if (id.toUpperCase() === 'NONE') return { id: null, ...base }
    if (!getVoiceCatalogEntry(id)) return { id: null, ...base, reason: `invalid catalog id: ${id}` }
    return { id, ...base }
  } catch { return null }
}

export function finalizeVoiceRoute(text, llmDecision = null, { llmThreshold = 0.86, localThreshold = 0.92 } = {}) {
  const local = localVoiceDecision(text, localThreshold)
  if (local) return { kind: 'ogg', ...local }
  if (llmDecision?.id && getVoiceCatalogEntry(llmDecision.id) && llmDecision.confidence >= llmThreshold) return { kind: 'ogg', ...llmDecision }
  return {
    kind: 'tts',
    id: null,
    confidence: llmDecision?.confidence || 0,
    source: llmDecision ? 'llm-none' : 'no-classifier',
    reason: llmDecision?.reason || 'no close reference clip; synthesize the exact reply',
    ttsJa: String(llmDecision?.ttsJa || '').trim(),
  }
}
