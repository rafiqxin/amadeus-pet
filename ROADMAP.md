# AMA-DEUS 路线图（冻结版）

> 本文件是项目的**唯一路线基准**。任何阶段的工作都必须能回答三个问题：
> **可运行版本是什么？回退版本是什么？验收标准是什么？**
> 不满足这三条的改动不进入主线。

---

## 0. 最终目标（一句话）

用户用**中文**与 AMA-DEUS 交流，界面和上下文保持**中文**，红莉栖始终以**日语发声**；
优先使用**原版 OGG**，无法匹配时由 **Kurisu TTS** 生成日语语音；
同一套核心逻辑同时服务 **Android** 与 **Windows/Linux desktop**，后续再逐步替换成我们自己的语音模型。

### 语言合同（不可动摇）

```
用户输入        → 中文
LLM 回复        → 中文
界面 / 字幕      → 中文
角色发声        → 日语    ← 只有这一层是日语
```

`src/voice/tts-client.js` 已经把这条合同写成代码：`TTS_OUTPUT_LANGUAGE = 'ja'`，
且 `synthesizeTts()` 对非 `ja` 请求直接抛错。**中文→日语的翻译属于 LLM/路由层，永远不属于语音后端。**

---

## 1. 优先级（同一时间只推一条主线）

| 级别 | 内容 | 状态 |
| --- | --- | --- |
| **P0** | Windows 本机 Kurisu TTS 跑通（9881 服务 + `GET /health`） | ✅ **完成**（2026-09-10 验收通过） |
| **P1** | Android alpha.9：局域网真实对话闭环 | ← **当前主线** |
| **P2** | 自有 Kurisu Voice v1 数据集与微调 | 未开始 |
| **P3** | desktop 合并 + legacy 清理 | legacy 清理 ✅ ／ desktop 合并 未开始 |

> 环境问题（PyTorch 安装）只是 **Phase 2 的工程阻塞点**，不构成改变路线的理由。
> 根因已查明并解决：网络会掐断长连接（整包下载几十 MB 后掉到 0 B/s），
> 改用**分块 Range 下载**后稳定在 ~2.9 MB/s。工具见 `tools/fetch_wheels.py`。

---

## 2. 七个阶段

### Phase 1 — 冻结 alpha.7 / alpha.8 稳定基线

**可运行版本**：alpha.7 = 点击角色 → 45 条 OGG 循环，单语音 owner，无旧 motion MP3。
alpha.8 = `Voice Catalog → Semantic Router → OGG / TTS`，语言合同固定为「中文输入/中文字幕 → 日语 TTS」。

**回退版本**：alpha.7（OGG-only 路径）。
**规则**：alpha.7 的点击/OGG/单 owner 行为**只允许修 bug，不再重构**。

**验收标准**：接入 TTS 后，以下四项不得回归 ——
1. 点击角色有反应
2. Live2D 动作正常
3. 45 条 OGG 仍可正常播放
4. DeepSeek 中文回复正常显示

### Phase 2 — Windows 本地 Kurisu TTS 闭环 ✅ 【P0・已完成】

**目标**：`GPT-SoVITS + bysq/TTS-KurisuMakise` 在 RTX 4060 上稳定生成**自然日语 WAV**。

**验收结果（2026-09-10）**：
```
$ python voice-server/verify.py --url http://127.0.0.1:9881
1. GET /health          → 200, ok=true, cuda, model_loaded=true
2. POST /v1/tts         → 真实 WAV（32 kHz / 单声道 / 16 bit）
3. 语言护栏（中文）      → HTTP 400 拒绝
9 passed, 0 failed — Phase 2 acceptance: OK
```

实测延迟（预热后）：`0.6 s`（短句）→ `0.73 s`（中等）→ `2.23 s`（长句）；
音频时长与文本长度成比例（约 0.15 s/字），确认为真实语音而非噪声。

**环境清单**（全部 ✔）：

