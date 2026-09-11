# legacy/ — 归档内容

这里的东西**不在构建路径上**，也不被任何生产代码 import。留着是为了可追溯和需要时取回，
不是为了运行。`src/` 里现在没有任何不可达模块（见 `docs/ARCHITECTURE.md` 的"可达性"一节）。

| 目录 | 原本是什么 | 被什么取代 | 为什么归档 |
| --- | --- | --- | --- |
| `cubism5-demo/` | Cubism 5 官方示例（`LAppModel` / `LAppDelegate` 全套）+ 一份自研 Cubism 5 渲染器（`src/live2d/app.js` 等 6 个文件）+ 示例入口 `index.html` | `src/live2d/cubism2app.js`（pixi + **Cubism 2.1**） | 它靠 `@framework/*` 别名解析到 `cubism5-demo/vendor/Framework/`，而当前的 `vite.config.js` **已经不再定义这个别名** —— 也就是说它在搬走之前就已经编译不过，只是没人发现 |
| `cubism5-demo/vendor/Framework/` | Cubism SDK for Web 的 Framework 源码（83 个文件） | 同上；Cubism 2 用的是 `public/live2d.min.js` | 只有 Cubism 5 那套需要它 |
| `cubism5-demo/run.sh` | 旧启动脚本，优先跑 `release/linux-unpacked` | `npm run app` / `npm start` | 引用的是已经不存在的打包路径 |
| `pet-v1/` | 早期桌宠层：`interactions.js`（鼠标交互）、`memory.js`（关键词记忆）、`voice.js`（Web Speech API 语音）、`llm.js`（本地 llama.cpp 客户端） | 交互 → `src/main.js` + `src/pet/touch-reactions.js`；记忆 → 会话历史；语音 → Kurisu TTS（日语）；LLM → `src/llm/client.js` | 全部无人 import。**注意 `llm.js` 里的三层人格 prompt 没有被丢掉**，已经提取到 `src/llm/persona.js` 并接进生产路径 |
| `models/Haru` `Mao` `Wanko` | Live2D 官方示例模型 | `models/kurisu/`（Cubism 2.1） | 生产只加载 Kurisu。仍在 git 里，但**见下方的授权提醒** |
| `scripts/llm.sh` | 本地 llama.cpp 启动脚本 | 无（改用远端 OpenAI 兼容 API） | 对应的 `pet-v1/llm.js` 已归档 |
| `tools/recolor-haru.py` | 给 Haru 模型重着色成红莉栖配色 | `models/kurisu/` 自有模型 | 底模已经不在了 |
| `workflows/` | 三个被取代的 CI 工作流（见下） | `.github/workflows/build-ios-unsigned-ipa.yml` | 触发分支已删除，且职责与保留的那个重叠 |

### 归档的 CI 工作流

| 文件 | 原本做什么 | 为什么归档 |
| --- | --- | --- |
| `build-ios-call-preview.yml` | 全套 XCUITest **当硬门禁**放在打包之前 | 它对模拟器时序敏感，曾连红 7 次而产品代码本身没问题 —— 一个动画抖一下就能扣下一个好构建。它跑的全套测试已并入保留工作流的 `simulator-regressions` 任务（非阻塞） |
| `build-ios-device-candidate.yml` | 产出同样的未签名 IPA | 与保留工作流完全重叠，只是不发 release |
| `call-fidelity-preview.yml` | 触发分支 `chatgpt/amadeus-reference-ui` | 该分支已删除，工作流永远不会再触发 |

保留的是一个工作流、两个任务：`unsigned-ipa` 只放确定性门禁并产出 IPA 与 release，
`simulator-regressions` 跑全套 WKWebView 测试但**没有权力扣下产物**。

## ⚠️ 授权提醒

`legacy/models/{Haru,Mao,Wanko}` 是 Live2D 官方示例数据，`THIRD_PARTY_NOTICES` 写明
**"may not be redistributed outside this application"**。它们目前仍然被 git 跟踪（86 个文件）。

`main`（桌面端分支）的做法是把它们移出 git、只留在本地磁盘：

```bash
# 确认没有代码引用后再执行；文件仍会留在工作区
printf 'legacy/models/Haru/\nlegacy/models/Mao/\nlegacy/models/Wanko/\n' >> .gitignore
git rm -r --cached legacy/models/Haru legacy/models/Mao legacy/models/Wanko
```

需要时从 Live2D Cubism 示例包重新获取即可。

## 从归档里取回

`cubism5-demo/` 内部的相对路径保持了原样（`src/demo-main.ts` 仍然 `import './demo/main'`），
所以整个目录搬回仓库根就能恢复原来的结构。要让它重新可构建，还得在 `vite.config.js` 里
补回 `@framework` 别名指向 `cubism5-demo/vendor/Framework/src`。
