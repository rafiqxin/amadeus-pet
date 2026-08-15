# AMA·DEUS Desktop Pet

非官方同人桌宠项目：受《命运石之门 0》中 Amadeus 系统启发，用 **Electron + Live2D Cubism Web SDK** 构建的桌面宠物。本项目的代码、UI 与台词均为原创；角色模型使用 Live2D 官方示例模型作为可替换占位底模，并预留一键替换自有授权模型的接口。

> 本项目与 MAGES. / Nitroplus / 5pb. 无关，不包含任何官方美术、音频、台词或模型素材。

## 技术栈

- **Electron**：透明、无边框、置顶桌宠窗口（自定义拖拽 + 鼠标穿透）
- **Vite**：渲染层构建
- **Live2D Cubism SDK for Web (Cubism 5)**：模型渲染、动作、视线追踪
- **PIXI.js**：WebGL 渲染上下文（官方示例同款方案）

## 目录结构

```
electron/main.cjs     主进程：窗口、拖拽 IPC、鼠标穿透
electron/preload.cjs  渲染层桥接
src/main.js           渲染层入口（组装 pet + HUD + 交互）
src/pet/              Live2D 管线、交互、对话、设置
src/ui/               HUD 控制台、气泡
models/               模型资源（.model3.json / .moc3 / .motions）
```

## 功能

- **启动屏**：Amadeus 风格 boot sequence（扫描线、检查项、辉光 Logo、进度条）
- **桌宠核心**：拖拽移动、双击停靠屏幕底部、点击头部换表情/身体触发动作、视线跟随鼠标、待机随机动作、说话口型同步（官方 LipSyncUpdater + 自研驱动）
- **HUD 控制台**（TERM 页）：状态栏（时间/LINK/未读角标）、SIGNAL MONITOR 波形、COMM.LOG 对话（可打字）、缩放/透明度/语音/模型切换、贴边停靠
- **通话界面**（CALL 页）：圆形 PERSONA LINK 监视器、声纹动画、CALL ACTIVE/HOLD 状态、通话控制
- **语音**：Web Speech API（无语音时自动纯文字模式）
- **模型内核切换**：Haru（助手·A型，栗红长发+黑丝重着色）/ Mao / Wanko 循环切换
- **URL 演示钩子**：`#call` 自动打开通话界面；`#m1` 自动切换一次模型

## 运行

```bash
npm install
npm run build:render
npm run app          # 或 npx electron . --no-sandbox（Linux 虚拟机）
# 或直接 ./run.sh（优先使用 release/linux-unpacked 打包产物）
```

## 模型授权说明

- 占位模型来自 Live2D 官方示例数据（[Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples)），仅用于功能演示。
- 想换成你自己的模型：把模型目录放到 `models/<name>/`（内含 `*.model3.json` 及依赖资源），然后修改 `src/main.js` 中的模型路径。
- 请勿将任何未授权的商业角色模型放入本项目分发。

## 许可

代码部分 MIT。模型资源遵循其各自上游许可证（见 `models/README.md`）。