| 项 | 状态 |
| --- | --- |
| Python 3.10（conda env `GPTSoVits`，3.10.21） | ✔ |
| PyTorch 2.6.0+cu124（RTX 4060 Laptop, driver 566.07, 8 GB） | ✔ `cuda.is_available()=True` |
| torchaudio 2.6.0+cu124 | ✔ 与 torch 同源 |
| GPT-SoVITS 源码 | ✔ `.workspace/tts/GPT-SoVITS` |
| HuBERT / RoBERTa / SV | ✔ 180 MB / 621 MB / 102 MB |
| G2PW | ✔ |
| **pyopenjtalk 0.4.1 + OpenJTalk 词典** | ✔ 源码编译成功，G2P 验证通过 |
| `fast_langdetect` 模型（`lid.176.bin`，131 MB） | ✔ |
| Kurisu 权重（`kurisu-e15.ckpt` / `kurisu_e4_s972.pth`） | ✔ + ASCII 硬链接 |
| requirements（37 个 wheel + 7 个源码包编译） | ✔ |
| **9881 服务** | ✔ `voice-server/kurisu_tts_server.py` |
| **局域网访问（Android）** | ✔ 实测 `http://10.14.62.86:9882/health` → 200 |

**产出**：
- `voice-server/kurisu_tts_server.py` —— 9881 服务（`GET /health`、`POST /v1/tts`、`GET /v1/references`）
- `voice-server/references.json` —— 情绪 → 参考音频映射（3 组音色 / 15 条别名）
- `voice-server/verify.py` —— 验收脚本（进程内 / HTTP 双模式）
- `voice-server/run.ps1` —— 启动器（`-Lan` 开局域网）
- `tools/fetch_wheels.py` —— 分块断点下载器

**启动方式**：
```powershell
.\voice-server\run.ps1          # 本机（desktop 默认端点 127.0.0.1:9881）
.\voice-server\run.ps1 -Lan     # 局域网（Android 用，日志会打印 LAN 地址）
```

**回退版本**：纯 OGG 路径（alpha.7 行为），TTS 不可用时自动降级。

### Phase 2b — 桌面端端到端「LLM 驱动实时发声」✅ 【已完成】

**验收结果（2026-09-11）**：Electron 窗口内实测一轮完整对话 ——
```
status  READY → VOICE ROUTING → KURISU TTS · JA
字幕    还行吧，至少比被某个疯狂科学家用奇怪理论烦一整天要好。你突然问这个，是想套我话还是单纯闲聊？
TTS     9881 syntheses 5 → 6（app 确实调用了服务并播放）
```
无 GUI 的链路验证：`node tools/verify-speech-chain.mjs` → **speech chain: OK**（5/5）。
客户端契约验证：`node tools/verify-voice-client.mjs` → **OK**（5/5）。

**过程中修掉的问题**（都是真阻塞，不是环境噪声）：

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| `ipcMain` undefined，app 秒退 | 环境继承了 `ELECTRON_RUN_AS_NODE=1`，electron.exe 退化成 Node | 启动前清掉该变量 |
| 构建失败 | `@capacitor/core`、`@capacitor-community/speech-recognition` 不在 package.json，靠 CI 临时装 | 装齐（与 CI 同版本 7） |
| `public/Resources/amadeus-voices` 缺失 | 45 条 OGG 由 CI 从 `raw.githubusercontent.com/rafiqxin/Amadeus` 拉取 | 按 CI 的同一份清单下载 45/45 |
| **翻译调用永远返回空** | `deepseek-flash` 是推理模型，`max_tokens` 被 `reasoning_content` 吃光（`finish_reason=length`, `content=""`） | `src/llm/client.js` 增加 `NO_REASONING` 开关 + 400 自动回退 |
| 9881 缺 CORS | 桌面端 `webSecurity:false` 掩盖了它，Android WebView 会中招 | `kurisu_tts_server.py` 加 CORSMiddleware |

> **关于推理模型**：`max_tokens=3000` 也救不了 —— 实测推理膨胀到 8535 token 仍然截断。
> 三个调用（对话 / 分类 / 翻译）现在都关闭思考。实测 `deepseek-flash`：
> 思考 ON = 3.0 s / 147 字，思考 OFF = **1.6 s / 63 字**，后者更贴合人设的「1~4 句」要求。
> 若想恢复深度思考，删掉 `NO_REASONING` 一处展开即可（常量集中在一个地方）。

### Phase 2c — 桌面端交互修复 ✅ 【已完成】

三处用户反馈，实测时间线（`deepseek-flash` + RTX 4060，一轮完整对话）：

```
[+0.0s] 思考点显示   subtitle=—                  THINKING · ZH
[+2.4s] 思考点显示   subtitle=—                  VOICE ROUTING   ← LLM/翻译/合成中
[+7.3s] 思考点消失   subtitle="时间机器？理论上…"   KURISU TTS · JA ← 音频起播，字幕同时出现
[+21.6s] —          subtitle=—                  KURISU TTS · JA ← 播完，字幕才消失

字幕持续 14.3s（= 该句音频时长）· 生成中点击角色：blocked · TTS syntheses +1
```

