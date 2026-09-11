# voice-server — AMA-DEUS Kurisu TTS

The **single voice owner** of AMA-DEUS: one process, one GPU, one voice.
It turns Japanese speech text into audio and speaks for红莉栖 while the rest of
the app stays Chinese.

```
中文输入 → DeepSeek 中文回复 → Semantic Router
                                  ├── 高置信度 → 原版 OGG (crs_*.ogg)
                                  └── 否则     → 日语翻译 → [ 本服务 :9881 ] → WAV
```

The language contract is enforced **here** and in `src/voice/tts-client.js`, and
nowhere else. Chinese never reaches this service; Japanese never reaches the UI.

---

## HTTP contract

Implemented to match `src/voice/tts-client.js` exactly.

### `GET /health`

```json
{
  "ok": true,
  "engine": "kurisu-gpt-sovits-v2",
  "version": "v2",
  "language": "ja",
  "device": "cuda",
  "model_loaded": true,
  "busy": false,
  "syntheses": 12,
  "last_synth_ms": 1840,
  "moods": ["annoyed", "bright", "normal"],
  "reference_count": 3,
  "cuda": "NVIDIA GeForce RTX 4060 Laptop GPU",
  "vram_allocated_mb": 2103
}
```

The client treats the service as available when HTTP 200 **and** `ok !== false`.
`model_loaded` is informational — the first request triggers the load if warmup
has not finished yet.

### `POST /v1/tts`

```json
{ "text": "そうね、その通りだわ。", "language": "ja", "mood": "annoyed" }
```

| field | required | notes |
| --- | --- | --- |
| `text` | yes | **Japanese only.** Non-`ja` is rejected with 400. |
| `language` | no | defaults to `ja`; anything else is rejected |
| `mood` | no | selects the reference clip; unknown values fall back to `normal` |

Returns `audio/wav` (mono, 16-bit PCM, 32 kHz) plus headers:

```
x-amadeus-tts-engine: kurisu-gpt-sovits-v2
x-amadeus-tts-mood: annoyed
x-amadeus-tts-reference: crs_0128.WAV_0000000000_0000191040.wav
x-amadeus-tts-elapsed-ms: 1840
```

### `GET /v1/references`

Lists the loaded voice bank (mood, clip, whether prompt text is set).

---

## Running it

```bash
# local only (desktop app default endpoint: http://127.0.0.1:9881)
python voice-server/kurisu_tts_server.py

# expose to the Android build over WiFi
python voice-server/kurisu_tts_server.py --lan
#   -> logs the LAN endpoint, e.g. http://192.168.1.23:9881
```

The server loads GPT-SoVITS **in-process**. GPT-SoVITS' own stock API
(`api_v2.py`, port 9880) is untouched and can still be started separately for
WebUI / training work — this service does not proxy through it, which removes a
network hop and a whole class of failure from the chat path.

Set the endpoint in the app to the URL above; on mobile the client leaves the
endpoint empty by default and expects you to fill it in.

### Environment variables

| variable | default | purpose |
| --- | --- | --- |
| `AMADEUS_TTS_HOST` | `127.0.0.1` | bind address (`--lan` sets `0.0.0.0`) |
| `AMADEUS_TTS_PORT` | `9881` | port |
| `AMADEUS_TTS_HOME` | `../.workspace/tts` | local TTS workspace |
| `AMADEUS_GPT_SOVITS_DIR` | `$AMADEUS_TTS_HOME/GPT-SoVITS` | GPT-SoVITS source |
| `AMADEUS_KURISU_MODEL_DIR` | `$AMADEUS_TTS_HOME/models/kurisu` | checkpoints + references |
| `AMADEUS_TTS_DEVICE` | `cuda` | falls back to CPU if CUDA is unavailable |
| `AMADEUS_TTS_HALF` | `1` | fp16 inference |
| `AMADEUS_TTS_WARMUP` | `1` | synthesize a short phrase on startup |
| `AMADEUS_TTS_REFERENCES` | `voice-server/references.json` | voice bank manifest |

---

## The voice bank

`references.json` maps the app's **emotion vocabulary** — the keys of
`EMOTION_MAP` and the return values of `inferEmotion` in `src/pet/reaction.js` —
onto reference clips. Because there are far more emotions than clips, `aliases`
collapses many emotions onto one clip.

Every clip needs its **exact transcript** as `text`; GPT-SoVITS uses it as the
prompt, and a mismatch audibly degrades the result. Transcripts come from
`WAV/o.list`, shipped with the fine-tune (`path|speaker|lang|text`).

To add a mood: download the slice from
[`bysq/TTS-KurisuMakise`](https://huggingface.co/bysq/TTS-KurisuMakise), copy its
line from `o.list`, and add an entry. **Reference clips must be real recordings
from the training set** — never the model's own `*示范.wav` output, which would
feed synthesis back into itself.

---

## Model assets

`bysq/TTS-KurisuMakise` (apache-2.0), a GPT-SoVITS **v2** fine-tune:

| file | role |
| --- | --- |
| `kurisu-e15.ckpt` | AR / GPT — prosody and timing |
| `kurisu_e4_s972.pth` | SoVITS — timbre |
| `WAV/*.wav` + `WAV/o.list` | 972 transcribed Japanese slices, used as references |

`kurisu-*.ckpt` / `.pth` are **ASCII hardlinks** to the upstream Chinese
filenames, so configs and logs never carry CJK paths. Both names resolve to the
same bytes.

Runtime comes from `chinese-hubert-base`, `chinese-roberta-wwm-ext-large` and
`sv/pretrained_eres2netv2w24s4ep4.ckpt` under
`.workspace/tts/GPT-SoVITS/GPT_SoVITS/pretrained_models/`.

---

## Verifying

```bash
curl -s http://127.0.0.1:9881/health

curl -s -X POST http://127.0.0.1:9881/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"そうね、その通りだわ。","language":"ja","mood":"normal"}' \
  -o out.wav --dump-header -

# the language guard must reject Chinese
curl -s -X POST http://127.0.0.1:9881/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"你好","language":"zh"}'      # -> 400
```

## Troubleshooting

| symptom | cause |
| --- | --- |
| `preflight failed: missing required model assets` | checkpoints or GPT-SoVITS source not in place |
| `AttributeError: module 'numpy' has no attribute 'ndarray'` | broken numpy install — `pip install --force-reinstall numpy==1.26.4` |
| `No module named 'pyopenjtalk'` / OpenJTalk dict errors | Japanese G2P not installed; see `ROADMAP.md` Phase 2 |
| CUDA out of memory | `AMADEUS_TTS_HALF=1`, or lower `batch_size`; the RTX 4060 has 8 GB |
| first request takes ~30 s | model load; warmup runs on startup, check `/health` → `model_loaded` |
