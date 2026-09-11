# 架构

面向维护者。描述"东西在哪、为什么在那儿、改动时会踩到什么"。
部署与排查见 [DEVELOPMENT.md](DEVELOPMENT.md)，归档清单见 [../legacy/README.md](../legacy/README.md)。

---

## 1. 整体形状

```
┌─ iPhone ────────────────────────────────────────────────┐
│  Capacitor 壳 (Swift)                                    │
│    └─ WKWebView ── dist/ 渲染层（本仓库 src/）            │
│         ├─ Live2D Cubism 2.1 立绘  (pixi + live2d.min.js)│
│         ├─ CALL 界面 / HUD / 移动端面板（手绘视觉层）      │
│         └─ 语音 & LLM 逻辑                                │
└────────────────┬───────────────────────┬────────────────┘
                 │ 局域网                 │ HTTPS
                 ▼                        ▼
   PC: Kurisu TTS 服务             LLM（OpenAI 兼容）
   GPT-SoVITS v2 + CUDA            e.g. api.deepseek.com
   0.0.0.0:9881
```

**渲染层是唯一的真相来源。** 桌面 Electron 版复用同一套 `src/`；本分支把桌面壳保留在
`electron/` 只是为了本地调试方便，产品主线是 iOS。

---

## 2. 启动流程

`index.html` 只引两个东西：`./live2d.min.js`（Cubism 2 运行时）和 `/src/main.js`。

`src/main.js` 的 `boot()` 顺序：

1. 取 `#stage` / `#l2d-canvas2` / `#hud-root`，缺一个就抛错
2. `isIOSRuntime()` 判定平台 → 给 `<body>` 加 `mobile-ios`
3. `mountBoot()` 显示开机画面，**等用户点 CONNECT（或 15 秒自动过）**
4. `createPetAppCubism2()` 建渲染器 → `loadModel('models/kurisu/')`
5. 依次挂载 HUD、气泡、移动端面板、字幕滚动
6. `bootDone` 之后：`toggleConsole(true)` → `setTab('call')` → 播放 `hello` 片段

**关键点**：`mountMobileUi` 在第 5 步就跑了，但 `.mobile-ui` 要等启动结束才参与布局。
所以在那之前用调试工具测量面板尺寸会得到 0 —— 这不是 bug，但会误导诊断。

### 可达性

`src/` 下**没有不可达模块**。判断方式（新加文件后值得重跑）：

```bash
# 从 index.html 走 ESM import 图 + CSS @import，列出无人引用的文件
```

手工核对的要点：`vite.config.js` **不打包**没被 import 的文件，所以死代码不会进 dist，
但它会留在仓库里腐烂。历史上 `src/demo/`（Cubism 5 官方示例）和 `src/live2d/app.js` 那套
Cubism 5 渲染器就是这样烂掉的——它们依赖的 `@framework` 别名早就不存在了，**根本编译不过，
只是没人发现**。现在都在 `legacy/cubism5-demo/`。

---

## 3. 视觉层：不要重排

移动端的外观是照 Java 版 Amadeus 手绘复刻的，这是刻意保留下来的资产：

| 部件 | 位置 |
| --- | --- |
| 仿制状态栏（`XP </> USB`、信号、电量、时间） | `.phone-bar`（`src/ui/hud.css`） |
| 字幕框（手绘边框） | `.call-subtitle` + `public/Resources/amadeus-reference/subtitle_frame_big.png` |
| 底部三键 dock | `.mobile-dock`（`src/ui/mobile.js`） |
| 开机画面 | `src/ui/boot.js` + `connect_*.png` / `cancel_*.png` / `logo39.png` |

改功能时**不要重排这一层**。CSS 分三处，注意覆盖顺序：

- `src/style.css` → `@import` 了 `reference-ui.css` 和 `ios-call-fixes.css`
- `src/ui/mobile.css`、`hud.css` 等由各自模块 `import`

