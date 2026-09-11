# 开发与维护

体系结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 1. 前置条件

| 需要 | 说明 |
| --- | --- |
| Node 22+ | 构建与契约测试 |
| macOS + Xcode | 只有出 IPA 时需要；**Windows / Linux 上做不了 iOS 构建** |
| NVIDIA GPU + GPT-SoVITS | 只有本地语音合成需要，见第 5 节 |

```bash
npm install
npm run build:render
npm run app                 # Electron 本地跑一遍（桌面调试）
```

> **VS Code 集成终端**里要先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，
> 否则 electron.exe 会退化成普通 Node 立刻退出。这个环境变量每个新 shell 都会带进来。

---

## 2. 契约测试

四个纯 Node 测试，毫秒级，**改动后必跑**：

```bash
npm run verify:contracts
```

| 文件 | 守住什么 |
| --- | --- |
| `tests/ios-runtime-contract.mjs` | iOS 运行时判定、Live2D 主交互路径、connect 不阻塞在 `ended` |
| `tests/ios-ui-audio-contract.mjs` | 字幕手势契约、**口型不得重新接管音频图**、文字必须在音频起播时才显示、TTS 传输 |
| `tests/ios-sheet-reachability-contract.mjs` | 设置面板可滚动且按钮不被固定悬浮层遮挡 |
| `tests/tts-transport-contract.mjs` | `/health` + HTTP WAV + 原生 base64 解码（对着 mock 服务） |

写契约测试的习惯：**断言要能因为正确的理由失败**。新加一条后，把对应的源码临时退回改动前
（`git checkout HEAD -- <file>`），确认它以你预期的信息失败，再恢复。空转的测试比没有测试更糟。

---

## 3. 拉取语音素材

45 条原版 OGG **不入库**（`THIRD_PARTY_NOTICES` 禁止通过仓库再分发）。
CI 在构建时下载，本地要跑完整语音链就自己取一次：

```bash
npm run voices:fetch        # 幂等，已存在的非空文件会跳过
npm run voices:verify       # 只检查，缺了就退出码 1
npm run build:render        # 复制进 dist/
```

没有它们时：点击角色不会发声，但 LLM 对话与 TTS 仍可用。

> CI 工作流里有一份**同样的文件名列表**（`curl` 循环）。改了一处要同步另一处，
> 否则会出现"本地有 45 条、CI 构建出来的少了"这种很难查的差异。

---

## 4. 出未签名 IPA

**必须走 GitHub Actions**（Windows 上无法构建 iOS）。

分支 `ios` 的**唯一**工作流 `build-ios-unsigned-ipa.yml`：

- **`unsigned-ipa`（阻塞）** — 只放确定性门禁：四个契约测试、`src/` 可达性审计、源码级
  断言、45 语音路由与长回复切块契约、渲染产物检查，然后建 Capacitor 壳、无签名编译、
  打 Payload。它还会断言包里**没有** `_CodeSignature` 和 `embedded.mobileprovision`，
  所以"未签名"是被验证的而不是假设的。
- **`simulator-regressions`（`continue-on-error`）** — 在模拟器上跑**全套** WKWebView
  回归测试。**它没权力扣下产物**：这套测试对模拟器时序敏感，历史上曾连红 7 次而产品代码
  本身没问题。

产物按版本号发一个正式 release：

```
https://github.com/rafiqxin/amadeus-pet/releases  →  ios-v0.2.0-alpha.7
```

> 早期用的是浮动 tag `ios-unsigned-latest` 并且标记为 prerelease —— GitHub 会把 prerelease
> 折叠在 "Pre-releases" 开关后面，结果就是**构建明明成功却看起来从未发布**。改成每版一个
> 真实 tag，可见性优先于一个会变的永久链接。
>
> 之前那三个 iOS 工作流（`build-ios-call-preview` / `build-ios-device-candidate` /
> `call-fidelity-preview`）已归档到 `legacy/workflows/`，它们跑的东西已并入保留的这一个。

未签名 IPA **不能直接安装**，iOS 要求用你自己的证书重签。用 AltStore / Sideloadly 过一遍。

### 本地验证渲染产物

不想等 CI 时，可以在 Electron 里用 iPhone 的 UA 跑真实渲染层：

```bash
# 1) 起一个带远程调试端口的实例（iPhone UA 由 CDP 注入）
# 2) 用 CDP 探测 DOM / 截图 / 合成手势
```

