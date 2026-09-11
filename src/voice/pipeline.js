import { getVoiceCatalogEntry } from './catalog.js'
import { localVoiceDecision, finalizeVoiceRoute } from './semantic-router.js'
import { playReferenceVoice, playAudioBlob, stopVoicePlayback } from './player.js'
import { synthesizeTts, ttsConfigured } from './tts-client.js'

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
  let spokenJapanese = useRouteTranslation ? String(route.ttsJa || '').trim() : ''
  if (!spokenJapanese && containsJapanese(sourceText)) spokenJapanese = sourceText
  if (!spokenJapanese && typeof translateTts === 'function') {
    spokenJapanese = String(await translateTts(sourceText, signal) || '').trim()
  }
  if (!spokenJapanese) throw new Error('Japanese TTS translation unavailable')
  return spokenJapanese
}

async function playBlobUntilEnded(blob, { onLevel = null, onStart = null } = {}) {
  let resolveEnd
  const ended = new Promise((resolve) => { resolveEnd = resolve })
  const result = await playAudioBlob(blob, {
    onLevel,
    onStart,
    onEnd: () => resolveEnd(),
  })
  if (!result.played) return result
  await ended
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
  stopVoicePlayback()

  const local = localVoiceDecision(reply, 0.92)
  let llmDecision = null
  if (!local && reply.length <= LONG_REPLY_CLASSIFIER_LIMIT && typeof classify === 'function') {
    try { llmDecision = await classify(reply, signal) } catch {}
  }
  const route = local
    ? { kind: 'ogg', ...local }
    : finalizeVoiceRoute(reply, llmDecision, { localThreshold: 0.92, llmThreshold: 0.86 })

  if (route.kind === 'ogg' && route.id && getVoiceCatalogEntry(route.id)) {
    const result = await playReferenceVoice(route.id, { onLevel, onStart, onEnd })
    return { ...route, ...result }
  }

  if (!ttsConfigured()) {
    onLevel?.(0)
    onEnd?.()
    return { ...route, kind: 'text', played: false, error: 'TTS not configured' }
  }

  try {
    // Preserve the exact alpha.2 behaviour for ordinary short replies. This is
    // the path already verified on real iOS hardware: one translation, one WAV,
    // one native bridge transfer, one HTMLMediaElement playback.
    if (reply.length <= LONG_REPLY_TTS_THRESHOLD) {
      const spokenJapanese = await japaneseFor(reply, route, translateTts, signal, true)
      const generated = await synthesizeTts(spokenJapanese, { language: 'ja', mood, signal })
      const result = await playAudioBlob(generated.blob, { onLevel, onStart, onEnd })
      return {
        ...route,
        kind: 'tts',
        language: 'ja',
        spokenText: spokenJapanese,
        engine: generated.engine,
        ...result,
      }
    }

    // Long replies use deliberately conservative sequential chunks. We do NOT
    // pipeline/concurrently pre-render the next request yet: alpha.3 proved that
    // changing player lifetime and TTS scheduling at the same time is too risky
    // on WKWebView. Reliability first; latency optimisation can follow after
    // this path has passed physical-device testing.
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

    onEnd?.()
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
    onEnd?.()
    return { ...route, kind: 'text', played: false, error: error?.message || String(error) }
  }
}
