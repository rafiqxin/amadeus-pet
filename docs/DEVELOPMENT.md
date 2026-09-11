# 开发指南

从零把项目跑起来、验证改动、以及踩过的坑。

---

## 1. 前置条件

| 需要 | 说明 |
| --- | --- |
| Node.js ≥ 22 | 构建渲染层与运行 Electron |
| Python 3.10 + NVIDIA GPU | **仅语音后端需要**；没有它角色不出声，但对话与界面照常 |
| 一个 OpenAI 兼容的 LLM | DeepSeek / 本地 llama.cpp 等，见第 5 节 |

## 2. 首次运行

```bash
npm install
npm run voices:fetch      # 拉取 45 条原版 OGG（不入库）
npm run build:render
npm run app               # = electron .
```

> **如果在 VS Code 的集成终端里启动，先清除 `ELECTRON_RUN_AS_NODE`。**
> VS Code 会把它传进来，导致 `electron.exe` 退化成普通 Node，
> 报 `ipcMain is undefined` 并立刻退出。
>
> ```powershell
> Remove-Item Env:ELECTRON_RUN_AS_NODE
> npm run app
> ```

`npm run voices:fetch` 是必须的：45 条 OGG 属于作者自有素材，不在仓库里。
跳过它角色点击不会发声，但其余功能正常。

## 3. 语音后端

见 `voice-server/README.md`（服务契约与运行方式）与 `ROADMAP.md` 的 Phase 2
（完整环境搭建：PyTorch + GPT-SoVITS + Kurisu 权重 + NLTK / OpenJTalk 数据）。

```powershell
.\voice-server\run.ps1          # 127.0.0.1:9881
.\voice-server\run.ps1 -Lan     # 0.0.0.0:9881，供 Android 通过局域网访问
```

桌面端默认就连 `http://127.0.0.1:9881`，无需配置。

## 4. 验证改动

三个工具，从外到内：

```bash
# 1) 用 app 自己的 tts-client.js 校验 9881 契约（不需要 LLM）
npm run verify:client

# 2) 中文输入 → 中文回复 → 日语翻译 → TTS 全链路（需要 LLM 凭据）
AMA_LLM_ENDPOINT=https://api.deepseek.com \
AMA_LLM_MODEL=deepseek-flash \
AMA_LLM_KEY=sk-... \
npm run verify:chain

# 3) 语音后端自身的验收：模型加载 + 三情绪合成 + 语言护栏
python voice-server/verify.py --inproc
python voice-server/verify.py --url http://127.0.0.1:9881
```

`verify:client` 与 `verify:chain` 都只读环境变量，**不会把凭据写进任何文件**。

## 5. 配置 LLM

启动后点 CONNECT → 右下角 ⚙：

| 字段 | 示例 |
| --- | --- |
| Endpoint | `https://api.deepseek.com` |
| Model | `deepseek-flash` |
| API Key | `sk-...` |

点「保存并测试」会同时检查 LLM 与 TTS。配置存放在 Electron 的 localStorage
（`%APPDATA%\amadeus-pet`），**不进仓库**。

本地模型模式：把 endpoint 留空即走 `http://127.0.0.1:8090`
（`scripts/llm.sh` 可拉起 llama.cpp）。

## 6. 修改语音行为

**新增一条原版语音**

1. 把 `<id>.ogg` 放进 `public/Resources/amadeus-voices/`
2. 在 `tools/fetch-voices.mjs` 的 `CLIPS` 里加同名条目（保持 CI 可复现）
3. 在 `src/voice/catalog.js` 加条目：`id / file / mood / zh / intent / tags`
4. `npm run build:render`

`catalog.js` 里的 `zh` 与 `tags` 会进入 LLM 分类器的 prompt，写得越贴近用户的
说法，命中率越高。

**新增一组情绪音色**

