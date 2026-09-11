import { getVoiceCatalogEntry } from './catalog.js'
import { localVoiceDecision, finalizeVoiceRoute } from './semantic-router.js'
import { playReferenceVoice, playAudioBlob, stopVoicePlayback } from './player.js'
import { synthesizeTts, ttsConfigured } from './tts-client.js'

const LONG_REPLY_CLASSIFIER_LIMIT = 88
const TTS_SOURCE_CHUNK_CHARS = 56

function containsJapanese(text) {
  return /[\u3040-\u30ff]/.test(String(text || ''))
}

function splitOversizeUnit(unit, maxChars) {
  const out = []
  let rest = String(unit || '').trim()
  const softBreaks = ['，', '、', ',', '：', ':', '（', '(', ' ']
  while (rest.length > maxChars) {
    const minCut = Math.max(16, Math.floor(maxChars * 0.55))
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

/**
 * Split the visible Chinese reply, not the generated WAV.  GPT-SoVITS can split
 * internally, but it only returns after the whole request is rendered.  On iOS
 * that means a long silence followed by a large base64 bridge payload.  Keeping
 * requests sentence-sized lets the first line speak sooner and bounds every WAV.
 */
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

async function playBlobUntilEnd(blob, opts = {}) {
  let finish
  const ended = new Promise((resolve) => { finish = resolve })
  const result = await playAudioBlob(blob, {
    ...opts,
    onEnd: (meta) => finish(meta || {}),
  })
  if (!result.played) {
    finish({ failed: true })
    return { ...result, endMeta: { failed: true } }
  }
  const endMeta = await ended
  return { ...result, endMeta }
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
  // A multi-sentence technical answer cannot realistically be one of the 45
  // short reference clips. Skipping the classifier here removes an otherwise
  // wasted LLM round-trip before TTS can even begin.
  if (!local && reply.length <= LONG_REPLY_CLASSIFIER_LIMIT && typeof classify === 'function') {
    try { llmDecision = await classify(reply, signal) } catch {}
  }
  const route = local ? { kind: 'ogg', ...local } : finalizeVoiceRoute(reply, llmDecision, { localThreshold: 0.92, llmThreshold: 0.86 })

  if (route.kind === 'ogg' && route.id && getVoiceCatalogEntry(route.id)) {
    const result = await playReferenceVoice(route.id, { onLevel, onStart, onEnd })
    return { ...route, ...result }
  }

  if (ttsConfigured()) {
    try {
      const sourceChunks = splitReplyForTts(reply)
      const segmented = sourceChunks.length > 1

      const prepare = async (sourceText, index) => {
        let spokenJapanese = ''
        // For short replies the semantic classifier may already have produced a
        // high-quality Japanese line. Long replies are translated per visible
        // chunk so subtitles and speech stay aligned sentence-by-sentence.
        if (!segmented && route.ttsJa) spokenJapanese = String(route.ttsJa).trim()
        if (!spokenJapanese && containsJapanese(sourceText)) spokenJapanese = sourceText
        if (!spokenJapanese && typeof translateTts === 'function') {
          spokenJapanese = String(await translateTts(sourceText, signal) || '').trim()
        }
        if (!spokenJapanese) throw new Error(`Japanese TTS translation unavailable for segment ${index + 1}`)
        const generated = await synthesizeTts(spokenJapanese, { language: 'ja', mood, signal })
        return { sourceText, spokenJapanese, generated, index }
      }

      let prepared = await prepare(sourceChunks[0], 0)
      const spokenParts = []
      let engine = prepared.generated.engine
      let firstStarted = false

      for (let index = 0; index < sourceChunks.length; index += 1) {
        // Render the next chunk while the current WAV is already playing. The
        // server is single-inference, but playback is local, so these can overlap.
        const nextPromise = index + 1 < sourceChunks.length
          ? prepare(sourceChunks[index + 1], index + 1)
              .then((value) => ({ value }), (error) => ({ error }))
          : null

        const current = prepared
        const result = await playBlobUntilEnd(current.generated.blob, {
          onLevel,
          onStart: (meta = {}) => {
            const segmentMeta = {
              index,
              total: sourceChunks.length,
              text: current.sourceText,
              spokenText: current.spokenJapanese,
              durationSec: meta.durationSec || 0,
              segmented,
            }
            onSegmentStart?.(segmentMeta)
            if (!firstStarted) {
              firstStarted = true
              onStart?.(segmentMeta)
            }
          },
        })
        if (!result.played) throw result.error || new Error(`TTS playback failed at segment ${index + 1}`)

        spokenParts.push(current.spokenJapanese)
        onSegmentEnd?.({
          index,
          total: sourceChunks.length,
          text: current.sourceText,
          spokenText: current.spokenJapanese,
          segmented,
          interrupted: !!result.endMeta?.interrupted,
        })
        if (result.endMeta?.interrupted) {
          onEnd?.({ interrupted: true })
          return {
            ...route,
            kind: 'tts',
            language: 'ja',
            spokenText: spokenParts.join(' '),
            engine,
            played: true,
            interrupted: true,
            segmented,
            segmentCount: sourceChunks.length,
          }
        }

        if (nextPromise) {
          const next = await nextPromise
          if (next.error) throw next.error
          prepared = next.value
          engine = engine || prepared.generated.engine
        }
      }

      onEnd?.({ ended: true })
      return {
        ...route,
        kind: 'tts',
        language: 'ja',
        spokenText: spokenParts.join(' '),
        engine,
        played: true,
        segmented,
        segmentCount: sourceChunks.length,
      }
    } catch (error) {
      onLevel?.(0)
      onEnd?.({ failed: true })
      return { ...route, kind: 'text', played: false, error: error?.message || String(error) }
    }
  }

  onLevel?.(0)
  onEnd?.({ failed: true })
  return { ...route, kind: 'text', played: false, error: 'TTS not configured' }
}
