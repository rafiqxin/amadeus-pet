/* Semantic reaction planner. Keeps LLM text generation separate from rendering,
   then maps the generated reply to a stable Live2D expression/motion contract. */

const EMOTION_MAP = {
  normal:       { expression: 'f01', motion: null },
  happy:        { expression: 'f04', motion: 'flickhead' },
  pleasant:     { expression: 'f04', motion: 'flickhead' },
  amused:       { expression: 'f04', motion: 'flickhead' },
  embarrassed:  { expression: 'f04', motion: 'pinchin' },
  blush:        { expression: 'f04', motion: 'pinchin' },
  worried:      { expression: 'f02', motion: null },
  sad:          { expression: 'f02', motion: null },
  disappointed: { expression: 'f02', motion: 'shake' },
  annoyed:      { expression: 'f03', motion: 'shake' },
  angry:        { expression: 'f03', motion: 'shake' },
  pissed:       { expression: 'f03', motion: 'shake' },
  side:         { expression: 'f02', motion: null },
}

function includesAny(text, words) {
  const s = String(text || '').toLowerCase()
  return words.some((w) => s.includes(w))
}

export function inferEmotion(text, hint = 'normal') {
  const s = String(text || '')
  if (includesAny(s, ['变态', '笨蛋', '想死', '别那样叫', '别这么叫', '拒绝', '烦', '生气', '胡说', '无稽'])) return 'angry'
  if (includesAny(s, ['抱歉', '对不起', '难过', '遗憾'])) return 'sad'
  if (includesAny(s, ['担心', '小心', '没事吧', '为什么？', '怎么了'])) return 'worried'
  if (includesAny(s, ['呵呵', '嘿嘿', '不错', '干得漂亮', '很好', '开心', '请多指教'])) return 'happy'
  if (includesAny(s, ['什、什么', '才不是', '没有啦', '害羞', '别看'])) return 'embarrassed'
  if (includesAny(s, ['没救了', '无聊', '毫无意义'])) return 'disappointed'
  return hint || 'normal'
}

export function planReaction(text, { mood = 'normal', voiceMatch = null } = {}) {
  const sourceMood = voiceMatch?.mood ? String(voiceMatch.mood).toLowerCase() : null
  const emotion = inferEmotion(text, sourceMood || mood)
  const visual = EMOTION_MAP[emotion] || EMOTION_MAP.normal
  return {
    emotion,
    expression: visual.expression,
    motion: visual.motion,
    voiceId: voiceMatch?.file || null,
  }
}

export function applyReaction(pet, reaction, { playMotion = true } = {}) {
  if (!pet || !reaction) return
  try { pet.setExpression?.(reaction.expression || 'f01') } catch {}
  if (playMotion && reaction.motion) {
    try { pet.startRandomMotion?.(reaction.motion, 3) } catch {}
  }
}