1. 把参考 wav 放进 `.workspace/tts/models/kurisu/`（必须是训练集里的真实录音）
2. 在 `voice-server/references.json` 的 `references` 加一组，
   `aliases` 里把情绪词指过去
3. 重启语音服务

## 7. 排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 启动即退出，`ipcMain is undefined` | `ELECTRON_RUN_AS_NODE=1`，见第 2 节 |
| 界面全黑、模型不出现 | 检查 `public/live2d.min.js` 是否存在；控制台有无异常 |
| 点击角色不发声 | 45 条 OGG 没拉取（`npm run voices:fetch`） |
| 长回复没有语音 | 语音服务是否在线；`curl 127.0.0.1:9881/health` |
| `LookupError: averaged_perceptron_tagger_eng` | NLTK 数据缺失，见 `ROADMAP.md` Phase 2e。日语译文里出现拉丁字母（如 `CTC`）时才会触发 |
| 翻译/分类返回空 | LLM 是推理模型且未关闭思考，见 `ARCHITECTURE.md` §8 |
| 窗口拖动时缓慢变大 | 不应再出现。设 `AMA_TRACE_BOUNDS=1` 看尺寸日志定位 |
| 合成很慢 | 正常：约 0.1 s / 日语字符（RTX 4060）。700 字约 70 s |

## 8. 构建产物

```bash
npm run pack       # 免安装目录版 → release/win-unpacked/
npm run dist:win   # 安装程序 + 单文件绿色版 → release/
npm run dist       # 当前平台（Linux 上产出 AppImage）
```

Windows 安装程序用 NSIS：装到 `%LOCALAPPDATA%\Programs\AMA-DEUS`，建桌面与开始菜单
快捷方式，`perMachine:false` 所以不需要管理员。`build/` 里的
`icon.ico` / `icon.png` 由 `npm run icons` 从 `icon-src.png` 生成
（源图取自 Java 版仓库的 `ic_launcher-web.png`）。

打好的包**只含 `dist/` + `electron/` + `package.json`**（`files` 里显式排除了
`node_modules`）：渲染层需要的依赖已被 Vite 打进 `dist/assets/`，主进程只 require
`electron` 和 `path`，所以 asar 约 11 MB，不含任何 `node_modules`。

几个必须记住的点：

- `electronDist` 指向 `node_modules/electron/dist`，打包不会重新下载 Electron。
- `electron/main.cjs` 里 `app.setPath('userData', …/amadeus-pet)` 是**故意的**：
  否则 `productName`（AMA-DEUS）会让打包版和 `npm start` 各存一份 LLM/TTS 配置。
- 窗口图标由 `windowIcon()` 解析：打包后读 `process.resourcesPath/icon.png`
  （`extraResources` 里映射过去的），开发时读 `build/icon.png`。
- 验证打包版是否真的渲染出来，而不是只起了进程：
  ```bash
  AMA_CAPTURE=preview/packed.png AMA_CAPTURE_DELAY=10000 \
    ./release/win-unpacked/AMA-DEUS.exe --remote-debugging-port=9223
  node tools/cdp-shot.cjs 9223 preview/packed-shot.png   # 另一条路：CDP 截图
  ```
  注意 `AMA_CAPTURE` 这类环境变量**经由桌面快捷方式启动时不会生效**——
  `.lnk` 是 shell 拉起的，继承的是 Explorer 的环境。

Android 由 `.github/workflows/build-android-apk.yml` 构建：它会拉取 45 条 OGG、
断言语言合同、并把 `legacy/` 排除在 APK 之外。**改动了合同相关代码就跑一次
那个工作流的断言逻辑**（见该文件 "Verify voice catalog…" 一步）。

## 9. 仓库约定

- `src/` 只放**产品路径**上的文件。归档内容进 `legacy/`，并在
  `legacy/README.md` 说明它被什么取代。
- `.workspace/`、`dist/`、`node_modules/`、`preview/`、`voice-server/out/`
  都不入库。
- 凭据只走环境变量或 localStorage，永不入库。