要点：

- 用 `Emulation.setUserAgentOverride` + `Page.reload` 才会进 iOS 分支
  （`--user-agent` 命令行开关不起作用）
- 打包版 AMA-DEUS 与开发实例**共用 userData**，所以会争单实例锁——先关掉其中一个
- Electron **不投递** `Input.dispatchTouchEvent`；测手势请用 `Input.dispatchMouseEvent`
  （产生 pointer 事件），或在页面内合成事件

---

## 5. 本地语音后端

```powershell
.\voice-server\run.ps1            # 只绑 127.0.0.1，桌面自用
.\voice-server\run.ps1 -Lan       # 绑 0.0.0.0，手机才连得上
```

**默认是回环地址**，手机要用必须 `-Lan`。

手机上填**电脑的局域网 IP**（`127.0.0.1` 在手机上指它自己）：

```
设置 → Kurisu TTS Endpoint →  http://<电脑局域网IP>:9881
```

确认监听地址：

```powershell
Get-NetTCPConnection -LocalPort 9881 -State Listen   # 应为 0.0.0.0
```

> 排错时注意：`http://<本机另一个IP>:9881/health` 返回 200 **不代表**手机连得上——
> 那是本机请求自己的地址，走本地回环。要确认哪个网卡真的 Up：
> `Get-NetAdapter | Where-Object Status -eq 'Up'`，
> 以及 `Get-NetIPAddress` 里 `AddressState` 是不是 `Preferred`（`Deprecated` 是残留地址）。

---

## 6. 排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 启动即退出，`ipcMain is undefined` | `ELECTRON_RUN_AS_NODE=1`，见第 1 节 |
| 开发实例起不来、无报错 | 打包版 AMA-DEUS 在跑，共用 userData 占了单实例锁 |
| 点角色不发声 | 45 条 OGG 没拉取（`npm run voices:fetch`） |
| **LLM 有文字但完全没声音** | 先看设置面板的 `VOICE:` 诊断行。若是 `TRANSLATE ✕`，多半是推理模型没关思考（见 ARCHITECTURE 第 7 节） |
| 语音输入报 `kAFAssistantErrorDomain 209` | 音频会话被占。识别前必须 `suspendVoiceAudio()` 交还会话，不能 `unlockVoiceAudio()` |
| 文字比语音早出现很多 | 文字必须在 `onStart` 才显示（`showLine()`），不能在 `routeAndSpeak` 之前渲染 |
| 嘴不动 / 跟语音对不上 | 确认没有重新引入 `createMediaElementSource`；看诊断里有无 `LIPSYNC ✓` |
| 长文本滑不动 | 字幕手势必须是 **pointer** 事件（ARCHITECTURE 第 9 节） |
| 设置面板「保存」点不到 | 面板必须可滚动；见 `ios-sheet-reachability-contract.mjs` |
| 本地能构建、CI 报 `Could not resolve './xxx.js'` | 该文件被 `.gitignore` 里的**裸目录名**误伤，从未提交。对比 `git ls-files src` 与盘上文件 |

---

## 7. 仓库约定

- **`src/` 只放产品路径上的文件。** 归档进 `legacy/` 并在 `legacy/README.md` 说明它被什么
  取代。`src/` 下不应存在无人 import 的模块。
- `.workspace/`、`dist/`、`node_modules/`、`preview/`、`voice-server/out/` 都不入库。
- **凭据只走 localStorage 或环境变量，永不入库。**
- `.gitignore` 里**不要写裸目录名**（`llm/` 会匹配任意层级的 `llm/`，曾经把
  `src/llm/client.js` 静默排除在所有提交之外）。要锚定根目录就写 `/llm/`。

### 改动的自检清单

1. `npm run verify:contracts` 全绿
2. 新增/删除文件后重跑一遍**可达性检查**（ARCHITECTURE 第 2 节），确认 `src/` 无孤儿
3. 改了说话行为 → 在 Electron 里用 iPhone UA 实跑一次，确认诊断行走完 `… → END ✓`
4. 改了手势 → 用 pointer 事件验，别用 touch
5. 改了打包/工作流 → 注意环境变量**不会**经桌面快捷方式传给应用（`.lnk` 由 shell 拉起，
   继承的是 Explorer 的环境）