1. **语音与字幕同步**：新增 `onStart` 回调（`player.js`），字幕改为「音频真正起播」时才出现，
   `onEnd` 后才消失。生成期间用 `.ama-thinking`（三点动画）占同一个槽位做过渡。
   无音频的纯文字回退则按字数定时（`subtitleMsFor`）。
2. **单语音 owner**：`busy` 从发送一直保持到播放结束，期间点击角色不再触发 touch OGG ——
   否则 `playAudioUrl()` 的 `stopVoicePlayback()` 会把正在播的回复掐掉。
3. **电脑端手机外壳**：`#phone` 边框（圆角机身 + 刘海 + 电源键），边框即窗口拖拽把手
   （`mountInteractions` 是死代码，此前窗口根本无法移动）。窗口改为 `resizable` +
   9:16 比例锁（`setAspectRatio` + `will-resize` 双保险）、恢复任务栏条目、
   状态栏加 `×` 关闭键。

**过程中发现并修掉的回归**：`#stage` 从全屏改为内缩容器后，关闭状态的 `.ama-sheet`
（`translateY(108%)`）撑出了可滚动区域，`chatInput.focus()` 触发浏览器滚动，把整层 UI
顶出边框 123px（状态栏跑到屏幕外、sheet 反而露出来）。修法：`#stage` 用 `overflow: clip`
（禁止一切滚动，而非仅隐藏滚动条）+ `focus({ preventScroll: true })`。

> **未自动化验证**：窗口缩放时的比例锁需要人手拖拽窗口边缘确认 —— CDP 只能控制渲染进程，
> 无法触发 `will-resize`。若发现仍会拉伸，改为在 `will-resize` 里强制 `setBounds` 即可。

### Phase 2d — P0 窗口尺寸 bug 根因与修复 ✅ 【已完成】

**症状**：拖动/点击窗口边框，窗口自己变大；自定义缩放一直无法实现。

#### 真实且已证实的 bug：几何调用导致 +1px 累积

在 Windows 上，**透明 + 无边框**窗口每次调用几何 API（`setPosition` 与 `setBounds`
一样）高度就 **+1px**。任何「读尺寸 → 写回尺寸」的循环都会把它累积起来。

```
A/B 实测（同一台机器、同一代码路径，只换写入方式）
  旧：getBounds() → setBounds(读到的尺寸)    586 → 600 px（14 次移动，每次 +1）
  新：锁死拖动开始时的尺寸，每次写同一个值      净增长 +0w +0h（30 次移动）
```

修法在 `electron/main.cjs`：`pinnedSize` 仅在创建时与**真实用户缩放**时更新
（`will-resize`，且不在拖动中）；拖动期间每次都用这个固定值写回。单次膨胀被下一次
调用纠正，不再累积。残余 ±1px 抖动由 Windows 本身产生，已封顶。

**P0 回归测试**（可重复）：
```
15 次真实移动           → 净增长 +0w +0h
14 项点击/抖动手势       → 全部保持尺寸不变
45s 纯待机（追踪开启）   → resizes=0 moves=0 willResizes=0，尺寸恒为 482x854
```

#### 需要更正的一次误判（重要）

我在排查过程中一度测到「每秒几十次的 resize 风暴」（2466 次 / 45s），并据此把
`setAspectRatio` 和 `minHeight` 认定为元凶写进了结论。**那个风暴是我的诊断探针自己
造成的**：探针在 `resize` / `move` 回调里调用 `win.getBounds()` —— 在几何回调里做几何
读取，等于自己触发自己。

探针修正为「回调只计数，几何读取放到 5 秒定时器里」后，同样开启追踪，**事件数归零**。
教训与代码注释都已写进 `electron/main.cjs`。

`setAspectRatio` 与 `minHeight` 仍然保持移除，但理由改为**预防性**而非实证：
手机比例改由 `src/style.css` 用 CSS 维持（`aspect-ratio` + 窗口内居中留边），
CSS 不可能与窗口管理器互相触发；外壳本就使用相对单位，最小尺寸不再必要。
隔离测试中 `minHeight` 曾单次产生 1643 次事件，但重复运行归零，**未能稳定复现**，
故不作为定论。

