#!/usr/bin/env python3
"""Stable AMA-DEUS TTS bridge in front of GPT-SoVITS api_v2.py."""
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.getenv("AMA_TTS_HOST", "0.0.0.0")
PORT = int(os.getenv("AMA_TTS_PORT", "9881"))
UPSTREAM = os.getenv("GPT_SOVITS_UPSTREAM", "http://127.0.0.1:9880").rstrip("/")
REF_DEFAULT = os.getenv("KURISU_REF_AUDIO", "").strip()
REF_SHY = os.getenv("KURISU_REF_SHY", "").strip()
PROMPT_TEXT = os.getenv("KURISU_PROMPT_TEXT", "").strip()
PROMPT_LANG = os.getenv("KURISU_PROMPT_LANG", "ja").strip().lower() or "ja"
ENGINE = os.getenv("AMA_TTS_ENGINE", "GPT-SoVITS-v2Pro/TTS-KurisuMakise")

def upstream_ready(timeout=1.2):
    try:
        p = urllib.parse.urlparse(UPSTREAM)
        with socket.create_connection((p.hostname or "127.0.0.1", p.port or 80), timeout=timeout): return True
    except OSError: return False

def choose_ref(mood: str):
    if REF_SHY and (mood or "").lower() in {"blush", "shy", "embarrassed", "winking", "sided_pleasant"}: return REF_SHY
    return REF_DEFAULT or REF_SHY

class Handler(BaseHTTPRequestHandler):
    server_version = "AMA-TTS/1.0"
    def log_message(self, fmt, *args): print(f"[ama-tts] {self.address_string()} - {fmt % args}")
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    def json_response(self, code, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if urllib.parse.urlparse(self.path).path != "/health": return self.json_response(404, {"ok": False, "error": "not found"})
        ready = upstream_ready(); ref = choose_ref("normal")
        self.json_response(200, {"ok": ready and bool(ref), "engine": ENGINE, "upstream": UPSTREAM, "upstream_ready": ready, "reference_ready": bool(ref)})
    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/v1/tts": return self.json_response(404, {"ok": False, "error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length", "0") or 0), 64 * 1024)
            req = json.loads(self.rfile.read(length).decode("utf-8")); text = str(req.get("text", "")).strip()
            if not text: return self.json_response(400, {"ok": False, "error": "text is required"})
            if len(text) > 1200: return self.json_response(413, {"ok": False, "error": "text too long"})
            lang = str(req.get("language", "zh")).lower(); lang = lang if lang in {"zh", "ja", "en"} else "ja"
            ref = choose_ref(str(req.get("mood", "normal")))
            if not ref: return self.json_response(503, {"ok": False, "error": "KURISU_REF_AUDIO is not configured"})
            payload = json.dumps({"text": text, "text_lang": lang, "ref_audio_path": ref, "prompt_text": PROMPT_TEXT, "prompt_lang": PROMPT_LANG, "top_k": 5, "top_p": 1.0, "temperature": 0.8, "text_split_method": "cut5", "batch_size": 1, "speed_factor": 1.0, "media_type": "wav", "streaming_mode": False, "parallel_infer": True, "repetition_penalty": 1.35}, ensure_ascii=False).encode("utf-8")
            upstream_req = urllib.request.Request(f"{UPSTREAM}/tts", data=payload, method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(upstream_req, timeout=120) as res: audio = res.read(); ctype = res.headers.get("Content-Type", "audio/wav")
            if not audio or not ctype.startswith("audio/"): return self.json_response(502, {"ok": False, "error": "upstream returned no audio"})
            self.send_response(200); self.cors(); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(audio))); self.send_header("X-Amadeus-TTS-Engine", ENGINE); self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(audio)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:600]; self.json_response(502, {"ok": False, "error": f"GPT-SoVITS HTTP {exc.code}", "detail": detail})
        except Exception as exc: self.json_response(502, {"ok": False, "error": str(exc)})

if __name__ == "__main__":
    print(f"AMA-DEUS TTS proxy: http://{HOST}:{PORT} -> {UPSTREAM}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
