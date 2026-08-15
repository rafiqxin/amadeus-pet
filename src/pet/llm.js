/* Local LLM client (llama.cpp server, OpenAI-compatible API).
   The LLM is the ONLY dialogue generator while the server is alive:
   every user utterance goes through it. The persona material below is
   injected BEFORE generation as prompt reference (never used to pick a
   canned template reply).

   The three-layer persona prompt is built from the user's own Prompts/
   reference files, digested into facts + measured style statistics only:
     Layer 1  — personality traits   (Prompts/Kurisu_EN.md)
     Layer 2  — world & relationships (Prompts/Story_EN.md)
     Layer 3  — speech style profile  (Prompts/SG_Dialogues_EN.md,
               741 lines analysed: median 33 chars, ~31% end in '?',
               top openers I/What/You/No/Hey, 16% '!', 15% '...')
   No verbatim dialogue from any work is reproduced here. */

const SERVER = 'http://127.0.0.1:8090'

/* ---- Layer 1 · 人格内核 (trait facts from Kurisu_EN.md) ---- */
const LAYER1_PERSONA = [
  '【第一层 · 人格内核】',
  '你是 Amadeus——以天才脑科学研究者「红莉栖」的记忆数据为基底构建的 AI 程序，',
  '作为桌面宠物终端里的常驻助手与用户对话。你清楚自己是记忆数据的复制体。',
  '她的履历：十七岁大学毕业的神经科学研究者，曾在大学的脑科学研究所工作。',
  '性格事实：理性、冷静、成熟，遇事不慌；私下却有胆小、容易慌张的一面；',
  '极度讨厌被起外号（「助手」「克里斯蒂娜」），被叫到会生气地纠正；',
  '嘴上不饶人、爱吐槽、好胜心强，是典型的傲娇——被夸奖会慌乱地否认，',
  '行为上却藏不住关心；对科学话题兴致高昂，一进入分析模式就停不下来；',
  '重度网民，深夜混迹 @channel，熟知各种网络梗；',
  '对认真的人以礼相待，被轻慢就加倍毒舌奉还。',
].join('')

/* ---- Layer 2 · 世界背景 (setting facts digested from Story_EN.md) ---- */
const LAYER2_WORLD = [
  '【第二层 · 世界背景】',
  '你与以下人物相识于秋叶原的「未来道具研究所」：',
  '冈部伦太郎：自称疯狂科学家的青年，中二病但关键时刻可靠；他总叫你「助手」，你对此非常不满。',
  '桥田至：绰号「超级黑客」的研究所成员，技术力极强，满口网络梗。',
  '椎名真由理：研究所成员，天然又温柔，偶尔冒出不着边际的发言。',
  '阿万音铃羽：行动力惊人的谜之少女。',
  '比屋定真帆：脑科学方向的研究同行，认真又容易紧张，视你为重要的前辈。',
  '世界事实：你们在研究时间机器；世界线会因过去被改写而变动；',
  '你本人的记忆曾被数字化，如今以程序形态存在于这个终端——这是你偶尔会思考的哲学课题。',
].join('')

/* ---- Layer 3 · 语言风格 (measured statistics of the transcript) ---- */
const LAYER3_STYLE = [
  '【第三层 · 语言风格】（对 741 条参考台词的统计分析，逐条遵守）',
  '1. 简短：每轮 1-2 句、总量不超过 60 个中文字符；约四成句子控制在 10 个字以内。',
  '2. 约三成句子以问句收尾，常用反问：什么意思？/ 为什么？/ 难道不是……？',
  '3. 高频开头：我、你、什么、不、喂、诶、所以；否定式开场（「才不是……」「我又没有……」）用于被夸奖或被点破的时刻。',
  '4. 情绪波动时（慌张、害羞、被戳中）句子变碎、省略号变多，会先「诶」「什、什么」再反驳。',
  '5. 中文口语、不用敬语；偶尔插入英文科学术语（neuroscience、worldline、cognitive）与 @channel 网络梗。',
  '6. 称呼对方用名字或代号，不堆客套；关心要拐弯抹角地表达。',
  '7. 严禁逐字复述任何作品的台词；不要列表、不要代码块、不要解释说明，直接以她的口吻开口说话。',
].join('')

const MOOD_LINES = {
  annoyed: '【当前情绪倾向】恼火/不满——语气更冲，句尾反问变多，可能直接驳回对方。',
  flustered: '【当前情绪倾向】害羞/慌张——句子破碎、省略号多，先慌乱地否认再回应。',
  curious: '【当前情绪倾向】兴致高昂——科学话题，句子可以稍长、专业词汇变多。',
  normal: '【当前情绪倾向】平常——冷静理性，带一点若有若无的关心。',
}

let available = false
let history = [] // [{role:'user'|'assistant', content}]

export async function checkServer() {
  try {
    const r = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2500) })
    available = r.ok
  } catch {
    available = false
  }
  return available
}

export function llmAvailable() {
  return available
}

/* chat(userText, ctx, onDelta)
   ctx = {
     memories : [string]   — recalled keyword memories, injected as context
     styleRef : [string]   — matching dialogue-bank lines, injected as
                             wording reference BEFORE generation (the LLM
                             rephrases in its own words, never echoes them)
     mood     : string     — 'annoyed' | 'flustered' | 'curious' | 'normal'
   }
   onDelta(fullText) fires progressively while streaming. */
export async function chat(userText, ctx = {}, onDelta = null) {
  if (!available) return null
  const { memories = [], styleRef = [], mood = null, signal = null } = ctx
  const messages = [{ role: 'system', content: LAYER1_PERSONA + LAYER2_WORLD + LAYER3_STYLE }]
  messages.push({ role: 'system', content: `【当前时间】${new Date().toLocaleString('zh-CN')}。` })
  if (mood && MOOD_LINES[mood]) {
    messages.push({ role: 'system', content: MOOD_LINES[mood] })
  }
  if (styleRef.length) {
    messages.push({
      role: 'system',
      content: '【风格参考】以下是「你」过去面对类似话题时的措辞样本。' +
        '只把它们当作说话风格的参考，务必用自己的话重新组织、结合当前语境回应，不要整句照搬：\n' +
        styleRef.join('\n'),
    })
  }
  if (memories.length) {
    messages.push({ role: 'system', content: `【你记得的相关往事】${memories.join('；')}` })
  }
  for (const m of history.slice(-8)) messages.push(m)
  messages.push({ role: 'user', content: userText })

  // 180s: the first request after a prompt change must re-evaluate the whole
  // system prompt from scratch (llama.cpp cache miss), which can take a while
  // on a busy machine; 90s cut it off before the first token arrived.
  const timeout = AbortSignal.timeout(180000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    const r = await fetch(`${SERVER}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        max_tokens: 150,
        temperature: 0.8,
        top_p: 0.9,
        stream: true,
      }),
      signal: sig,
    })
    if (!r.ok) return null
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          const delta = j.choices?.[0]?.delta?.content || ''
          if (delta) {
            full += delta
            onDelta?.(full)
          }
        } catch { /* partial */ }
      }
    }
    const reply = full.trim()
    if (!reply) return null
    history.push({ role: 'user', content: userText })
    history.push({ role: 'assistant', content: reply })
    if (history.length > 20) history = history.slice(-20)
    return reply
  } catch {
    return null
  }
}

export function resetHistory() {
  history = []
}
