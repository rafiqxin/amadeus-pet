/* Voice output.
   Desktop keeps the system Web Speech fallback.
   iOS CALL preview uses the 45 original Amadeus reference OGG clips only when
   the generated reply is close enough to a known subtitle; otherwise it stays
   text-only. This deliberately prefers false negatives over wrong voice clips. */

let voices = []
let ready = false
let activeAudio = null

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

const REF = [
  ['hello','HAPPY','Hello.','你好。'],
  ['daga_kotowaru','ANNOYED','But I refuse.','但是我拒绝。'],
  ['devilish_pervert','ANGRY','I never thought you were such a devilish pervert. I guess I misjudged you.','没想到你竟然这么变态，我看错你了。'],
  ['i_guess','INDIFFERENT','I guess.','也对呢。'],
  ['nice','WINKING','Nice.','干得漂亮。'],
  ['pervert_confirmed','PISSED','PERVERT CONFIRMED.','变态确定。'],
  ['sorry','SAD','Sorry.','抱歉。'],
  ['sounds_tough','SIDE','Sounds tough.','很辛苦呢。'],
  ['this_guy_hopeless','DISAPPOINTED','This guy is hopeless, better do something quick.','这家伙没救了，必须要做点什么。'],
  ['christina','ANNOYED','Christina?','克莉斯缇娜？'],
  ['gah','INDIFFERENT','Gah.','咔。'],
  ['dont_add_tina','ANGRY','Stop adding -tina!','缇娜禁止！'],
  ['why_christina','PISSED','I am worried about it. Why am I Christina?','我很好奇为什么我叫克莉斯缇娜？'],
  ['who_the_hell_christina','PISSED','Who the hell is Christina?','谁是克莉斯缇娜啊？'],
  ['ask_me_whatever','HAPPY',"Ask me whatever you want. I'll answer anything I can.",'尽管问我吧，我会尽力回答你的。'],
  ['could_i_help','HAPPY','Um, could I help you with that?','那个，需要帮助吗？'],
  ['what_do_you_want','HAPPY','What do you want?','需要帮助吗？'],
  ['what_is_it','HAPPY','What is it?','怎么了？'],
  ['heheh','WINKING','Hehehe.','呵呵呵。'],
  ['huh_why_say','SIDED_WORRIED','Huh? Why do you say that?','哎？为什么？'],
  ['you_sure','SIDED_WORRIED','You sure?','是这样啊。'],
  ['nice_to_meet_okabe','SIDED_PLEASANT',"Nice to meet you, Okabe Rintaro. I'm Makise Kurisu.",'冈部伦太郎，初次见面，我是牧瀬红莉栖，请多指教。'],
  ['look_forward_to_working','HAPPY','I look forward to working with you.','请多指教。'],
  ['senpai_question','SIDE','Anyway, can I ask a question?','那么前辈，我能再问一个问题吗？'],
  ['senpai_questionmark','SIDE','Um… Senpai? Excuse me.','前辈？'],
  ['senpai_what_we_talkin','SIDED_WORRIED','Hey Senpai, about what we were just talking about…','呐，前辈。关于刚才那件事…'],
  ['senpai_who_is_this','NORMAL','Uh, who is this?','嗯，前辈，那边的那个人是？'],
  ['senpai_please_dont_tell','BLUSH',"Senpai, please, don't tell the others…",'前辈，拜托请不要告诉其他人。'],
  ['still_not_happy','BLUSH',"I'm still not happy about that.",'我对这件事不是很满意。'],
  ['dont_call_me_like_that','ANGRY',"Don't call me like that!",'别那样叫我。'],
  ['tm_nonsense','DISAPPOINTED','That is pure nonsense.','毫无意义呢。'],
  ['tm_scientist_no_evidence','NORMAL',"That's probably because scientists haven't discovered something important yet.",'那是因为科学家还没发现问题的关键所在。'],
  ['tm_we_dont_know','NORMAL',"But we don't know for sure that it's impossible, I guess.",'但是，也并不是说完全不可能，对吧？'],
  ['tm_you_said','SIDED_WORRIED','A time machine, you said?','你指的是时间机器？'],
  ['humans_software','NORMAL','Even humans speak of themselves as a combination of hardware and software, right?','人们不是也会把自己比作成由硬件和软件组合起来的吗？'],
  ['memory_complex','INDIFFERENT',"But memory data isn't like normal data. It's much more complex.",'但是记忆数据和其他数据不同，是很复杂的。'],
  ['secret_diary','INDIFFERENT','I keep a secret diary.','也就是说，是秘密日记。'],
  ['modifying_memories_impossible','INDIFFERENT',"Modifying my memories? It's theoretically possible.",'修改我的记忆？理论上是可行的。'],
  ['memories_christina','WINKING','For example, it would be possible to make me think my name was Christina.','举例来说，可以做到让我认为自己的名字是克莉斯缇娜。'],
  ['gah_extended','BLUSH','Gah. Ah… Aaaaah.','咔、啊、嗯嗯嗯…'],
  ['should_christina','PISSED','Or should I have introduced myself with, "It is Christina"?','还是说，我称呼自己为克莉斯缇娜更好一点？'],
  ['ok','HAPPY','OK.','什么？'],
  ['tm_not_possible','DISAPPOINTED',"Let's see… My conclusion is that it's not possible.",'有点道理，从理论上来讲时间机器也不是不可能的。'],
  ['pleased_to_meet_you','SIDED_PLEASANT',"I'm Makise Kurisu, pleased to meet you.",'说起来，还没正式自我介绍过。我叫牧瀬红莉栖，初次见面，请多关照。'],
  ['pervert_idot_wanttodie','ANGRY','You pervert! Are you an idiot!? Do you wanna die?!','你个变态！你是笨蛋？想死吗？！'],
].map(([file,mood,en,zh]) => ({ file, mood, en, zh }))

