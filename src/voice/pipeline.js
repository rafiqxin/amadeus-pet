import { getVoiceCatalogEntry } from './catalog.js'
import { localVoiceDecision, finalizeVoiceRoute } from './semantic-router.js'
import { playReferenceVoice, playAudioBlob, stopVoicePlayback } from './player.js'
import { synthesizeTts, ttsConfigured } from './tts-client.js'

function containsJapanese(text) {
  return /[\u3040-\u30ff]/.test(String(text || ''))
}

export async function routeAndSpeak(text, {
  classify = null,
  translateTts = null,
  mood = 'normal',
  onLevel = null,
  onEnd = null,
  signal = null,
} = {}) {
  const reply = String(text || '').trim()
  if (!reply) return { kind: 'silent', played: false }
  stopVoicePlayback()

  const local = localVoiceDecision(reply, 0.92)
  let llmDecision = null
  if (!local && typeof classify === 'function') {
    try { llmDecision = await classify(reply, signal) } catch {}
  }
  const route = local ? { kind: 'ogg', ...local } : finalizeVoiceRoute(reply, llmDecision, { localThreshold: 0.92, llmThreshold: 0.86 })

  if (route.kind === 'ogg' && route.id && getVoiceCatalogEntry(route.id)) {
    const result = await playReferenceVoice(route.id, { onLevel, onEnd })
    return { ...route, ...result }
  }

  if (ttsConfigured()) {
    try {
      // UI and conversation stay Chinese. Only the speech payload becomes Japanese.
      let spokenJapanese = String(route.ttsJa || '').trim()
      if (!spokenJapanese && containsJapanese(reply)) spokenJapanese = reply
      if (!spokenJapanese && typeof translateTts === 'function') spokenJapanese = String(await translateTts(reply, signal) || '').trim()
      if (!spokenJapanese) throw new Error('Japanese TTS translation unavailable')

      const generated = await synthesizeTts(spokenJapanese, { language: 'ja', mood, signal })
      const result = await playAudioBlob(generated.blob, { onLevel, onEnd })
      return { ...route, kind: 'tts', language: 'ja', spokenText: spokenJapanese, engine: generated.engine, ...result }
    } catch (error) {
      onLevel?.(0); onEnd?.()
      return { ...route, kind: 'text', played: false, error: error?.message || String(error) }
    }
  }

  onLevel?.(0); onEnd?.()
  return { ...route, kind: 'text', played: false, error: 'TTS not configured' }
}
