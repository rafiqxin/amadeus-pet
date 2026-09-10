/* Deterministic local reactions for direct character taps.
   All 45 bundled Amadeus reference OGG clips participate in a shuffle-bag.
   One complete bag is exhausted before any clip can repeat, and a bag boundary
   is guarded against repeating the immediately previous voice.

   Touch location controls only the visual motion. It must never silently shrink
   the audio selection to a 3-5 line area-specific pool. */

const REACTIONS = [
  { voice: 'hello', text: '你好。', mood: 'HAPPY' },
  { voice: 'daga_kotowaru', text: '但是我拒绝。', mood: 'ANNOYED' },
  { voice: 'devilish_pervert', text: '没想到你竟然这么变态，我看错你了。', mood: 'ANGRY' },
  { voice: 'i_guess', text: '也对呢。', mood: 'INDIFFERENT' },
  { voice: 'nice', text: '干得漂亮。', mood: 'WINKING' },
  { voice: 'pervert_confirmed', text: '变态确定。', mood: 'PISSED' },
  { voice: 'sorry', text: '抱歉。', mood: 'SAD' },
  { voice: 'sounds_tough', text: '很辛苦呢。', mood: 'SIDE' },
  { voice: 'this_guy_hopeless', text: '这家伙没救了，必须要做点什么。', mood: 'DISAPPOINTED' },
  { voice: 'christina', text: '克莉斯缇娜？', mood: 'ANNOYED' },
  { voice: 'gah', text: '咔。', mood: 'INDIFFERENT' },
  { voice: 'dont_add_tina', text: '缇娜禁止！', mood: 'ANGRY' },
  { voice: 'why_christina', text: '我很好奇为什么我叫克莉斯缇娜？', mood: 'PISSED' },
  { voice: 'who_the_hell_christina', text: '谁是克莉斯缇娜啊？', mood: 'PISSED' },
  { voice: 'ask_me_whatever', text: '尽管问我吧，我会尽力回答你的。', mood: 'HAPPY' },
  { voice: 'could_i_help', text: '那个，需要帮助吗？', mood: 'HAPPY' },
  { voice: 'what_do_you_want', text: '需要帮助吗？', mood: 'HAPPY' },
  { voice: 'what_is_it', text: '怎么了？', mood: 'HAPPY' },
  { voice: 'heheh', text: '呵呵呵。', mood: 'WINKING' },
  { voice: 'huh_why_say', text: '哎？为什么？', mood: 'SIDED_WORRIED' },
  { voice: 'you_sure', text: '是这样啊。', mood: 'SIDED_WORRIED' },
  { voice: 'nice_to_meet_okabe', text: '冈部伦太郎，初次见面，我是牧瀬红莉栖，请多指教。', mood: 'SIDED_PLEASANT' },
  { voice: 'look_forward_to_working', text: '请多指教。', mood: 'HAPPY' },
  { voice: 'senpai_question', text: '那么前辈，我能再问一个问题吗？', mood: 'SIDE' },
  { voice: 'senpai_questionmark', text: '前辈？', mood: 'SIDE' },
  { voice: 'senpai_what_we_talkin', text: '呐，前辈。关于刚才那件事…', mood: 'SIDED_WORRIED' },
  { voice: 'senpai_who_is_this', text: '嗯，前辈，那边的那个人是？', mood: 'NORMAL' },
  { voice: 'senpai_please_dont_tell', text: '前辈，拜托请不要告诉其他人。', mood: 'BLUSH' },
  { voice: 'still_not_happy', text: '我对这件事不是很满意。', mood: 'BLUSH' },
  { voice: 'dont_call_me_like_that', text: '别那样叫我。', mood: 'ANGRY' },
  { voice: 'tm_nonsense', text: '毫无意义呢。', mood: 'DISAPPOINTED' },
  { voice: 'tm_scientist_no_evidence', text: '那是因为科学家还没发现问题的关键所在。', mood: 'NORMAL' },
  { voice: 'tm_we_dont_know', text: '但是，也并不是说完全不可能，对吧？', mood: 'NORMAL' },
  { voice: 'tm_you_said', text: '你指的是时间机器？', mood: 'SIDED_WORRIED' },
  { voice: 'humans_software', text: '人们不是也会把自己比作成由硬件和软件组合起来的吗？', mood: 'NORMAL' },
  { voice: 'memory_complex', text: '但是记忆数据和其他数据不同，是很复杂的。', mood: 'INDIFFERENT' },
  { voice: 'secret_diary', text: '也就是说，是秘密日记。', mood: 'INDIFFERENT' },
  { voice: 'modifying_memories_impossible', text: '修改我的记忆？理论上是可行的。', mood: 'INDIFFERENT' },
  { voice: 'memories_christina', text: '举例来说，可以做到让我认为自己的名字是克莉斯缇娜。', mood: 'WINKING' },
  { voice: 'gah_extended', text: '咔、啊、嗯嗯嗯…', mood: 'BLUSH' },
  { voice: 'should_christina', text: '还是说，我称呼自己为克莉斯缇娜更好一点？', mood: 'PISSED' },
  { voice: 'ok', text: '什么？', mood: 'HAPPY' },
  { voice: 'tm_not_possible', text: '有点道理，从理论上来讲时间机器也不是不可能的。', mood: 'DISAPPOINTED' },
  { voice: 'pleased_to_meet_you', text: '说起来，还没正式自我介绍过。我叫牧瀬红莉栖，初次见面，请多关照。', mood: 'SIDED_PLEASANT' },
  { voice: 'pervert_idot_wanttodie', text: '你个变态！你是笨蛋？想死吗？！', mood: 'ANGRY' },
]

export const TOUCH_REACTION_VOICE_IDS = REACTIONS.map((r) => r.voice)

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
  bag = shuffle(REACTIONS)
  // We pop from the end, so protect the first voice of a new round from being
  // the same as the last voice of the previous round.
  if (bag.length > 1 && bag[bag.length - 1].voice === lastVoice) {
    ;[bag[bag.length - 1], bag[bag.length - 2]] = [bag[bag.length - 2], bag[bag.length - 1]]
  }
}

function pickReaction() {
  if (!bag.length) refillBag()
  const result = bag.pop()
  lastVoice = result.voice
  return result
}

function expressionForMood(mood) {
  if (['ANGRY', 'PISSED', 'ANNOYED'].includes(mood)) return 'f03'
  if (['HAPPY', 'WINKING', 'SIDED_PLEASANT', 'BLUSH'].includes(mood)) return 'f04'
  if (['SAD', 'SIDE', 'SIDED_WORRIED', 'DISAPPOINTED'].includes(mood)) return 'f02'
  return 'f01'
}

function motionForArea(area, mood) {
  if (area.includes('head')) return 'flick_head'
  if (area.includes('mouth') || area.includes('face')) return 'pinch_in'
  if (['ANGRY', 'PISSED', 'ANNOYED'].includes(mood)) return 'shake'
  return 'tap_body'
}

export function nextTouchReaction(area = 'body') {
  totalPokes += 1
  const key = String(area || 'body').toLowerCase()
  bodyPokes = key.includes('body') ? bodyPokes + 1 : 0

  const reaction = pickReaction()
  return {
    ...reaction,
    expression: expressionForMood(reaction.mood),
    motion: motionForArea(key, reaction.mood),
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
