# legacy/ — 归档内容

这里的东西**不在构建路径上**，也不被任何生产代码 import。留着是为了可追溯和需要时取回，
不是为了运行。`src/` 里现在没有任何不可达模块。

判断方式（新增文件后值得重跑）：

```bash
npm run audit:src     # 从 index.html 走 ESM import 图 + CSS @import，列出无人引用的文件
```

| 目录 | 原本是什么 | 被什么取代 | 为什么归档 |
| --- | --- | --- | --- |
| `cubism5-demo/` | Cubism 5 官方示例（`LAppModel` / `LAppDelegate` 全套）+ 一份自研 Cubism 5 渲染器（`src/live2d/app.js` 等 6 个文件）+ 示例入口 `index.html` + `run.sh` | `src/live2d/cubism2app.js`（pixi + **Cubism 2.1**） | 它靠 `@framework/*` 别名解析到 `cubism5-demo/vendor/Framework/`，而当前的 `vite.config.js` **已经不再定义这个别名** —— 也就是说它在搬走之前就已经编译不过，只是没人发现 |
| `cubism5-demo/vendor/Framework/` | Cubism SDK for Web 的 Framework 源码（83 个文件） | 同上；Cubism 2 用的是 `public/live2d.min.js` | 只有 Cubism 5 那套需要它 |
| `pet-v1/` | 早期桌宠层：`dialog-bank` / `dialogue`（本地台词库）、`interactions`（鼠标交互）、`memory`（关键词记忆）、`settings` / `tone`、`voice`（Web Speech API）、`llm`（本地 llama.cpp 客户端） | 对话 → `src/llm/client.js`；触摸台词 → `src/pet/touch-reactions.js`；情绪 → `src/pet/reaction.js`；语音 → Kurisu TTS（日语） | 安卓入口 `src/main.js` 只 import 了 `reaction` 与 `touch-reactions` |
| `ui-v1/` | 桌面版 HUD / 气泡 / 移动端面板（`hud.*`、`bubble.*`、`mobile.*`、`reference-ui.css`） | `src/ui/amadeus.js` + `amadeus.css`（Java 版 Amadeus 风格界面） | 安卓入口只用 `boot` 与 `amadeus` 两套 UI |
| `workflows/` | 两个失效的 CI 工作流 | 见下 | 触发分支已删除 |

### 归档的 CI 工作流

| 文件 | 原本做什么 | 为什么归档 |
| --- | --- | --- |
| `build-ios-call-preview.yml` | 在安卓分支上还留着一份 iOS 构建 | iOS 由 `ios` 分支的 `build-ios-unsigned-ipa.yml` 负责；这里的副本触发分支也已不存在 |
| `call-fidelity-preview.yml` | 触发分支 `chatgpt/amadeus-reference-ui` | 该分支已删除，工作流永远不会再触发 |

保留下来的只有一个：`build-android-apk.yml`，触发分支 `android`。

## 从归档里取回

`cubism5-demo/` 内部的相对路径保持了原样（`src/demo-main.ts` 仍然 `import './demo/main'`），
所以整个目录搬回仓库根就能恢复原来的结构。要让它重新可构建，还得在 `vite.config.js` 里
补回 `@framework` 别名指向 `cubism5-demo/vendor/Framework/src`。
