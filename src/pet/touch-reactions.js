/* Direct touch reactions use the complete 45-clip catalog as a shuffle-bag.
   Touch location affects only Live2D motion/expression; it never shrinks the
   voice pool. */
import { VOICE_CATALOG } from '../voice/catalog.js'

export const TOUCH_REACTION_VOICE_IDS = VOICE_CATALOG.map((item) => item.id)

let totalPokes = 0
let bodyPokes = 0
let lastVoice = ''
let bag = []

function shuffle(items) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
function refillBag() {
  bag = shuffle(VOICE_CATALOG)
  if (bag.length > 1 && bag[bag.length - 1].id === lastVoice) {
    ;[bag[bag.length - 1], bag[bag.length - 2]] = [bag[bag.length - 2], bag[bag.length - 1]]
  }
}
function pickReaction() {
  if (!bag.length) refillBag()
  const result = bag.pop()
  lastVoice = result.id
  return result
}
function expressionForMood(mood) {
  if (['angry', 'pissed', 'annoyed'].includes(mood)) return 'f03'
  if (['happy', 'winking', 'sided_pleasant', 'blush'].includes(mood)) return 'f04'
  if (['sad', 'side', 'sided_worried', 'disappointed'].includes(mood)) return 'f02'
  return 'f01'
}
function motionForArea(area, mood) {
  if (area.includes('head')) return 'flick_head'
  if (area.includes('mouth') || area.includes('face')) return 'pinch_in'
  if (['angry', 'pissed', 'annoyed'].includes(mood)) return 'shake'
  return 'tap_body'
}

export function nextTouchReaction(area = 'body') {
  totalPokes += 1
  const key = String(area || 'body').toLowerCase()
  bodyPokes = key.includes('body') ? bodyPokes + 1 : 0
  const entry = pickReaction()
  return {
    voice: entry.id,
    text: entry.zh,
    mood: entry.mood,
    expression: expressionForMood(entry.mood),
    motion: motionForArea(key, entry.mood),
    area: key,
    totalPokes,
    bodyPokes,
  }
}

export function resetTouchReactions() {
  totalPokes = 0
  bodyPokes = 0
  lastVoice = ''
  bag = []
}