#### 未能复现的部分（诚实记录）

原始配置是 `resizable: false` + 固定 min/max，隔离测试中该配置产生 0 次事件；
且当时窗口根本无法移动（`mountInteractions` 是死代码）。**因此我无法在原始版本上
复现这条膨胀路径**。若你在本项目更早期确实见过该现象，那应发生在当时的另一种配置下。
现在的修复对「窗口可被移动」的所有情况都成立。若新版本仍出现增大，请提供具体操作
（点哪里、拖哪条边），我按同一套追踪方法定位。

#### 顺带修掉的两个问题

- **口型不跟语音**：正在播放的 motion（含常驻 idle 循环）每帧覆写
  `PARAM_MOUTH_OPEN_Y`，外部设定值当场被冲掉。改为在 PIXI 的 `LOW` 优先级（模型自身
  更新**之后**）写入且每帧消费一次 —— 停止喂数据后控制权自动交还 motion，不会僵住。
- **一次白屏事故**：上面这个修复最初写成 `PIXI.utils.UPDATE_PRIORITY`，而 v6 中该常量
  挂在 `PIXI` 根上。一个动画参数取到 `undefined` 把**整个渲染层打崩**（UI 完全不挂载）。
  已改为 `PIXI.UPDATE_PRIORITY?.LOW ?? -25`。

#### README 重写

原文仍在讲 Haru/Mao/Wanko 占位模型与 Web Speech API，与产品现状完全脱节。新版按
「语言合同 → 语音链路 → 快速开始 → 仓库结构 → 平台注意事项」组织，并新增
`tools/fetch-voices.mjs`（45 条 OGG 拉取，原先只存在于 CI 的 YAML 里）。

### Phase 2e — 长回复无语音的根因、外壳重做 ✅ 【已完成】

#### 「LLM 回复稍长就没有 TTS」的真实原因

不是超时，不是长度限制，而是 **NLTK 数据缺一个资源**：

```
Kurisu TTS 500: LookupError:
  Resource 'averaged_perceptron_tagger_eng' not found.
```

GPT-SoVITS 的语种检测会把文本切成语言片段。**回复越长，越容易夹带拉丁字母**
（缩写、术语、专有名词——人设 prompt 本身还鼓励「偶尔插入英文科学术语」），
一旦出现，该片段就走英文 G2P（`g2p_en`）→ 需要 NLTK 词性标注器 → 缺失 → 整个请求 500。
短回复碰不到英文片段，所以看起来像「长度问题」。

失败样本：日语译文里出现 `CTC`（闭合类时曲线）。把这个词去掉，同一句就能合成。

**修复**（无网络依赖）：NLTK 3.9+ 把英文标注器从 `averaged_perceptron_tagger` 改名为
`averaged_perceptron_tagger_eng`，并把格式从 pickle 换成 JSON。本机已存在**旧名 pickle**，
于是用 NLTK 自带的 `save_to_json()` **本地转换**：

```
written: averaged_perceptron_tagger_eng.{classes,tagdict,weights}.json
pos_tag: [('Kurisu','NNP'), ('built','VBD'), ('a','DT'), ('time','NN'), ...]
```

（NLTK 官方下载源与 HuggingFace 镜像在这台机器上都被网络掐断，所以走本地转换。）

#### 顺带发现并修掉的两个同类隐患

| 问题 | 实测 | 处理 |
| --- | --- | --- |
| 翻译 `max_tokens: 500` 截断 | 625 字中文 → 日语译文停在「を提唱した：」半句 | 改为 `min(4000, 400 + 字数*4)` 按输入缩放 |
| 客户端超时 120s | 服务端 719 字需 72s 合成，再长一点就**静默失败** | 提到 300s，并注明"超时即等于角色不说话" |
| 分类器 `max_tokens: 320` | 它要同时返回 `tts_ja` 全文，同样会截断 | 同样按输入缩放，超时 20s→60s |

**验证**：351 字中文回复 → 579 字完整日语（327 假名）→ TTS 输出 93.8 秒音频，
合成耗时 32.8s。

#### 顺带：Markdown 会被念出来

模型即使被要求不要 markdown，仍会照搬自己回复里的 `**加粗**`、`#` 标题和列表符号 ——
这些会被 TTS 当噪声读出来。新增 `stripForSpeech()` 在合成前清理。

#### 手机外壳重做