> ⚠️ `.call-subtitle` 的规则**分散在三个文件里**：`hud.css`（基础）、`reference-ui.css`
> （桌面 CALL）、`ios-call-fixes.css`（iOS 修正，带 `!important`）、`mobile.css`（尺寸/字号）。
> `ios-call-fixes.css` 的 `!important` 会压过 `mobile.css` 的同类属性，所以
> `mobile.css:261` 里的 `height/min-height/max-height` 实际上是**死规则**。合并它们是个
> 值得做的清理，但要一次改完，别只改一半。

---

## 4. 语音管线

核心在 `src/voice/`，`main.js` 只负责编排。

```
LLM 中文回复
   │
   ├─ localVoiceDecision()  ── 命中 ──▶ 原版 OGG（45 条之一）
   │      置信度 < 0.92
   ├─ classifyReferenceVoice()（LLM 分类，仅短回复）
   │
   └─▶ Kurisu TTS
          ├─ translateForKurisuTts()  中 → 日
          ├─ splitReplyForTts()       >92 字按句切块
          ├─ synthesizeTts()          POST /v1/tts
          └─ playAudioBlob()          播放
```

**语言合同只有两处定义，改一处必须同步另一处：**

- `src/voice/tts-client.js` → `TTS_OUTPUT_LANGUAGE = 'ja'`
- `voice-server/kurisu_tts_server.py` → `OUTPUT_LANGUAGE = "ja"`（在另一个分支）

### 诊断

`src/voice/diagnostics.js` 维护一条滚动 trace，照 `CONFIG → HEALTH → TRANSLATE →
SYNTH → DECODE → PLAY → END` 记录。设置面板底部那行就是它。**排查语音问题先看这行**，
它能直接指出断在哪一环，比读日志快得多。

---

## 5. 口型同步

**不要用 `createMediaElementSource()`。**

那条路会把音频元素接进 Web Audio 图，而图一旦接管，元素就**失去直出**——声音只能经由
图到达扬声器。这台设备上被接管的路径是**静音**的，这是实测结论，不是推测。

现在的做法是纯离线的：

1. 取到音频字节
   - TTS 回复：WAV 字节已在手上 → `parseWavChannels()` 直接读 PCM（本服务固定
     32 kHz / 16-bit / mono），**不需要任何解码 API**
   - 点击的 45 条 OGG：`OfflineAudioContext.decodeAudioData()` 离线解码，不打开音频设备、
     不碰播放会话
2. 算成 25 fps 的 RMS 包络，用与旧分析器相同的响应曲线
3. 播放照常直出；`requestAnimationFrame` 读 `audio.currentTime` 取包络值驱动 `setMouthOpen`

包络在**后台**构建，**绝不阻塞播放**；解码失败就闭嘴，和没有口型一样。

实测（一次完整回复，采样每次 `setMouthOpen`）：1357 次采样、998 次非零（74%）、49 个不同
开合值。那 26% 的闭合是词句停顿——正是它让嘴看起来在说话而不是机械开合。

---

## 6. 人格层

`src/llm/persona.js` 是**唯一真相来源**，`src/llm/client.js`（生产路径）和
`legacy/pet-v1/llm.js`（本地 llama.cpp 路径）都从它取。

三层：

| 层 | 内容 | 来源 |
| --- | --- | --- |
| 一 · 人格内核 | 履历、性格事实、对被起外号的反应 | `Prompts/Kurisu_EN.md` |
| 二 · 世界背景 | 未来道具研究所的人物关系、世界线设定 | `Prompts/Story_EN.md` |
| 三 · 语言风格 | 741 条台词的统计画像：句长、问句比例、高频开头、禁用项 | `Prompts/SG_Dialogues_EN.md` |

**这三层曾经是孤儿**：它们写在 `src/pet/llm.js` 里而没有任何文件 import 它，生产路径用的是
一段七行的通用设定（"逻辑严谨、带一点傲娇"）。模型没有世界观、没有称呼关系、没有语言风格
约束，输出自然是一股通用助手味。移植到 `persona.js` 后才接上。

