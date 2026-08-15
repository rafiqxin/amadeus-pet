# models/ 目录说明

本目录存放桌宠使用的 Live2D 模型（`.model3.json` + `.moc3` + 动作/表情/物理/贴图）。

## 当前占位模型

- `Haru/`：Live2D 官方示例角色 Haru（出自 [Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples) 与 Live2D 官方 SDK 样例数据）。
  - 遵循 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 与 [Live2D Sample Model Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)。
  - 依据该许可，本项目对**贴图颜色**做了原创性修改（白发改栗红，详见 `tools/recolor-haru.py`）以呈现"助手"风格；角色几何、动作、参数均保持原样。
  - 发布时需保留 Live2D 版权声明：本内容使用了 Live2D Inc. 拥有版权的示例数据（见 `THIRD_PARTY_NOTICES/`）。
- `Mao/`、`Wanko/`：同样来自官方示例数据，未修改，可用于切换测试。

## 换成你自己的模型

1. 将模型目录放入 `models/<名字>/`，确保包含 `<名字>.model3.json`；
2. 修改 `src/main.js` 中的 `ModelDir` 与 `ModelJson`；
3. `npm run build:render && npm run app`。

请仅使用你拥有授权（自建、购买或经许可）的模型，勿放入未授权的商业角色模型。