const HINTS = {
  hello: ['你好','嗨','hello','hi','早上好','下午好','晚上好'],
  daga_kotowaru: ['拒绝','不答应','不要'],
  devilish_pervert: ['变态','看错你'],
  pervert_confirmed: ['变态确定','果然是变态'],
  sorry: ['抱歉','对不起','sorry'],
  sounds_tough: ['辛苦','不容易','挺难'],
  this_guy_hopeless: ['没救了','无可救药'],
  christina: ['克莉斯缇娜','克里斯蒂娜','christina'],
  dont_add_tina: ['缇娜禁止','别加缇娜'],
  why_christina: ['为什么','克莉斯缇娜'],
  who_the_hell_christina: ['谁是','克莉斯缇娜'],
  ask_me_whatever: ['尽管问','随便问','问我吧'],
  could_i_help: ['需要帮助','帮你'],
  what_is_it: ['怎么了','什么事'],
  heheh: ['呵呵','嘿嘿'],
  huh_why_say: ['为什么这么说','为什么？'],
  nice_to_meet_okabe: ['冈部伦太郎','初次见面'],
  look_forward_to_working: ['请多指教','合作愉快'],
  senpai_question: ['前辈','问一个问题'],
  senpai_questionmark: ['前辈？'],
  senpai_please_dont_tell: ['前辈','不要告诉','保密'],
  still_not_happy: ['不满意','不高兴'],
  dont_call_me_like_that: ['别那样叫我','别这么叫我','不要这样叫我'],
  tm_nonsense: ['毫无意义','胡说','无稽之谈'],
  tm_scientist_no_evidence: ['科学家','还没发现','关键'],
  tm_we_dont_know: ['并不是完全不可能','不能确定不可能'],
  tm_you_said: ['时间机器'],
  humans_software: ['硬件','软件','人类'],
  memory_complex: ['记忆数据','复杂','普通数据'],
  secret_diary: ['秘密日记','日记'],
  modifying_memories_impossible: ['修改记忆','理论上','可行'],
  memories_christina: ['记忆','名字','克莉斯缇娜'],
  should_christina: ['称呼自己','克莉斯缇娜'],
  pleased_to_meet_you: ['牧瀬红莉栖','初次见面','请多关照'],
  pervert_idot_wanttodie: ['变态','笨蛋','想死'],
}

