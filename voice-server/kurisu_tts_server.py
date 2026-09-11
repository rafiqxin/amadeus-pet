"""AMA-DEUS Kurisu TTS server.

The single voice owner for AMA-DEUS. It exposes the HTTP contract already
implemented by the client in ``src/voice/tts-client.js``:

    GET  /health          -> {"ok": true, ...}
    POST /v1/tts          -> audio/wav bytes
                             body: {"text": "<japanese>", "language": "ja",
                                    "mood": "normal"}

Language contract (frozen): the pipeline speaks Chinese to the user but the
character always vocalises Japanese. This server therefore accepts Japanese
speech text only and rejects anything else -- the Chinese->Japanese step
belongs to the LLM/route layer, never to the voice backend.

Backend: GPT-SoVITS v2 fine-tuned on Kurisu Makise
(https://huggingface.co/bysq/TTS-KurisuMakise), running in-process on CUDA.
GPT-SoVITS' own stock API (``api_v2.py``, port 9880) is left untouched and can
still be started separately for training / WebUI work; this server does not
proxy through it.

Run:
    python kurisu_tts_server.py
    # or, for LAN access from the Android build:
    AMADEUS_TTS_HOST=0.0.0.0 AMADEUS_TTS_PORT=9881 python kurisu_tts_server.py
"""

from __future__ import annotations

import io
import json
import logging
import os
import sys
import threading
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

SERVER_DIR = Path(__file__).resolve().parent
DEFAULT_TTS_HOME = SERVER_DIR.parent / ".workspace" / "tts"
TTS_HOME = Path(os.environ.get("AMADEUS_TTS_HOME", DEFAULT_TTS_HOME)).resolve()
GPT_SOVITS_DIR = Path(
    os.environ.get("AMADEUS_GPT_SOVITS_DIR", TTS_HOME / "GPT-SoVITS")
).resolve()
MODEL_DIR = Path(os.environ.get("AMADEUS_KURISU_MODEL_DIR", TTS_HOME / "models" / "kurisu")).resolve()

