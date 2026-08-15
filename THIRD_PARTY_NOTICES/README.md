# Third-party notices

## Live2D Cubism SDK for Web (Core / Framework / Shaders / Sample data)

This project uses the Live2D Cubism SDK for Web, © Live2D Inc.

- Cubism Core is provided under the [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) (`CubismSdk-LICENSE.md`).
- Framework and sample source code are provided under the [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).
- Sample models (Haru, Mao, Wanko) are provided under the [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) and the [Live2D Sample Model Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html).

This content uses sample data owned and copyrighted by Live2D Inc. The sample data may not be redistributed outside this application, and must retain this notice. "Haru", "Mao" and "Wanko" are original characters of Live2D Inc.

See `CubismSdk-NOTICE.md` for the SDK's own notice text.

## Live2D Cubism 2.1 Web framework (live2d.min.js)

`public/live2d.min.js` is the official Live2D Cubism 2.1 Web framework redistributable, © Live2D Inc. Its embedded license permits copying and redistribution of the redistributable code; the full terms are linked inside the file header. It is required at runtime for loading legacy Cubism 2 (`.moc`/`.mtn`) models.

## Local LLM (optional soul)

- [Qwen2.5-7B-Instruct (GGUF Q4_K_M)](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF) — Apache-2.0 License (weights are NOT bundled with the app; downloaded locally by the user via `scripts/llm.sh`).
- [llama.cpp](https://github.com/ggml-org/llama.cpp) — MIT License (prebuilt binary; source tree not redistributed).

## pixi.js and pixi-live2d-display

- [pixi.js](https://github.com/pixijs/pixijs) — MIT License.
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — MIT License (Cubism 2 rendering path).
