"""Acceptance check for Phase 2 (Windows Kurisu TTS).

The Phase 2 exit criterion is deliberately narrow:

    1. Windows 本机生成一句自然的日语 WAV
    2. GET /health 返回正常

Two modes:

    # against a running server (the real acceptance path)
    python voice-server/verify.py

    # load the engine in-process, no HTTP (use when debugging the stack)
    python voice-server/verify.py --inproc

Exit code 0 only when every check passes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER_DIR))

DEFAULT_URL = "http://127.0.0.1:9881"

# One line per mood group in references.json. The first is the acceptance phrase.
PROBES = [
    ("normal", "そうね、その通りだと思うわ。"),
    ("annoyed", "だから、そういうのはやめてって言ってるでしょ。"),
    ("happy", "まあ、悪くないんじゃない？"),
]

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def inspect_wav(data: bytes) -> tuple[bool, str]:
    """Validate the payload is real, non-silent mono PCM."""
    import io

    try:
        with wave.open(io.BytesIO(data), "rb") as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            frames = handle.getnframes()
            raw = handle.readframes(frames)
    except Exception as exc:  # noqa: BLE001
        return False, f"not a valid WAV: {type(exc).__name__}: {exc}"

    if frames == 0:
        return False, "WAV contains no frames"

    samples = memoryview(raw).cast("h")
    peak = max(abs(s) for s in samples) if len(samples) else 0
    duration = frames / float(rate or 1)
    detail = (
        f"{duration:.2f}s @ {rate}Hz, {channels}ch, {width * 8}bit, peak={peak}"
    )
    if peak < 200:
        return False, detail + " (effectively silent)"
    return True, detail


# --------------------------------------------------------------------------
# HTTP mode
# --------------------------------------------------------------------------


def run_http(url: str, out_dir: Path) -> bool:
    print(f"Target: {url}\n")

    print("1. GET /health")
    try:
        with urlopen(f"{url}/health", timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
            status = response.status
    except URLError as exc:
        check("server reachable", False, str(exc.reason))
        return False
    check("HTTP 200", status == 200, f"status={status}")
    check("body.ok !== false", body.get("ok") is not False, f"ok={body.get('ok')}")
    check("language contract is ja", body.get("language") == "ja", f"language={body.get('language')}")
    check("engine reported", bool(body.get("engine")), str(body.get("engine")))
    check(
        "reference bank loaded",
        bool(body.get("reference_count")),
        f"{body.get('reference_count')} clip(s), moods={body.get('moods')}",
    )
    print(f"     model_loaded={body.get('model_loaded')} device={body.get('device')} "
          f"cuda={body.get('cuda')} vram={body.get('vram_allocated_mb')}MB")

    print("\n2. POST /v1/tts — Japanese speech")
    out_dir.mkdir(parents=True, exist_ok=True)
    all_ok = True
    for mood, text in PROBES:
        payload = json.dumps({"text": text, "language": "ja", "mood": mood}).encode("utf-8")
        request = Request(
            f"{url}/v1/tts",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        started = time.time()
        try:
            with urlopen(request, timeout=180) as response:
                data = response.read()
                elapsed = time.time() - started
        except Exception as exc:  # noqa: BLE001
            all_ok &= check(f"synthesize [{mood}]", False, f"{type(exc).__name__}: {exc}")
            continue

        ok, detail = inspect_wav(data)
        path = out_dir / f"kurisu-{mood}.wav"
        if ok:
            path.write_bytes(data)
        all_ok &= check(
            f"synthesize [{mood}]",
            ok,
            f"{len(data) / 1000:.0f} kB in {elapsed:.2f}s — {detail}",
        )
        if ok:
            print(f"           -> {path}")

    print("\n3. Language guard (Chinese must be rejected)")
    payload = json.dumps({"text": "你好，红莉栖。", "language": "zh"}).encode("utf-8")
    request = Request(
        f"{url}/v1/tts",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            all_ok &= check("Chinese rejected", False, f"got HTTP {response.status}, expected 400")
    except Exception as exc:  # noqa: BLE001 - HTTPError carries .code
        code = getattr(exc, "code", None)
        all_ok &= check("Chinese rejected", code == 400, f"HTTP {code}")

    return all_ok


# --------------------------------------------------------------------------
# In-process mode
# --------------------------------------------------------------------------


def run_inproc(out_dir: Path) -> bool:
    import kurisu_tts_server as server

    print("In-process mode — loading the engine directly.\n")
    print("1. Model assets")
    ok = True
    for label, path in (
        ("GPT / AR checkpoint", server.GPT_WEIGHTS),
        ("SoVITS checkpoint", server.SOVITS_WEIGHTS),
        ("BERT dir", server.BERT_DIR),
        ("HuBERT dir", server.HUBERT_DIR),
        ("GPT-SoVITS source", server.GPT_SOVITS_DIR / "GPT_SoVITS" / "TTS_infer_pack" / "TTS.py"),
    ):
        ok &= check(label, path.exists(), str(path.name if path.is_file() else path))
    if not ok:
        return False

    print("\n2. Load engine (CUDA)")
    bank = server.ReferenceBank.load(server.REFERENCE_MANIFEST)
    check("reference bank", bool(bank.references), f"moods={bank.moods()}")
    engine = server.KurisuEngine(bank)
    started = time.time()
    try:
        engine.load()
    except Exception as exc:  # noqa: BLE001
        check("engine load", False, f"{type(exc).__name__}: {exc}")
        return False
    check("engine load", True, f"{time.time() - started:.1f}s")
    check("health payload", engine.health().get("ok") is True, json.dumps(engine.health())[:160])

    print("\n3. Synthesize")
    out_dir.mkdir(parents=True, exist_ok=True)
    all_ok = True
    for mood, text in PROBES:
        try:
            wav, meta = engine.synth(text, mood)
        except Exception as exc:  # noqa: BLE001
            all_ok &= check(f"synthesize [{mood}]", False, f"{type(exc).__name__}: {exc}")
            continue
        good, detail = inspect_wav(wav)
        all_ok &= check(
            f"synthesize [{mood}]",
            good,
            f"{meta['elapsed_ms']}ms ref={meta['reference']} — {detail}",
        )
        if good:
            path = out_dir / f"kurisu-{mood}.wav"
            path.write_bytes(wav)
            print(f"           -> {path}")
    return all_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="AMA-DEUS Kurisu TTS acceptance check")
    parser.add_argument("--url", default=DEFAULT_URL, help="server base URL")
    parser.add_argument("--inproc", action="store_true", help="bypass HTTP, load in-process")
    parser.add_argument("--out", default=str(SERVER_DIR / "out"), help="where to write WAVs")
    args = parser.parse_args()

    out_dir = Path(args.out)
    ok = run_inproc(out_dir) if args.inproc else run_http(args.url, out_dir)

    passed = sum(1 for status, _, _ in results if status == PASS)
    failed = len(results) - passed
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        print("\nFailures:")
        for status, name, detail in results:
            if status == FAIL:
                print(f"  - {name}: {detail}")
        return 1
    print("Phase 2 acceptance: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