HOST = os.environ.get("AMADEUS_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("AMADEUS_TTS_PORT", "9881"))
DEVICE = os.environ.get("AMADEUS_TTS_DEVICE", "cuda")
IS_HALF = os.environ.get("AMADEUS_TTS_HALF", "1") not in ("0", "false", "False")
WARMUP = os.environ.get("AMADEUS_TTS_WARMUP", "1") not in ("0", "false", "False")
REFERENCE_MANIFEST = Path(
    os.environ.get("AMADEUS_TTS_REFERENCES", SERVER_DIR / "references.json")
)

# Kurisu checkpoints published with the fine-tune (bysq/TTS-KurisuMakise).
# Upstream ships Chinese filenames; ASCII hardlinks live beside them so that
# config files, logs and shell pipelines never have to carry CJK paths.
def _pick_checkpoint(env_var: str, *candidates: str) -> Path:
    override = os.environ.get(env_var, "").strip()
    if override:
        return MODEL_DIR / override
    for name in candidates:
        path = MODEL_DIR / name
        if path.exists():
            return path
    return MODEL_DIR / candidates[0]


GPT_WEIGHTS = _pick_checkpoint("AMADEUS_KURISU_GPT", "kurisu-e15.ckpt", "牧懒红莉栖-e15.ckpt")
SOVITS_WEIGHTS = _pick_checkpoint(
    "AMADEUS_KURISU_SOVITS", "kurisu_e4_s972.pth", "牧懒红莉栖_e4_s972.pth"
)
BERT_DIR = GPT_SOVITS_DIR / "GPT_SoVITS" / "pretrained_models" / "chinese-roberta-wwm-ext-large"
HUBERT_DIR = GPT_SOVITS_DIR / "GPT_SoVITS" / "pretrained_models" / "chinese-hubert-base"

ENGINE_NAME = "kurisu-gpt-sovits-v2"
OUTPUT_LANGUAGE = "ja"

logging.basicConfig(
    level=os.environ.get("AMADEUS_TTS_LOG", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("kurisu-tts")


# --------------------------------------------------------------------------
# Reference voice bank
# --------------------------------------------------------------------------


@dataclass
class Reference:
    """One reference clip: what the voice is cloned from."""

    mood: str
    audio: Path
    text: str = ""
    lang: str = OUTPUT_LANGUAGE
    note: str = ""

    def resolve(self) -> "Reference":
        path = self.audio if self.audio.is_absolute() else MODEL_DIR / self.audio
        return Reference(self.mood, path, self.text, self.lang, self.note)

    def as_public(self) -> dict[str, Any]:
        return {
            "mood": self.mood,
            "audio": self.audio.name,
            "has_prompt_text": bool(self.text.strip()),
            "lang": self.lang,
            "note": self.note,
        }


@dataclass
class ReferenceBank:
    """Mood -> reference clip, so emotion can steer timbre, not just expression.

    The app's emotion vocabulary comes from ``EMOTION_MAP`` / ``inferEmotion``
    in ``src/pet/reaction.js`` (happy, embarrassed, pissed, disappointed, ...).
    Those are finer grained than the number of reference clips, so the manifest
    carries an ``aliases`` table collapsing many emotions onto one clip.
    """

    references: dict[str, Reference] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)
    fallback: str = "normal"

    @classmethod
    def load(cls, manifest_path: Path) -> "ReferenceBank":
        bank = cls()
        if not manifest_path.exists():
            log.warning("reference manifest missing: %s", manifest_path)
            return bank
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        bank.fallback = raw.get("fallback", "normal")
        bank.aliases = {
            str(k).strip().lower(): str(v).strip().lower()
            for k, v in (raw.get("aliases") or {}).items()
        }
        for mood, entry in (raw.get("references") or {}).items():
            if isinstance(entry, str):
                entry = {"audio": entry}
            bank.references[mood] = Reference(
                mood=mood,
                audio=Path(entry["audio"]),
                text=entry.get("text", ""),
                lang=entry.get("lang", OUTPUT_LANGUAGE),
                note=entry.get("note", ""),
            ).resolve()
        # Drop entries whose wav is not actually on disk so a half-filled
        # manifest degrades to the fallback instead of failing at synth time.
        for mood in [m for m, r in bank.references.items() if not r.audio.exists()]:
            log.warning("reference for mood %r missing on disk: %s", mood, bank.references[mood].audio)
            bank.references.pop(mood)
        log.info(
            "reference bank: %d mood(s) [%s]",
            len(bank.references),
            ", ".join(sorted(bank.references)) or "none",
        )
        return bank

    def pick(self, mood: str | None) -> Reference | None:
        key = str(mood or "").strip().lower()
        if key in self.aliases:
            key = self.aliases[key]
        if key and key in self.references:
            return self.references[key]
        if self.fallback in self.references:
            if key and key != self.fallback:
                log.info("mood %r not mapped, falling back to %r", key, self.fallback)
            return self.references[self.fallback]
        return next(iter(self.references.values()), None)

    def moods(self) -> list[str]:
        return sorted(self.references)


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------


class KurisuEngine:
    """Owns the one and only GPT-SoVITS pipeline in this process.

    ``synth`` is serialised by a lock: AMA-DEUS guarantees a single voice owner,
    so two replies can never vocalise on top of each other.
    """

    def __init__(self, bank: ReferenceBank) -> None:
        self.bank = bank
        self._tts: Any = None
        self._lock = threading.RLock()
        self._load_error: str | None = None
        self._loading = False
        self.sample_rate = 32000
        self.synth_count = 0
        self.last_synth_ms = 0

    # -- lifecycle ---------------------------------------------------------

    @property
    def loaded(self) -> bool:
        return self._tts is not None

    @property
    def busy(self) -> bool:
        return self._lock._is_owned()  # noqa: SLF001 - intentional introspection

    def preflight(self) -> None:
        missing = [
            str(p)
            for p in (GPT_WEIGHTS, SOVITS_WEIGHTS, BERT_DIR, HUBERT_DIR)
            if not p.exists()
        ]
        if missing:
            raise RuntimeError(
                "missing required model assets:\n  " + "\n  ".join(missing)
            )
        if not (GPT_SOVITS_DIR / "GPT_SoVITS" / "TTS_infer_pack" / "TTS.py").exists():
            raise RuntimeError(f"GPT-SoVITS source not found under {GPT_SOVITS_DIR}")

    def load(self) -> None:
        """Import GPT-SoVITS and build the inference pipeline. Idempotent."""
        with self._lock:
            if self._tts is not None:
                return
            self.preflight()
            self._loading = True
            started = time.time()
            # GPT-SoVITS expects both the repo root and GPT_SoVITS/ on sys.path:
            # `AR`, `BigVGAN`, `module`, `text` live under the latter, while
            # `GPT_SoVITS.TTS_infer_pack` is imported from the former.
            for entry in (GPT_SOVITS_DIR / "GPT_SoVITS", GPT_SOVITS_DIR):
                if str(entry) not in sys.path:
                    sys.path.insert(0, str(entry))
            os.chdir(GPT_SOVITS_DIR)  # GPT-SoVITS resolves assets relative to cwd
            import torch  # noqa: PLC0415 - heavy import, deliberately deferred

            from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config  # noqa: PLC0415

            device = DEVICE if torch.cuda.is_available() else "cpu"
            if device != DEVICE:
                log.warning(
                    "CUDA unavailable (torch %s), falling back to CPU synthesis",
                    torch.__version__,
                )
            configs = {
                "custom": {
                    "device": device,
                    "is_half": IS_HALF and device != "cpu",
                    "version": "v2",
                    "t2s_weights_path": str(GPT_WEIGHTS),
                    "vits_weights_path": str(SOVITS_WEIGHTS),
                    "bert_base_path": str(BERT_DIR),
                    "cnhuhbert_base_path": str(HUBERT_DIR),
                }
            }
            log.info("loading GPT-SoVITS v2 on %s (half=%s)", device, configs["custom"]["is_half"])
            self._tts = TTS(TTS_Config(configs))
            self.sample_rate = int(self._tts.configs.sampling_rate)
            if device != "cpu":
                log.info(
                    "cuda ready: %s, allocated %.0f MiB",
                    torch.cuda.get_device_name(0),
                    torch.cuda.memory_allocated(0) / 1048576,
                )
            self._load_error = None
            self._loading = False
            log.info("model ready in %.1fs (sample_rate=%d)", time.time() - started, self.sample_rate)

    def warmup(self) -> None:
        try:
            self.load()
            ref = self.bank.pick(None)
            if ref is None:
                log.warning("no reference clip available; skipping warmup")
                return
            started = time.time()
            self._infer("こんにちは。", ref)
            log.info("warmup synthesis ok in %.1fs", time.time() - started)
        except Exception as exc:  # noqa: BLE001 - warmup must never kill the server
            self._load_error = f"{type(exc).__name__}: {exc}"
            log.exception("warmup failed")

    # -- synthesis ---------------------------------------------------------

    def _infer(self, text: str, ref: Reference) -> tuple[bytes, int]:
        """Run one synthesis. Caller must already hold the lock."""
        import numpy as np  # noqa: PLC0415

        inputs = {
            "text": text,
            "text_lang": OUTPUT_LANGUAGE,
            "ref_audio_path": str(ref.audio),
            "prompt_text": ref.text or "",
            "prompt_lang": ref.lang or OUTPUT_LANGUAGE,
            "top_k": 15,
            "top_p": 1.0,
            "temperature": 1.0,
            "text_split_method": "cut5",
            "batch_size": 1,
            "speed_factor": 1.0,
            "split_bucket": True,
            "return_fragment": False,
            "seed": -1,
            "parallel_infer": True,
            "repetition_penalty": 1.35,
        }
        chunks: list[Any] = []
        sample_rate = self.sample_rate
        for sr, audio in self._tts.run(inputs):
            sample_rate = int(sr)
            chunks.append(audio)
        if not chunks:
            raise RuntimeError("GPT-SoVITS produced no audio")
        merged = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
        return _to_wav_bytes(merged, sample_rate), sample_rate

    def synth(self, text: str, mood: str | None = None) -> tuple[bytes, dict[str, Any]]:
        ref = self.bank.pick(mood)
        if ref is None:
            raise RuntimeError(
                "no reference clip configured; populate voice-server/references.json"
            )
        with self._lock:
            self.load()
            started = time.time()
            wav, sample_rate = self._infer(text, ref)
            elapsed_ms = int((time.time() - started) * 1000)
            self.synth_count += 1
            self.last_synth_ms = elapsed_ms
        meta = {
            "engine": ENGINE_NAME,
            "mood": ref.mood,
            "reference": ref.audio.name,
            "prompt_text_used": bool(ref.text.strip()),
            "sample_rate": sample_rate,
            "elapsed_ms": elapsed_ms,
        }
        return wav, meta

    def health(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "ok": True,
            "engine": ENGINE_NAME,
            "version": "v2",
            "language": OUTPUT_LANGUAGE,
            "device": DEVICE,
            "model_loaded": self.loaded,
            "loading": self._loading,
            "busy": self.busy,
            "syntheses": self.synth_count,
            "last_synth_ms": self.last_synth_ms,
            "moods": self.bank.moods(),
            "reference_count": len(self.bank.references),
            "gpt_weights": GPT_WEIGHTS.name,
            "sovits_weights": SOVITS_WEIGHTS.name,
        }
        if self._load_error:
            info["last_error"] = self._load_error
        if self.loaded:
            try:
                import torch  # noqa: PLC0415

                if torch.cuda.is_available():
                    info["cuda"] = torch.cuda.get_device_name(0)
                    info["vram_allocated_mb"] = round(
                        torch.cuda.memory_allocated(0) / 1048576
                    )
            except Exception:  # noqa: BLE001 - health must never raise
                pass
        return info


def _to_wav_bytes(samples: Any, sample_rate: int) -> bytes:
    """Wrap raw int16 samples in a RIFF/WAVE container (stdlib only)."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(samples.astype("<i2").tobytes())
    return buffer.getvalue()


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------

try:  # fastapi depends on pydantic; the guard keeps this module importable
    # standalone for tooling that only needs the reference bank.
    from pydantic import BaseModel

    class TtsRequest(BaseModel):
        """Body of ``POST /v1/tts`` — mirrors ``synthesizeTts`` in tts-client.js.

        Defined at module scope deliberately. This file uses
        ``from __future__ import annotations``, so every annotation is a string
        that FastAPI resolves through the module globals. A model defined inside
        ``build_app`` is not in those globals, so FastAPI would fail to recognise
        it as a body model and silently treat ``request`` as a query parameter
        (symptom: HTTP 422 with ``loc: ["query", "request"]``).
        """

        text: str
        language: str = OUTPUT_LANGUAGE
        mood: str = "normal"

except ImportError:  # pragma: no cover - tooling without the full env
    TtsRequest = None  # type: ignore[assignment,misc]


def build_app(bank: ReferenceBank, engine: KurisuEngine) -> Any:
    from fastapi import FastAPI, HTTPException  # noqa: PLC0415
    from fastapi.responses import JSONResponse, Response  # noqa: PLC0415

    app = FastAPI(
        title="AMA-DEUS Kurisu TTS",
        version="0.1.0",
        description=(
            "Japanese speech for the AMA-DEUS character layer. "
            "Chinese stays in the UI and subtitles; only this service speaks."
        ),
    )

    # The desktop renderer runs with webSecurity disabled so it does not need
    # this, but the Android WebView does: a POST with Content-Type
    # application/json triggers a preflight from a capacitor:// origin.
    from fastapi.middleware.cors import CORSMiddleware  # noqa: PLC0415

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.get("/health")
    def health() -> JSONResponse:
        return JSONResponse(engine.health())

    @app.get("/")
    def root() -> JSONResponse:
        return JSONResponse(
            {
                "service": "amadeus-kurisu-tts",
                "engine": ENGINE_NAME,
                "output_language": OUTPUT_LANGUAGE,
                "endpoints": ["/health", "/v1/tts", "/v1/references"],
            }
        )

    @app.get("/v1/references")
    def references() -> JSONResponse:
        return JSONResponse(
            {
                "fallback": bank.fallback,
                "references": [r.as_public() for r in bank.references.values()],
            }
        )

    @app.post("/v1/tts")
    def synthesize(request: TtsRequest) -> Response:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is empty")
        if request.language.strip().lower() != OUTPUT_LANGUAGE:
            raise HTTPException(
                status_code=400,
                detail=(
                    "AMA-DEUS Kurisu TTS accepts Japanese speech text only "
                    f"(got {request.language!r}); translate before calling"
                ),
            )
        try:
            wav, meta = engine.synth(text, request.mood)
        except Exception as exc:  # noqa: BLE001 - surface backend failure as 500
            log.exception("synthesis failed")
            raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
        log.info(
            "synth mood=%s ref=%s %dms -> %d bytes",
            meta["mood"],
            meta["reference"],
            meta["elapsed_ms"],
            len(wav),
        )
        return Response(
            content=wav,
            media_type="audio/wav",
            headers={
                "x-amadeus-tts-engine": ENGINE_NAME,
                "x-amadeus-tts-mood": meta["mood"],
                "x-amadeus-tts-reference": meta["reference"],
                "x-amadeus-tts-elapsed-ms": str(meta["elapsed_ms"]),
                "cache-control": "no-store",
            },
        )

    return app


def _parse_args(argv: list[str]) -> tuple[str, int]:
    """``--lan`` binds 0.0.0.0 so the Android build can reach this over WiFi."""
    host, port = HOST, PORT
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--lan":
            host = "0.0.0.0"
        elif arg == "--host" and index + 1 < len(argv):
            index += 1
            host = argv[index]
        elif arg == "--port" and index + 1 < len(argv):
            index += 1
            port = int(argv[index])
        index += 1
    return host, port


def _lan_addresses() -> list[str]:
    import socket

    found: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except Exception:  # noqa: BLE001 - purely informational
        return []
    return sorted(addr for addr in found if not addr.startswith("127."))


def main() -> int:
    log.info("AMA-DEUS Kurisu TTS starting")
    log.info("tts home   : %s", TTS_HOME)
    log.info("gpt-sovits : %s", GPT_SOVITS_DIR)
    log.info("kurisu ckpt: %s", MODEL_DIR)

    host, port = _parse_args(sys.argv[1:])
    bank = ReferenceBank.load(REFERENCE_MANIFEST)
    engine = KurisuEngine(bank)

    try:
        engine.preflight()
    except Exception as exc:  # noqa: BLE001 - fail loudly and early
        log.error("preflight failed: %s", exc)
        return 2

    if WARMUP:
        threading.Thread(target=engine.warmup, name="warmup", daemon=True).start()

    import uvicorn  # noqa: PLC0415

    app = build_app(bank, engine)
    log.info("listening on http://%s:%d", host, port)
    if host == "0.0.0.0":
        for addr in _lan_addresses():
            log.info("  LAN endpoint for Android: http://%s:%d", addr, port)
    uvicorn.run(app, host=host, port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