原边框只有 11px 宽，**抓取时极易抓到模型上**，于是"想拖窗口"变成"点击角色"，
在拖拽过程中触发 touch OGG —— 这正是误触的来源。重做为：

- 顶部 26px「额头」整条作为拖拽把手（`data-drag-handle`），不再要求精准命中
- 听筒 + 摄像头开孔、金属中框高光、左侧音量键、右侧电源键、屏内 Home 指示条
- 屏幕仍**永远不是**拖拽把手，所以抓角色一定是点击、不会变成拖动

**边界测试**：抓额头 → 开始拖动；抓角色 → 不拖动（target=`l2d-canvas`）；
抓最外圈 5px → 不拖动（留给系统缩放边框）；三者都不改变窗口尺寸。

### Phase 2f — 外围灰层 + 口型同步 ✅ 【已完成】

#### 外围"浅黑色图层"

是 `#phone` 的**外部投影** `0 26px 64px rgba(0,0,0,.62)`。窗口是透明的，投影不会读作
"深度"，而是在留白区画出一圈暗色光晕。已移除，只保留内阴影（中框材质感）。

#### 口型：真正的 bug 是分析器循环从未启动

`player.js` 的 `monitor()` 在 `await audio.play()` **之前**被调用，而它的第一行判断是：

```js
const tick = () => {
  if (!analyser || audio.paused || audio.ended) { onLevel(0); return }   // 此刻还没开始播
  ...
  analyserFrame = requestAnimationFrame(tick)
}
tick()   // 直接 return，且没有再排队 → 循环永远不启动
```

实测证据：

```
修复前  AnalyserNode.getByteTimeDomainData 调用次数 = 0    （整个说话过程一次都没采样）
修复后  samples=104  max=0.255  nonZero=101；PARAM_MOUTH_OPEN_Y 收到
        0, 0.014, 0.499, 0.953, 1, 0.898, 0.151, ... 共 16 个不同值
```

修法：暂停时**重新排队**等待播放开始，只在 `ended` 时停止；而不是在"还没开始播"时
就永久退出。

#### 排查过程中的三次误判（记录以免重蹈）

1. **PIXI 优先级**：先按 `LOW` 写、再按 `-10` 写，两次都"没效果"。真实原因见下条 ——
   验证手段本身是坏的。
2. **无效的截取框**：用 `Page.captureScreenshot` 的 `clip` 裁剪"嘴部"，但坐标映射算错了
   （实际 DPR=1.5，返回图 318×360 而非预期的 212×240），**截到的全是空白背景**。
   于是"画面完全不变"这个结论是假的，我据此白改了两轮。改为**整图对比**后立刻看清。
3. **"模型说话时消失"**：连着几张说话中的截图都没有模型，一度以为是渲染被破坏。
   实际是**我自己的诊断注入**造成的（在原型上覆盖 `setParamFloat` + 强制值）。
   用无任何注入的干净页面重测，按 PNG 体积判断（有模型 ≈ 728–740 kB，无模型 ≈ 220–280 kB）：
   静止 727 / 说话中 730·732·728 / 结束后 740 —— 模型始终在。

期间还写过一个**有害的实现**：在 `Live2DModel.prototype.update` 之后再补调一次
`coreModel.update()`。它让模型在若干帧后彻底停止渲染。已完全移除。

#### 最终实现

参数写入放在 ticker 的 `LOW` 槽位（每帧最后一步）。值会保留到**下一帧**的变形计算中，
因此"早一帧"生效；本帧已经绘制完毕，所以不会与渲染竞争。

**验证**：说话中的整图截图，嘴部明显张开（对比静止时的闭嘴微笑）。

### Phase 2g — 双击桌面图标启动的打包版 ✅ 【已完成】

**目标**：Windows 上有一个"点图标就能用"的 AMA-DEUS，且图标沿用 Java 版仓库的角色标识。

**产物**：

