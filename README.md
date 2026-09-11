# AMA·DEUS

非官方同人项目：受《命运石之门 0》中 Amadeus 系统启发的**手机形态 AI 终端**。
用户用中文交流，界面与字幕保持中文，红莉栖始终以**日语**发声——优先使用原版片段，
匹配不到时由本机的 Kurisu TTS 生成。

产品主线是 **iOS 客户端**：Capacitor 壳 + WKWebView 渲染层，同为桌面 Electron 版所复用
（同一套 `src/`）。桌面端另见 `chatgpt/amadeus-core-workspace` 分支。

> 本项目与 MAGES. / Nitroplus / 5pb. 无关。代码与 UI 为原创；角色模型、语音片段与
> 合成权重遵循各自上游许可，见 `THIRD_PARTY_NOTICES/`。

---

## 界面

CALL 画面是照 Java 版 Amadeus 的观感手绘复刻的，**这层视觉设计是刻意保留的**：

- 顶部仿制状态栏（`XP </> USB`、信号、电量、时间）
- 底部三键 dock（文字通信 / 语音输入 / 连接设置）
- 字幕框使用 `subtitle_frame_big.png` 这张手绘边框
- 全屏 Live2D 立绘，无手机边框——手机本身就是边框

改功能时**不要重排这层结构**。

---

## 快速开始

```bash
npm install
npm run build:render      # 构建渲染层到 dist/
npm run app               # Electron 跑一遍（桌面调试用）
```

> **在 VS Code 集成终端里启动**要先清掉 `ELECTRON_RUN_AS_NODE`，否则 electron.exe
> 会退化成普通 Node 并立刻退出：`Remove-Item Env:ELECTRON_RUN_AS_NODE`

45 条原版 OGG**不入库**（授权原因），CI 在构建时拉取。本地要跑完整语音链需要先取一次：

```bash
npm run voices:fetch      # 幂等；npm run voices:verify 只检查
npm run build:render
```

---

## 它需要两台机器

语音是在**你自己的电脑上**合成的，不是云端：

```
iPhone (AMA-DEUS)  ──局域网──▶  PC: Kurisu TTS 服务 (0.0.0.0:9881, GPT-SoVITS v2 + CUDA)
        │
        └──HTTPS──▶ LLM（OpenAI 兼容，如 api.deepseek.com）
```

所以手机上必须把 TTS 端点填成电脑的**局域网 IP**（`127.0.0.1` 在手机上指它自己）：

```
设置 → Kurisu TTS Endpoint →  http://<电脑局域网IP>:9881
```

电脑侧服务要用 `-Lan` 启动，否则只绑回环地址：

```powershell
.\voice-server\run.ps1 -Lan
```

点「保存并测试」会按 `CONFIG → HEALTH → TRANSLATE → SYNTH → DECODE → PLAY → END`
逐步显示诊断，断在哪一环一眼可见。

---

## 许可

代码 MIT。模型、语音片段与合成权重遵循各自上游许可，见 `THIRD_PARTY_NOTICES/`。
请勿分发未授权素材。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统结构：启动流程、UI 分层、语音管线、人格层、口型、设计不变量 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发与维护：构建、测试、CI、打包、排查 |
| [legacy/README.md](legacy/README.md) | 归档内容清单，以及它们各自被什么取代 |
