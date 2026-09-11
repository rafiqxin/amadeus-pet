# legacy/

Archived code kept for reference. **Nothing here is on the product build path** —
the renderer is `index.html` → `src/main.js`, and the voice backend is
`voice-server/`. These directories exist so earlier work stays readable and
recoverable rather than being deleted outright.

Verified before archiving: none of these files are reachable from `src/main.js`
(import graph traced), and the production build still emits exactly what the
Android CI asserts.

---

## `cubism5-demo/`

The official Cubism 5 sample runtime, used as the original placeholder shell.

| path | what it is |
| --- | --- |
| `demo.html` | the alternate entry (was loaded when `AMA_DEMO` was set) |
| `src/demo-main.ts`, `src/demo/*` | `lapp*` sample controllers |
| `vendor/Framework` | Cubism 5 TypeScript framework source |
| `public/Core` | `live2dcubismcore.min.js` (222 kB) |
| `public/Shaders`, `public/Framework`, `public/Haru` | sample shaders and assets |

The product shell is Cubism **2.1** (`.moc`), which loads `public/live2d.min.js`
instead. Keeping the Cubism 5 runtime alongside it only made the bundle and the
repo harder to read — `AMA_DEMO` was removed from `electron/main.cjs` at the same
time.

## `desktop-v1/`

The desktop pet as it existed before the AMA-DEUS voice work.

| path | superseded by |
| --- | --- |
| `src/live2d/{app,define,manager,model,pal,texturemanager}.js` | `src/live2d/cubism2app.js` |
| `src/pet/{dialog-bank,dialogue,memory,tone,settings}.js` | `src/pet/reaction.js` + `src/pet/touch-reactions.js` |
| `src/pet/llm.js` | `src/llm/client.js` |
| `src/pet/voice.js` | `src/voice/{catalog,player,pipeline}.js` |
| `src/pet/interactions.js` | never imported, at any point |
| `src/ui/{hud,bubble,mobile}.*`, `reference-ui.css` | `src/ui/amadeus.*` |
| `scripts/`, `tools/` | Android/iOS steps that are now the CI workflows; Haru recolouring |

`src/pet/interactions.js` is worth calling out: it was the window-drag handler
and had been dead code for the project's whole life, which is why the window
could not be dragged until the shell drag handle was written in `src/main.js`.

## `models/`

- `Haru/`, `Mao/`, `Wanko/` — Cubism 5 sample models used as placeholders.
  `vite.config.js` copies only `models/kurisu`, so these never reached a build.
  **Not committed**: `THIRD_PARTY_NOTICES` states the Live2D sample data may not
  be redistributed outside the application, and `legacy/` is not the
  application. They are listed in `.gitignore`; restore them from the Live2D
  Cubism sample pack if you need to run the old shell.
- `kurisu-sounds/` — the per-motion MP3s (`flickHead_*.mp3`, …) that the Kurisu
  model originally referenced. Alpha 7 replaced them with the 45-clip OGG
  catalog, and the build now asserts `dist/models/kurisu/sounds` does not exist.

## `tools-tts/`

The first Kurisu TTS design: a `ama_tts_proxy.py` bridge on :9881 forwarding to
GPT-SoVITS' stock `api_v2.py` on :9880, plus Linux/Windows launcher scripts.

`voice-server/kurisu_tts_server.py` replaces it. It loads GPT-SoVITS in-process,
so there is no :9880 hop, it enforces a single voice owner, and it maps the app's
emotion vocabulary onto reference clips. The Android CI assertion that used to
read the proxy's `OUTPUT_LANG` now reads the server's `OUTPUT_LANGUAGE`.

## `run.sh`

Launched the packaged Linux build from `release/linux-unpacked`. `npm run app`
covers local development.