| 文件 | 说明 |
| --- | --- |
| `release\AMA-DEUS-0.1.0-setup.exe` | NSIS 安装程序，105 MB。装到 `%LOCALAPPDATA%\Programs\AMA-DEUS`，建桌面 + 开始菜单快捷方式，`perMachine:false` 免管理员 |
| `release\AMA-DEUS-0.1.0-portable.exe` | 单文件绿色版，105 MB |
| `release\win-unpacked\` | 免安装目录版 |

**图标**：`build/icon-src.png` 取自 Java 版仓库的
`app/src/main/ic_launcher-web.png`（512×512 RGBA，橙底白标），
`tools/make-icons.py` 生成 7 档 `icon.ico` + 512 `icon.png`。
`electron/main.cjs` 的 `windowIcon()` 在打包后读 `process.resourcesPath/icon.png`、
开发时读 `build/icon.png`。

**三个打包期才发现的问题**：

1. **配置会分叉**。Electron 用 `productName` 推导 `userData`，打包版会去
   `%APPDATA%\AMA-DEUS` 另起一份 LLM/TTS 配置，和 `npm start` 的
   `%APPDATA%\amadeus-pet` 互不可见。修法是在 main 里显式
   `app.setPath('userData', path.join(app.getPath('appData'), 'amadeus-pet'))`。
2. **不需要 `node_modules`**。渲染层依赖已被 Vite 打进 `dist/assets/`，主进程只
   require `electron` 和 `path`。`files` 里显式 `"!node_modules/**/*"` 后，
   asar 从"照搬依赖"降到 11.5 MB / 106 条目。
3. **桌面快捷方式不继承调用者的环境变量**。`.lnk` 由 shell 拉起，拿的是 Explorer
   的环境，所以 `AMA_CAPTURE` 之类的诊断开关**经图标启动时不生效**——验证渲染必须
   直接跑 exe，或者走 CDP。

**验收**（都实际跑过）：

- `release\win-unpacked\AMA-DEUS.exe` 启动后 CDP 取 DOM：页面 URL 是
  `...resources/app.asar/dist/index.html`，标题 `AMA·DEUS`，`#phone` 246×437（严格 9:16）。
- 静默安装 `setup.exe /S` 退出码 0，`C:\Users\xin\Desktop\AMA-DEUS.lnk` 指向
  `...\Programs\AMA-DEUS\AMA-DEUS.exe`，开始菜单项同时生成。
- 安装后的 `resources/app.asar` 与 `win-unpacked` 的 **SHA256 完全一致**
  （`4A41601B…`），即已验证渲染的那份就是装出来的那份。
- 双击快捷方式启动 → 4 个进程全部来自安装目录；`AMA_CAPTURE` 自截图得到
  723×1281 的开机画面（Amadeus logo + `Connect to Kurisu?` + CONNECT/CANCEL）。
- 从 exe 抽出的 32×32 图标 sha 与 stock `electron.exe` 不同 → rcedit 确实换了图标。

**顺带确认的一件旧事**：`AMA_TRACE_BOUNDS=1` 下 10 秒内 `willResizes=1586`、
窗口从 482×854 被拖到 383×558 —— 这是**人手动拖动缩放**造成的（有 5 秒完全静止的
间歇，且比例由 CSS 维持为 9:16），不是 Phase 2d 那个 resize 风暴。两者要靠
"是否间歇"和"比例是否保持"来区分。

### Phase 3 — Android alpha.9「真正 AI 发声」 【P1】

**完整链路**：
```
中文语音/文本 → DeepSeek 中文回复 → Semantic Router
   → 高置信度：原版 OGG
   → 否则：中文回复翻译为日语 → Kurisu TTS → 手机播放 + 嘴型同步
```

**重点**：延迟、局域网稳定性、字幕与语音同步、TTS fallback、OGG/TTS 切换是否重复发声。
**验收标准**：能实际连续聊十几轮不炸、不重复发声、字幕语音对得上。

### Phase 4 — Voice Router 从「能用」升级到「像角色」

结构从 `reply → OGG/TTS` 升级为：
```
reply → intent + emotion + voice route + motion route
```
同一句中文回答产出：中文文本、日语翻译、情绪标签、表情、动作、语音 backend。

**验收标准**：建立 **30～50 条固定测试集**，每次改动跑同一套，不再凭听感修改。

### Phase 5 — 自有 Kurisu Voice v1 【P2】

现成 `TTS-KurisuMakise` **只作为第一阶段 backend，不是最终答案**。

```
raw → audit → normalize → segment → transcription
    → emotion label → speaker consistency → approved dataset
```