`Prompts/` 与 `Dialogues/` **不在运行时加载**，它们是作者撰写人格时的参考素材。

---

## 7. 推理模型必须关掉思考

`src/llm/client.js` 的 `NO_REASONING = { thinking: { type:'disabled' }, reasoning_effort:'none' }`
会附加到**全部三个**调用（对话、分类、翻译）。

原因：DeepSeek flash 这类推理模型会把 `max_tokens` 全烧在隐藏推理上并返回**空的 `content`**。
对话调用靠 400 token 勉强还能出内容，翻译调用会直接返回空串 → 管线抛
`LLM returned an empty Japanese TTS translation` → **放弃语音，只剩文字**，
TTS 服务端**一个请求都收不到**。

**调大 `max_tokens` 不解决问题**（推理会跟着变长），必须关掉思考。遇到不支持这两个字段的
后端会自动去掉重试一次。

---

## 8. 设计不变量

这几条是踩过坑换来的，改动时请保留：

1. **单一语音所有者** — `main.js` 的 `busy` 保证同一时刻只有一条语音在播。
2. **字幕绑定真实音频起止** — 文字在 `onStart` 才出现（`showLine()`），不是 LLM 一答就显示。
   合成要好几秒，提前显示会让文字跑在语音前面。
3. **文字与语音同源** — 45 条 OGG 与 Kurisu TTS 走同一个 `routeAndSpeak`，不要旁路。
4. **屏幕永远不是窗口拖拽把手** — 只有手机边框/刘海（`[data-drag-handle]`）可以拖。
5. **播放路径保持直出** — 见第 5 节，不要为了口型去接管音频图。
6. **不认识的手势别抢** — 字幕滚动用 document 捕获 + 矩形命中，只在矩形内接管。

---

## 9. 事件模型的坑：WKWebView 只发 pointer

**这是本项目最容易反复踩的坑。**

字幕滚动最初用 `touchstart`/`touchmove` 实现。在模拟器上怎么都不动，加计数器才发现
XCUITest 的拖拽**根本没有以 DOM touch 事件到达页面**（`touch=0/0/0`）。
对照之下才明白：**之前那个能用的滚动条是基于 pointer 事件的**。

结论：**在 WKWebView 里做手势，用 pointer 事件**。触摸事件只作为没有 `PointerEvent`
的引擎的兜底，且两者**不能同时生效**，否则一次真实手指会滚两倍。

```js
const pointerCapable = typeof window.PointerEvent !== 'undefined'
// pointer 路径优先；touch 处理器里第一行就是 if (pointerCapable) return
```

---

## 10. 目录约定

| 路径 | 作用 |
| --- | --- |
| `index.html` · `src/main.js` | 产品入口：组装 Live2D + UI + 对话/语音流程 |
| `src/llm/` | LLM 层：对话、OGG 分类、中→日翻译、**人格（persona.js）** |
| `src/voice/` | 语音核心：catalog / semantic-router / pipeline / player / tts-client / diagnostics |
| `src/live2d/cubism2app.js` | Cubism 2.1 渲染与口型驱动（`src/live2d/` 下**只有**这一个在生产路径上） |
| `src/ui/` | 界面外壳：CALL、HUD、气泡、开机、移动端面板与滚动 |
| `src/pet/` | 情绪映射、触摸台词、台词库、本地设置 |
| `src/platform/` | 平台适配（iOS 判定、中文语音识别） |
| `ios-tests/` | XcodeGen 测试宿主 + XCUITest（CI 在模拟器上跑） |
| `tests/` | 快速契约测试（纯 Node，毫秒级） |
| `public/` | 静态资源：Cubism 2 运行时、45 条 OGG、手绘参考图 |
| `models/kurisu/` | 生产模型（Cubism 2.1） |
| `legacy/` | 归档，**不在构建路径上** |
