/* Deterministic local reactions for direct character taps.
   Every entry points to one of the bundled Amadeus reference OGG files, so
   touch feedback never depends on LLM output, network access or fuzzy text
   matching. */

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
  { voice: 'dont_call_me_like_that', text: '别那样叫我。', mood: 'ANGRY', expression: 'f03', motion: 'shake' },
]

const BODY_CALM = [
  { voice: 'i_guess', text: '也对呢。', mood: 'INDIFFERENT', expression: 'f01', motion: 'tap_body' },
  { voice: 'sounds_tough', text: '很辛苦呢。', mood: 'SIDE', expression: 'f02', motion: 'tap_body' },
  { voice: 'you_sure', text: '是这样啊。', mood: 'SIDED_WORRIED', expression: 'f02', motion: 'tap_body' },
  { voice: 'what_do_you_want', text: '需要帮助吗？', mood: 'HAPPY', expression: 'f04', motion: 'tap_body' },
]

const BODY_ANNOYED = [
  { voice: 'daga_kotowaru', text: '但是我拒绝。', mood: 'ANNOYED', expression: 'f03', motion: 'shake' },
  { voice: 'this_guy_hopeless', text: '这家伙没救了，必须要做点什么。', mood: 'DISAPPOINTED', expression: 'f02', motion: 'shake' },
  { voice: 'pervert_confirmed', text: '变态确定。', mood: 'PISSED', expression: 'f03', motion: 'shake' },
  { voice: 'pervert_idot_wanttodie', text: '你个变态！你是笨蛋？想死吗？！', mood: 'ANGRY', expression: 'f03', motion: 'shake' },
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
    // Repeated body pokes escalate naturally instead of immediately jumping
    // to the strongest reaction.
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
