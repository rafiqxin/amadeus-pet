# AMA·DEUS

非官方同人项目：受《命运石之门 0》中 Amadeus 系统启发的桌面 AI 终端。
中文界面、中文字幕，红莉栖**始终以日语发声**——优先播放原版语音，匹配不到时由
本地 GPT-SoVITS 用她本人的音色合成。

> 本项目与 MAGES. / Nitroplus / 5pb. 无关。代码与 UI 为原创；角色语音训练素材由
> 项目作者自行准备，模型为可替换的本地权重。

---

## 语言合同（唯一不可动摇的规则）

```
用户输入 / STT  →  中文
LLM 回复        →  中文
界面 / 字幕      →  中文
角色发声        →  日语      ← 只有这一层是日语
```

这条规则只在两处定义，改一处必须同步另一处：

| 位置 | 作用 |
| --- | --- |
| `src/voice/tts-client.js` | `TTS_OUTPUT_LANGUAGE = 'ja'`，非 `ja` 请求直接抛错 |
| `voice-server/kurisu_tts_server.py` | 服务端再次校验，非 `ja` 返回 400 |

中文→日语的翻译属于 **LLM 层**（`translateForKurisuTts`），永远不属于语音后端。
不会回退到 Android/Web Speech 的系统女声。

---

## 语音链路

```
中文输入
  └─ DeepSeek 中文回复
       └─ Semantic Router
            ├─ 高置信度命中  → 原版 OGG（45 条，红莉栖原声）
            └─ 否则          → 中文回复翻译为日语
                                 └─ Kurisu TTS (:9881) → WAV
                                      └─ 播放 + 口型同步
```

**单语音 owner**：一次回复从发送到播放结束期间，点击角色不会触发 touch OGG ——
否则 `playVoicePlayback()` 会把正在播的回复掐断。

**字幕与语音同起同落**：生成期间显示思考点，音频**真正起播**时才出字幕，
播完才消失。实现在 `src/voice/player.js` 的 `onStart` 回调。

---

## 快速开始

### 1. 语音后端（Windows，需要 NVIDIA GPU）

```powershell
.\voice-server\run.ps1          # 127.0.0.1:9881（桌面端默认端点）
.\voice-server\run.ps1 -Lan     # 0.0.0.0:9881，供 Android 通过局域网访问
```

首次需要搭建环境（conda env `GPTSoVits`：PyTorch + GPT-SoVITS + Kurisu 权重）。
详见 `voice-server/README.md` 与 `ROADMAP.md` 的 Phase 2。

验证：

```bash
python voice-server/verify.py --inproc                  # 进程内，加载模型并合成
python voice-server/verify.py --url http://127.0.0.1:9881
node tools/verify-voice-client.mjs                      # 跑 app 自己的 TTS 客户端
```

### 2. 桌面端

```bash
npm install
npm run build:render
npm run app          # = electron .
```

> **若在 VS Code 集成终端里启动**：先清除 `ELECTRON_RUN_AS_NODE`。
> VS Code 会把它传进来，导致 electron.exe 退化成普通 Node，报
> `ipcMain is undefined` 并立刻退出。
> ```powershell
> Remove-Item Env:ELECTRON_RUN_AS_NODE
> ```

### 3. 首次运行：45 条原版 OGG

`public/Resources/amadeus-voices/` 不入库，需要拉取一次（CI 也是这么做的）：

```bash
npm run voices:fetch
```

没有它时角色点击不会发声，但 LLM 对话与 TTS 仍可用。

### 4. 配置 LLM

启动后点 CONNECT，右下角 ⚙ 打开设置，填写：

| 字段 | 示例 |
| --- | --- |
| Endpoint | `https://api.deepseek.com` |
| Model | `deepseek-flash` |
| API Key | `sk-...` |

配置存在 Electron 的 localStorage（`%APPDATA%\amadeus-pet`），**不进仓库**。
点「保存并测试」可同时检查 LLM 与 TTS。

> **推理模型注意**：`src/llm/client.js` 会对所有请求附带 `NO_REASONING`
> （`thinking:{type:"disabled"}` + `reasoning_effort:"none"`）。不关掉思考时，
> `deepseek-flash` 会把 `max_tokens` 全烧在 `reasoning_content` 上并返回空
> `content`，翻译与分类调用会直接失败；主对话也会慢一倍（3.0s → 1.6s）。
> 换成不支持这两个参数的后端时会自动去掉重试一次。

---

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `index.html` · `src/main.js` | **产品入口**：组装 Live2D + UI + 对话/语音流程 |
| `src/llm/client.js` | LLM 层：中文对话、OGG 分类、中文→日语翻译 |
| `src/voice/` | 语音核心：catalog / semantic-router / pipeline / player / tts-client |
| `src/pet/` | 情绪映射与触摸台词 |
| `src/live2d/` | Cubism 2 渲染与口型驱动 |
| `src/ui/` | AMA-DEUS 界面外壳（状态栏、字幕、思考点、面板） |
| `src/platform/` | 平台适配（中文语音识别） |
| `voice-server/` | **语音后端**：9881 服务、参考音库、验收脚本 |
| `electron/` | 窗口、拖拽、IPC 桥 |
| `tools/` | 下载器与验证工具 |
| `docs/` | [架构](docs/ARCHITECTURE.md) · [开发指南](docs/DEVELOPMENT.md) |
| `legacy/` | 归档的早期实现，不在构建路径上（见 [legacy/README.md](legacy/README.md)） |
| `.workspace/` | 本地大文件（GPT-SoVITS 源码与权重），不入库 |

---

## 验证工具

| 命令 | 检查内容 |
| --- | --- |
| `node tools/verify-voice-client.mjs` | 用 app 自己的 `tts-client.js` 校验 9881 契约 |
| `node tools/verify-speech-chain.mjs` | 中文输入 → 中文回复 → 日语翻译 → TTS 全链路 |
| `python voice-server/verify.py` | Phase 2 验收（模型加载 + 三情绪合成 + 语言护栏） |

---

## 平台注意事项

- **窗口尺寸**：透明无边框窗口在 Windows 上每次几何调用会**长高 1px**。
  `electron/main.cjs` 用「拖动开始时锁死尺寸」的方式消除累积（实测 30 次移动净增长为 0）。
  该文件里不要重新引入 `setAspectRatio`、`minHeight`——它们会和窗口管理器互相触发，
  造成每秒几十次的 resize 风暴。手机比例由 `src/style.css` 的 CSS 维持。
- **窗口移动**：拖手机边框（刘海或机身，最外圈 10px 留给系统缩放）。
- **关闭**：状态栏右上角 `×`，或右侧电源键，或任务栏。
- `electron/main.cjs` 支持 `AMA_TRACE_BOUNDS=1` 输出窗口尺寸变更日志，用于排查此类问题。

---

## 许可

代码 MIT。模型资源（Kurisu Cubism 2 模型、45 条 OGG、GPT-SoVITS 权重）遵循各自
上游许可，见 `THIRD_PARTY_NOTICES/` 与各子目录说明。请勿分发未授权素材。
