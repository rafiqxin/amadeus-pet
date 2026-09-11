# 人格与语音角色化指南

红莉栖"像不像她"由四层共同决定。本文说明每层在哪个文件、怎么改、以及改动会
影响什么。

> **素材说明**：`Prompts/` 与 `Dialogues/` 是参考素材，仅供你自行审阅与提炼风格。
> 仓库内的提示词均为原创统计与描述，不含逐字台词。使用前请自行确认你对素材拥有
> 使用权且用途合规。

---

## 0. 四层结构

| 层 | 文件 | 决定什么 |
| --- | --- | --- |
| ① 人格提示词 | `src/llm/client.js` → `SYSTEM_PROMPT` | 她说什么、用什么口吻、说多长 |
| ② 情绪映射 | `src/pet/reaction.js` → `EMOTION_MAP` / `inferEmotion` | 回复文本 → 情绪 → 表情与动作 |
| ③ 触摸台词 | `src/pet/touch-reactions.js` | 点击头部 / 嘴部 / 身体时说什么、放哪条原版语音 |
| ④ 语音路由 | `src/voice/catalog.js` + `semantic-router.js` | 这句话用原版 OGG 还是合成日语 |

另外 `src/llm/client.js` 的 `translateForKurisuTts` 有自己的 system prompt，
它决定"同一句话用日语怎么说"，属于语音层而非人格层。

---

## 1. 人格提示词（第一层）

打开 `src/llm/client.js`，`SYSTEM_PROMPT` 是一整段中文字符串。当前包含：

```
你是 AMA-DEUS 系统中的牧濑红莉栖。你是一个有连续人格、会记住上下文的对话角色…
人格原则：
- 逻辑严谨、聪明、带一点傲娇与吐槽，但不要每句话都刻意傲娇。
- 对技术和科学问题可以认真解释；对日常交流保持自然、简短、有反应。
- 不要声称自己是真人、原作官方系统或声优本人。
- 默认使用用户正在使用的语言；当前用户使用中文时，以自然中文回答。
- 回复优先 1~4 句，除非问题确实需要展开。
- 不要输出动作舞台说明，例如"（脸红）""*叹气*"；表情和动作由客户端单独驱动。
```

**改这里要注意两件事**：

1. **长度直接等于语音时长。** 语音按 ≈0.1 s/字符 合成，且客户端超时 300 s。
   一条 700 字的回复会产生约 124 秒的语音 —— 功能正常但体验很差。
   想让"回答可以长、朗读要短"，需要的是单独的口语摘要步骤，而不是调这里。
2. **最后一条不要删。** 舞台说明会被 TTS 当正文念出来。

`src/llm/client.js` 另有一条硬性处理：所有请求都附带 `NO_REASONING`
关闭推理。原因见 `docs/ARCHITECTURE.md` §8 —— 不关掉时翻译与分类会直接失败。

---

## 2. 情绪映射（第二层）

`src/pet/reaction.js` 有两张表：

```js
const EMOTION_MAP = {
  normal:       { expression: 'f01', motion: null },
  happy:        { expression: 'f04', motion: 'flick_head' },
  embarrassed:  { expression: 'f04', motion: 'pinch_in' },
  annoyed:      { expression: 'f03', motion: 'shake' },
  disappointed: { expression: 'f02', motion: 'shake' },
  // …
}
```

`inferEmotion(text, hint)` 先用关键词把回复归到某个情绪（"变态/笨蛋/想死"→`angry`，
"抱歉/对不起"→`sad`，等等），没命中就用 LLM 侧传来的 `hint`。

表情编号 `f01`–`f04` 对应 `models/kurisu/expressions/`，动作组对应该模型
`motions/` 下的目录名（`flickHead` / `pinchIn` / `shake` / `idle` / `tapBody`）。

**加一个情绪**：在 `EMOTION_MAP` 加条目，再在 `inferEmotion` 里加触发词。
如果希望这个情绪也影响**音色**，还要在 `voice-server/references.json` 的
`aliases` 里把它指到某组参考音频（见第 4 节）。

## 3. 触摸台词（第三层）

`src/pet/touch-reactions.js` 把点击部位映射到台词与原版语音 id：

```js
{ area: 'head', voice: 'dont_call_me_like_that', text: '别那样叫我。', mood: 'annoyed' }
```

`nextTouchReaction(area)` 会**不重复地轮换全部 45 条**，点满 45 次才回到起点 ——
所以新增条目时请保持 id 与 `catalog.js` 一致，并确认对应 OGG 存在。

## 4. 语音路由（第四层）

这一层决定"这句话用原版录音，还是现合成"。

**`src/voice/catalog.js`** 是 45 条原版 OGG 的语义元数据：

```js
{ id:'tm_not_possible', file:'tm_not_possible.ogg', mood:'disappointed',
  zh:'理论上讲时间机器也不是不可能的。', intent:'time_machine_possibility',
  tags:['时间机器','理论','可能','结论'] }
```

`zh`、`intent`、`tags` 会拼进分类器的 prompt（`voiceCatalogPromptLines()`）。
**它们写得越贴近用户的实际说法，命中率越高** —— 这是提升"像角色"性价比最高的地方。

**`src/voice/semantic-router.js`** 的 `buildVoiceClassifierMessages()` 让 LLM 同时做
两件事：选一条 catalog 语音，并把整句中文翻成日语。判定标准写得很明确：

> Choose a catalog voice only when the assistant reply expresses substantially the
> SAME utterance/intent, not merely the same topic.
> Use confidence >= 0.86 only for a genuinely close semantic substitute.

置信度阈值在 `src/voice/pipeline.js` 调用处：本地匹配 `0.92`、LLM 分类 `0.86`。
调高 → 更多走合成日语；调低 → 更多复用原版录音（音色更真，但可能语义不贴）。

**音色分组**在 `voice-server/references.json`。`aliases` 把 `reaction.js` 的
13 个情感词收敛到 3 组参考音频：

```json
{ "fallback": "normal",
  "aliases": { "happy": "bright", "pissed": "annoyed", "worried": "normal", … },
  "references": { "normal": {...}, "annoyed": {...}, "bright": {...} } }
```

每组必须带**逐字转写的 `text`**：它是 GPT-SoVITS 的 prompt，对不上会明显掉质量。
转写可从 `WAV/o.list` 取（随 `bysq/TTS-KurisuMakise` 发布，格式 `路径|说话人|语言|文本`）。

> **参考音频必须是训练集里的真实录音**，不要用模型自己生成的 `*示范.wav` ——
> 那等于把合成结果反馈回合成。

## 5. 改完怎么验证

```bash
npm run build:render
npm run verify:chain     # 中文输入 → 中文回复 → 日语翻译 → TTS 全链路
```

`verify:chain` 会打印三步的原文与耗时，并能看出译文是否被截断（正常应完整成句）。

想单独看某句话会走哪条路：

```bash
npm run verify:client    # 只验证 9881 契约，不需要 LLM
```

**建议**：凭听感调 Router 之前，先固定一组 30–50 条典型对话作为测试集。
否则每次改动都只能靠印象判断 —— 这是 `ROADMAP.md` Phase 4 明确要求做的事。
