# 架构

AMA-DEUS 是一个桌面 / Android 角色终端：**中文界面与对话，红莉栖始终以日语发声**。

本文描述渲染层与语音后端的结构、两者的契约，以及几条不可破坏的约束。

---

## 1. 一句话目标

> 用户用中文交流，界面和上下文保持中文，角色以日语发声；优先播放原版语音，
> 匹配不到时由本地 GPT-SoVITS 用同一音色合成；同一套核心同时服务
> Android 与 Windows/Linux desktop。

## 2. 语言合同

```
用户输入 / STT  →  中文
LLM 回复        →  中文
界面 / 字幕      →  中文
角色发声        →  日语        ← 只有这一层是日语
```

这条规则**只在两处定义**，改一处必须同步另一处：

| 位置 | 形式 |
| --- | --- |
| `src/voice/tts-client.js` | `TTS_OUTPUT_LANGUAGE = 'ja'`；`synthesizeTts()` 对非 `ja` 直接抛错 |
| `voice-server/kurisu_tts_server.py` | `OUTPUT_LANGUAGE = "ja"`；`POST /v1/tts` 对非 `ja` 返回 400 |

中文→日语的翻译属于 **LLM 层**（`translateForKurisuTts`），不属于语音后端。
不会回退到 Android/Web Speech 的系统女声。

## 3. 分层

```
┌─ Electron 主进程 ────────────────────────────────┐
│ 窗口、边框拖拽、IPC 桥                            │
│ electron/main.cjs · electron/preload.cjs          │
└───────────────────────┬───────────────────────────┘
                        │ window.amadeus
┌───────────────────────▼───────────────────────────┐
│ 渲染层  index.html → src/main.js                  │
│                                                   │
│  Live2D      src/live2d/cubism2app.js             │
│  角色反应     src/pet/reaction.js                  │
│              src/pet/touch-reactions.js            │
│  语音         src/voice/                           │
│              catalog → semantic-router →          │
│              pipeline → player → tts-client        │
│  LLM         src/llm/client.js                    │
│  UI          src/ui/{boot,amadeus}.*              │
│  平台         src/platform/speech.js               │
└───────────────────────┬───────────────────────────┘
                        │ POST /v1/tts (WAV)
┌───────────────────────▼───────────────────────────┐
│ 语音后端  voice-server/kurisu_tts_server.py :9881  │
│ GPT-SoVITS v2 + Kurisu 权重，进程内加载，CUDA       │
└───────────────────────────────────────────────────┘
```

## 4. 模块职责

| 模块 | 职责 |
| --- | --- |
| `src/main.js` | **唯一编排点**：把角色、UI、对话、语音串起来；持有 `busy`（单语音 owner） |
| `src/llm/client.js` | 三件事：中文对话、OGG 分类、中文→日语翻译。全部走同一个 OpenAI 兼容端点 |
| `src/voice/catalog.js` | 45 条原版 OGG 的清单与 URL 解析 |
| `src/voice/semantic-router.js` | 本地匹配 + LLM 分类结果的裁决 |
| `src/voice/pipeline.js` | `routeAndSpeak()`：决定走 OGG 还是 TTS，并驱动播放 |
| `src/voice/player.js` | 唯一的播放出口；口型包络（AnalyserNode）与起止回调 |
| `src/voice/tts-client.js` | 与 :9881 的 HTTP 契约；语言护栏 |
| `src/pet/reaction.js` | 回复文本 → 情绪 → 表情 / 动作 |
| `src/pet/touch-reactions.js` | 点击部位 → 台词 + OGG id（45 条不重复轮换） |
| `src/ui/amadeus.js` | 状态栏、字幕、思考点、面板 |
| `voice-server/kurisu_tts_server.py` | 日语合成服务：`/health`、`/v1/tts`、`/v1/references` |

## 5. 一轮对话的数据流

```
用户输入（中文）
  │
  ├─ src/llm/client.js  chat()                → 中文回复
  │     · 关闭推理（见 §8）
  │
  ├─ src/pet/reaction.js planReaction()       → emotion → 表情 f01..f04 + 动作
  │
  └─ src/voice/pipeline.js routeAndSpeak()
        │
        ├─ localVoiceDecision(reply, 0.92)    本地 catalog 匹配
        ├─ classify = classifyReferenceVoice  LLM 分类（仅本地未命中时调用）
        └─ finalizeVoiceRoute(reply, llm, { localThreshold: 0.92, llmThreshold: 0.86 })
              │
              ├─ 命中 → playReferenceVoice(id)          原版 OGG
              └─ 未命中 → translateForKurisuTts(reply)  中文 → 日语
                            └─ synthesizeTts()  → :9881 → WAV
                                  └─ playAudioBlob()  + 口型
```

