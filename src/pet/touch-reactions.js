/* Deterministic local reactions for direct character taps.
   Touch reactions intentionally use only the 48 kHz mono reference cohort.
   The original voice pack mixes several source/mastering groups (22.05 kHz
   stereo, 44.1 kHz mono, 48 kHz mono); mixing those inside one touch session
   made Kurisu sound like two different voices.  Other clips remain bundled for
   explicit/reference playback, but direct taps stay on this consistent cohort. */

const HEAD = [
  { voice: 'what_is_it', text: '怎么了？', mood: 'HAPPY', expression: 'f04', motion: 'flick_head' },
  { voice: 'could_i_help', text: '那个，需要帮助吗？', mood: 'HAPPY', expression: 'f04', motion: 'flick_head' },
  { voice: 'heheh', text: '呵呵呵。', mood: 'WINKING', expression: 'f04', motion: 'flick_head' },
  { voice: 'huh_why_say', text: '哎？为什么？', mood: 'SIDED_WORRIED', expression: 'f02', motion: 'flick_head' },
  { voice: 'senpai_questionmark', text: '前辈？', mood: 'SIDE', expression: 'f02', motion: 'flick_head' },
]

const MOUTH = [
  { voice: 'gah', text: '咔。', mood: 'INDIFFERENT', expression: 'f01', motion: 'pinch_in' },
  { voice: 'gah_extended', text: '咔、啊、嗯嗯嗯…', mood: 'BLUSH', expression: 'f04', motion: 'pinch_in' },
  { voice: 'still_not_happy', text: '我对这件事不是很满意。', mood: 'BLUSH', expression: 'f04', motion: 'pinch_in' },
]

const BODY_CALM = [
  { voice: 'you_sure', text: '是这样啊。', mood: 'SIDED_WORRIED', expression: 'f02', motion: 'tap_body' },
  { voice: 'what_do_you_want', text: '需要帮助吗？', mood: 'HAPPY', expression: 'f04', motion: 'tap_body' },
  { voice: 'senpai_question', text: '那么前辈，我能再问一个问题吗？', mood: 'SIDE', expression: 'f02', motion: 'tap_body' },
  { voice: 'look_forward_to_working', text: '请多指教。', mood: 'HAPPY', expression: 'f04', motion: 'tap_body' },
]

const BODY_ANNOYED = [
  { voice: 'still_not_happy', text: '我对这件事不是很满意。', mood: 'ANNOYED', expression: 'f03', motion: 'shake' },
  { voice: 'tm_nonsense', text: '毫无意义呢。', mood: 'DISAPPOINTED', expression: 'f02', motion: 'shake' },
  { voice: 'huh_why_say', text: '哎？为什么？', mood: 'PISSED', expression: 'f03', motion: 'shake' },
]

const ALL = [...HEAD, ...MOUTH, ...BODY_CALM, ...BODY_ANNOYED]
export const TOUCH_REACTION_VOICE_IDS = [...new Set(ALL.map((r) => r.voice))]

let totalPokes = 0
let bodyPokes = 0
let lastVoice = ''

function pick(pool) {
  if (!pool.length) return null
  const candidates = pool.length > 1 ? pool.filter((r) => r.voice !== lastVoice) : pool
  const source = candidates.length ? candidates : pool
  const result = source[Math.floor(Math.random() * source.length)]
  lastVoice = result.voice
  return result
}

export function nextTouchReaction(area = 'body') {
  totalPokes += 1
  const key = String(area || 'body').toLowerCase()

  let pool
  if (key.includes('head')) {
    bodyPokes = 0
    pool = HEAD
  } else if (key.includes('mouth') || key.includes('face')) {
    bodyPokes = 0
    pool = MOUTH
  } else {
    bodyPokes += 1
    const annoyed = bodyPokes >= 3 && (bodyPokes % 3 === 0 || Math.random() < 0.35)
    pool = annoyed ? BODY_ANNOYED : BODY_CALM
  }

  const reaction = pick(pool) || BODY_CALM[0]
  return { ...reaction, area: key, totalPokes, bodyPokes }
}

export function resetTouchReactions() {
  totalPokes = 0
  bodyPokes = 0
  lastVoice = ''
}