**素材策略**（`F:\Amadeus\Voice\`）：
- `000_初始音频` —— 原始归档，**保持不动**
- `001_可用长度适中音频wav` —— 第一批高质量候选
- `002_中等长度未处理音频素材` —— 切分 / 降噪 / 静音处理 / 转写 / 筛选

**路线**：先 10～30 分钟干净同说话者语料做 v1 fine-tune，再扩到 30～60 分钟。
**评测**：同一句测试文本对比「原 OGG / bysq GPT-SoVITS / Christina Qwen3-TTS / 自有模型」，
按 **音色相似度、自然度、稳定性、延迟** 四维选主 backend。

### Phase 6 — 统一 desktop / Android workspace + legacy 清理 【P3】

- `chatgpt/amadeus-voice-workspace` → 短期集成线
- `chatgpt/amadeus-reference-ui` → Linux/desktop 主线
- Android → 设备交付线

**目标结构**：
```
src/core  src/voice  src/llm  src/platform  src/live2d  src/ui
```
Android 与 desktop 只保留平台适配层。

**迁往 `legacy/desktop-v1/` 或删除**：Haru/Mao/Wanko、Cubism5 demo、旧 HUD、旧 bubble、旧 chat-bar、旧 Android patch。

**验收标准**：新人打开仓库，一眼能看出「产品入口在哪、语音在哪、平台差异在哪」。

#### legacy 清理 ✅ 【已完成】

用依赖图从 `src/main.js` 反推，结论是 **16 个文件在产品路径上，35 个不可达**。
（不靠感觉删：脚本跟随真实 import 语句，逐条解析。）

```
迁移前  src/ 51 个文件  →  迁移后 16 个

legacy/cubism5-demo/   demo.html · src/demo* · vendor/Framework
                       public/{Core,Shaders,Framework,Haru}（Cubism 5 示例运行时）
legacy/desktop-v1/     旧 live2d/ 渲染路径、旧 pet/ 对话与 LLM、旧 ui/{hud,bubble,mobile}
                       adapt-android-mobile.py · sync-amadeus-ui.mjs · ios-native-speech.swift
legacy/models/         Haru / Mao / Wanko 占位模型 · kurisu 旧 motion MP3
legacy/tools-tts/      第一版 9881 代理（已被 voice-server 取代）
```

**顺带修掉的**：`electron/main.cjs` 里的 `AMA_DEMO` 分支、`package.json` 的
`sync:reference-ui`、Android CI 里对已迁移文件的断言（`tools/tts/ama_tts_proxy.py`
→ `voice-server/kurisu_tts_server.py`）、一个 vim 交换文件 `electron/.main.cjs.swp`。

**`src/pet/interactions.js` 值得单独一提**：它是窗口拖拽处理器，从项目建立起
就没被任何地方 import —— 这正是"窗口一直无法拖动"的原因。已归档。

每个归档目录被什么取代，写在 `legacy/README.md` 里。

#### desktop 合并 【未开始】

跨仓库合并（`amadeus-reference-ui` → `amadeus-voice-workspace`）尚未进行。

### Phase 7 — 离线化与移动端独立运行

TTS 模型**不进 APK**；手机只做客户端，PC 负责推理。
等 Windows/Linux 稳定后，再评估小模型量化、ONNX、sherpa-onnx/whisper.cpp 离线 STT、移动端轻量 TTS。

---

## 3. 阶段阶梯

```text
Alpha 7   点击角色 + 45 OGG                                  ✓
Alpha 8   Voice Catalog + Semantic Router，中文对话/日语 TTS    ✓ 代码完成
          └ Windows Kurisu TTS (9881) 已跑通                    ✓ 2026-09-10
          └ 桌面端可双击图标启动（NSIS + 绿色版）                ✓ Phase 2g
Alpha 9   Windows Kurisu TTS + Android LAN                     ← 当前主线
          中文聊天 + 中文字幕 + 日语红莉栖发声
Alpha 10  Emotion Router：动作/表情/OGG/TTS 统一调度
Beta 1    自训练 Kurisu Voice v1
Beta 2    Desktop / Android 共用核心，legacy 清理完成
v1.0      稳定 AMA-DEUS（Android + Desktop，中文交互 / 日语角色语音，
          可切换本地或远程 LLM，稳定语音、记忆、表情、动作）
```

---

## 4. 工程纪律

1. **每一阶段必须有可运行版本、可回退版本、明确验收标准。**
2. **不允许 UI、语音、Live2D、LLM、平台适配同时大改。**
3. alpha.7 已验证的稳定性（点击 / OGG / 单语音 owner）不得在后续重构中反复丢失。
4. 语言合同只在 `tts-client.js` 与 `kurisu_tts_server.py` 两处定义，改一处必须同步另一处。
5. 凭听感修改 Voice Router 之前，先跑 Phase 4 的固定测试集。
