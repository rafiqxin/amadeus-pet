import { getVoiceCatalogEntry } from './catalog.js'
import { localVoiceDecision, finalizeVoiceRoute } from './semantic-router.js'
import { playReferenceVoice, playAudioBlob, stopVoicePlayback } from './player.js'
import { synthesizeTts, ttsConfigured, checkTtsServer } from './tts-client.js'
import { beginVoiceTrace, voiceDiagnostic } from './diagnostics.js'

const LONG_REPLY_CLASSIFIER_LIMIT = 88
const LONG_REPLY_TTS_THRESHOLD = 92
const TTS_SOURCE_CHUNK_CHARS = 64

function containsJapanese(text) {
  return /[\u3040-\u30ff]/.test(String(text || ''))
}

function splitOversizeUnit(unit, maxChars) {
  const out = []
  let rest = String(unit || '').trim()
  const softBreaks = ['，', '、', ',', '：', ':', '（', '(', ' ']
  while (rest.length > maxChars) {
    const minCut = Math.max(18, Math.floor(maxChars * 0.55))
    let cut = -1
    for (const mark of softBreaks) {
      const candidate = rest.lastIndexOf(mark, maxChars)
      if (candidate >= minCut) cut = Math.max(cut, candidate + 1)
    }
    if (cut < minCut) cut = maxChars
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export function splitReplyForTts(text, maxChars = TTS_SOURCE_CHUNK_CHARS) {
  const source = String(text || '').replace(/\r/g, '').trim()
  if (!source) return []
  const units = source.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) || [source]
  const chunks = []
  let current = ''

  const flush = () => {
    const clean = current.trim()
    if (clean) chunks.push(clean)
    current = ''
  }

  for (const raw of units) {
    const unit = raw.trim()
    if (!unit) continue
    if (unit.length > maxChars) {
      flush()
      chunks.push(...splitOversizeUnit(unit, maxChars))
      continue
    }
    if (!current || current.length + unit.length <= maxChars) current += unit
    else { flush(); current = unit }
  }
  flush()
  return chunks.length ? chunks : [source]
}

async function japaneseFor(sourceText, route, translateTts, signal, useRouteTranslation = false) {
  voiceDiagnostic('TRANSLATE', 'WORK', `${String(sourceText || '').length} zh chars`)
  try {
    let spokenJapanese = useRouteTranslation ? String(route.ttsJa || '').trim() : ''
    if (!spokenJapanese && containsJapanese(sourceText)) spokenJapanese = sourceText
    if (!spokenJapanese && typeof translateTts === 'function') {
      spokenJapanese = String(await translateTts(sourceText, signal) || '').trim()
    }
    if (!spokenJapanese) throw new Error('Japanese TTS translation unavailable')
    voiceDiagnostic('TRANSLATE', 'OK', `${spokenJapanese.length} ja chars`)
    return spokenJapanese
  } catch (error) {
    voiceDiagnostic('TRANSLATE', 'FAIL', error?.message || String(error))
    throw error
  }
}

async function playBlobUntilEnded(blob, { onLevel = null, onStart = null } = {}) {
  let resolveEnd
  const ended = new Promise((resolve) => { resolveEnd = resolve })
  const result = await playAudioBlob(blob, {
    onLevel,
    onStart,
    onEnd: (meta) => resolveEnd(meta),
  })
  if (!result.played) return result
  const meta = await ended
  if (meta?.failed || meta?.timedOut) return { ...result, played: false, error: new Error(meta.reason || 'audio ended abnormally') }
  return result
}

export async function routeAndSpeak(text, {
  classify = null,
  translateTts = null,
  mood = 'normal',
  onLevel = null,
  onStart = null,
  onEnd = null,
  onSegmentStart = null,
  onSegmentEnd = null,
  signal = null,
} = {}) {
  const reply = String(text || '').trim()
  if (!reply) return { kind: 'silent', played: false }
  stopVoicePlayback('new-route')

  const local = localVoiceDecision(reply, 0.92)
  let llmDecision = null
  if (!local && reply.length <= LONG_REPLY_CLASSIFIER_LIMIT && typeof classify === 'function') {
    try { llmDecision = await classify(reply, signal) } catch {}
  }
  const route = local
    ? { kind: 'ogg', ...local }
    : finalizeVoiceRoute(reply, llmDecision, { localThreshold: 0.92, llmThreshold: 0.86 })

  if (route.kind === 'ogg' && route.id && getVoiceCatalogEntry(route.id)) {
    beginVoiceTrace('LLM OGG')
    voiceDiagnostic('CONFIG', 'SKIP', route.id)
    const result = await playReferenceVoice(route.id, { onLevel, onStart, onEnd })
    return { ...route, ...result }
  }

  beginVoiceTrace('KURISU TTS')
  if (!ttsConfigured()) {
    voiceDiagnostic('CONFIG', 'FAIL', 'endpoint missing/disabled')
    onLevel?.(0)
    onEnd?.({ failed: true, reason: 'tts-not-configured' })
    return { ...route, kind: 'text', played: false, error: 'TTS not configured' }
  }
  voiceDiagnostic('CONFIG', 'OK', 'endpoint configured')

  voiceDiagnostic('HEALTH', 'WORK')
  const health = await checkTtsServer({ signal })
  if (!health.ok) {
    const detail = health.reason || (health.status ? `HTTP ${health.status}` : 'unreachable')
    voiceDiagnostic('HEALTH', 'FAIL', detail)
    onLevel?.(0)
    onEnd?.({ failed: true, reason: detail })
    return { ...route, kind: 'text', played: false, error: `TTS health failed: ${detail}` }
  }
  voiceDiagnostic('HEALTH', 'OK', health.status ? `HTTP ${health.status}` : 'ready')

  try {
    if (reply.length <= LONG_REPLY_TTS_THRESHOLD) {
      const spokenJapanese = await japaneseFor(reply, route, translateTts, signal, true)
      const generated = await synthesizeTts(spokenJapanese, { language: 'ja', mood, signal })
      const result = await playAudioBlob(generated.blob, { onLevel, onStart, onEnd })
      return {
        ...route,
        kind: result.played ? 'tts' : 'text',
        language: 'ja',
        spokenText: spokenJapanese,
        engine: generated.engine,
        audioBytes: generated.blob.size,
        ...result,
      }
    }

    const chunks = splitReplyForTts(reply)
    const spokenParts = []
    let engine = ''
    let firstStarted = false

    for (let index = 0; index < chunks.length; index += 1) {
      const sourceText = chunks[index]
      const spokenJapanese = await japaneseFor(sourceText, route, translateTts, signal, false)
      const generated = await synthesizeTts(spokenJapanese, { language: 'ja', mood, signal })
      engine ||= generated.engine || ''

      const result = await playBlobUntilEnded(generated.blob, {
        onLevel,
        onStart: (meta = {}) => {
          const segmentMeta = {
            ...meta,
            index,
            total: chunks.length,
            text: sourceText,
            spokenText: spokenJapanese,
          }
          onSegmentStart?.(segmentMeta)
          if (!firstStarted) {
            firstStarted = true
            onStart?.(segmentMeta)
          }
        },
      })
      if (!result.played) throw result.error || new Error(`TTS playback failed at segment ${index + 1}`)
      spokenParts.push(spokenJapanese)
      onSegmentEnd?.({ index, total: chunks.length, text: sourceText, spokenText: spokenJapanese })
    }

    onEnd?.({ ended: true })
    return {
      ...route,
      kind: 'tts',
      language: 'ja',
      spokenText: spokenParts.join(' '),
      engine,
      played: true,
      segmented: true,
      segmentCount: chunks.length,
    }
  } catch (error) {
    onLevel?.(0)
    onEnd?.({ failed: true, reason: error?.message || String(error) })
    return { ...route, kind: 'text', played: false, error: error?.message || String(error) }
  }
}