function refreshVoices() {
  try {
    if (!window.speechSynthesis) return
    voices = window.speechSynthesis.getVoices()
    ready = voices.length > 0
  } catch { ready = false }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices()
  window.speechSynthesis.onvoiceschanged = refreshVoices
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(s) {
  const n = norm(s)
  if (n.length < 2) return [n]
  const out = []
  for (let i = 0; i < n.length - 1; i++) out.push(n.slice(i, i + 2))
  return out
}

function dice(a, b) {
  const aa = bigrams(a), bb = bigrams(b)
  if (!aa.length || !bb.length) return 0
  const bag = new Map()
  for (const x of aa) bag.set(x, (bag.get(x) || 0) + 1)
  let hit = 0
  for (const x of bb) {
    const n = bag.get(x) || 0
    if (n > 0) { hit++; bag.set(x, n - 1) }
  }
  return (2 * hit) / (aa.length + bb.length)
}

export function matchReferenceVoice(text) {
  const raw = String(text || '')
  const compact = norm(raw)
  if (!compact) return null

  let best = null
  let bestScore = 0
  for (const line of REF) {
    const en = norm(line.en), zh = norm(line.zh)
    let score = Math.max(dice(raw, line.en), dice(raw, line.zh))
    if ((en.length >= 3 && compact.includes(en)) || (zh.length >= 3 && compact.includes(zh))) score = 1

    const hints = HINTS[line.file] || []
    if (hints.length) {
      const hits = hints.filter((h) => compact.includes(norm(h))).length
      if (hits >= 2) score = Math.max(score, 0.86)
      else if (hits === 1 && hints.length === 1) score = Math.max(score, 0.82)
    }

    if (score > bestScore) { bestScore = score; best = line }
  }

  // Keep matching conservative: a wrong character voice is worse than silence.
  return bestScore >= 0.72 ? { ...best, score: bestScore } : null
}

/** Estimate spoken duration in ms (fallback for lip-sync timing). */
export function estimateDuration(text, rate = 1.05) {
  const cjk = (String(text).match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length
  const other = String(text).length - cjk
  return Math.max(1200, (cjk * 260 + other * 90) / rate)
}

function playReference(line, { onBoundary = null, onEnd = null } = {}) {
  try {
    activeAudio?.pause()
    const audio = new Audio(`./Resources/amadeus-voices/${line.file}.ogg`)
    activeAudio = audio
    audio.volume = 0.95
    const pulse = setInterval(() => onBoundary?.(0, 0), 140)
    const finish = () => {
      clearInterval(pulse)
      if (activeAudio === audio) activeAudio = null
      onEnd?.()
    }
    audio.onended = finish
    audio.onerror = finish
    audio.play().catch(finish)
    return { duration: estimateDuration(line.zh), matched: line, played: true }
  } catch {
    onEnd?.()
    return { duration: estimateDuration(line.zh), matched: line, played: false }
  }
}

export function speak(text, {
  enabled = true,
  rate = 1.05,
  pitch = 1.05,
  onBoundary = null,
  onEnd = null,
} = {}) {
  if (!enabled) {
    onEnd?.()
    return { duration: estimateDuration(text, rate), played: false }
  }

  if (isIOS) {
    const match = matchReferenceVoice(text)
    if (!match) {
      onEnd?.()
      return { duration: 0, played: false, matched: null }
    }
    return playReference(match, { onBoundary, onEnd })
  }

  if (!ready) {
    onEnd?.()
    return { duration: estimateDuration(text, rate), played: false }
  }
  try {
    const u = new SpeechSynthesisUtterance(text)
    const zh = voices.find((v) => v.lang && v.lang.startsWith('zh'))
    if (zh) u.voice = zh
    u.rate = rate
    u.pitch = pitch
    u.volume = 0.9
    if (onBoundary) u.onboundary = (e) => onBoundary(e.charIndex, e.charLength)
    u.onend = () => onEnd?.()
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    return { duration: estimateDuration(text, rate), played: true }
  } catch {
    onEnd?.()
    return { duration: estimateDuration(text, rate), played: false }
  }
}

export function voiceAvailable() {
  // iOS always has HTMLAudioElement; actual clips are bundled by the IPA build.
  return isIOS || ready
}