实测一轮（RTX 4060 + deepseek-flash）：

```
+0.0s  思考点显示            THINKING · ZH
+1.2s  思考点显示            VOICE ROUTING      ← LLM / 翻译 / 合成
+5.1s  思考点消失，字幕与语音同时出现  KURISU TTS · JA
+14.3s 播报结束，字幕消失
```

字幕持续时间 = 该句音频时长。

## 6. 三条不可破坏的约束

**① 单语音 owner。**
`src/main.js` 的 `busy` 从"发送"一直保持到"播放结束"。期间点击角色不触发
touch OGG —— 否则 `player.js` 的 `stopVoicePlayback()` 会把正在播的回复掐断。

**② 字幕与语音同起同落。**
`player.js` 的 `onStart` 在**音频真正起播**时触发（不是 blob 就绪时），
`onEnd` 在播完时触发。字幕据此显示与清除；生成期间由 `.ama-thinking`
（三点动画）占同一个槽位过渡。无音频的纯文字回退按字数定时。

**③ 屏幕不是窗口拖拽把手。**
`src/main.js` 的 `mountShellDrag()` 只接受手机**额头**（`.phone-top`）与边框，
且避开最外圈 10px（那是系统的缩放边框）。抓角色一定是点击，不会变成拖动。

## 7. 语音后端契约

与 `src/voice/tts-client.js` 一一对应。

### `GET /health`

```json
{ "ok": true, "engine": "kurisu-gpt-sovits-v2", "language": "ja",
  "device": "cuda", "model_loaded": true, "busy": false,
  "syntheses": 12, "last_synth_ms": 1840,
  "moods": ["annoyed", "bright", "normal"], "reference_count": 3,
  "cuda": "NVIDIA GeForce RTX 4060 Laptop GPU" }
```

客户端判定可用的条件是 HTTP 200 **且** `ok !== false`。

### `POST /v1/tts`

```json
{ "text": "そうね、その通りだわ。", "language": "ja", "mood": "annoyed" }
```

返回 `audio/wav`（单声道 16-bit 32 kHz），附
`x-amadeus-tts-engine` / `x-amadeus-tts-mood` / `x-amadeus-tts-reference` /
`x-amadeus-tts-elapsed-ms`。

`mood` 决定参考音频。`references.json` 用 `aliases` 把 `reaction.js` 的
情感词表（13 个）收敛到 3 组音色。

**参考音频必须是训练集里的真实录音**，不能用模型自己生成的 `*示范.wav`
——那会把合成结果反馈回合成。

## 8. LLM 层的两个特殊处理

**关闭推理。** `src/llm/client.js` 对所有请求附带 `NO_REASONING`
（`thinking:{type:"disabled"}` + `reasoning_effort:"none"`）。

不关掉时 `deepseek-flash` 会把 `max_tokens` 全烧在 `reasoning_content` 上并返回空
`content`（`finish_reason: "length"`），翻译与分类调用直接失败；主对话也会慢一倍
（3.0s → 1.6s）。提高 `max_tokens` 无效 —— 实测 3000 token 仍被推理吃光。
换到不支持这两个参数的后端时会自动去掉重试一次。

**token 预算按输入缩放。** 日语比中文长约 1.15 倍（token 更多），
固定 500 会让长回复的译文停在半句。翻译与分类都用
`min(4000, 400 + 字数 × 4)`。

## 9. 平台注意事项（Windows）

透明无边框窗口有一组反直觉行为，`electron/main.cjs` 里都有注释：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 每次移动窗口长高 1px | 几何 API 与缩放边框的口径不一致 | `pinnedSize`：尺寸只在创建与真实用户缩放时更新，拖动期间写回同一个值 |
| 窗口 resize 风暴 | `setAspectRatio` / `minHeight` 与窗口管理器互相触发 | 都不用。手机比例由 `src/style.css` 的 CSS 维持 |
| 启动即退出，`ipcMain` undefined | 环境里有 `ELECTRON_RUN_AS_NODE=1`（VS Code 会传） | 启动前清除该变量 |

`AMA_TRACE_BOUNDS=1` 可开启窗口尺寸日志。**注意**：该探针的回调只计数，
几何读取放在定时器里 —— 在 resize/move 回调里调 `getBounds()` 会自己触发自己，
制造出并不存在的风暴。

## 10. 目录

```
index.html · src/main.js     产品入口
src/llm/ · src/voice/ · src/pet/ · src/ui/ · src/live2d/ · src/platform/
voice-server/                语音后端（9881）
electron/                    窗口与 IPC
tools/                       下载器与验证工具
docs/                        本目录
legacy/                      归档（不在构建路径上）
.workspace/                  本地大文件：GPT-SoVITS 源码与权重（不入库）
```
