#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WS="${AMA_TTS_WORKSPACE:-$ROOT/.workspace/tts}"
GSV="$WS/GPT-SoVITS"
MODEL="$WS/TTS-KurisuMakise"
PYTHON="${PYTHON:-python3}"
mkdir -p "$WS" "$MODEL"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required: sudo apt install ffmpeg libsox-dev" >&2; exit 1; }
if [ ! -d "$GSV/.git" ]; then git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git "$GSV"; fi

if [ "${AMA_TTS_INSTALL:-0}" = "1" ]; then
  cd "$GSV"
  bash install.sh --device "${AMA_TTS_DEVICE:-CU126}" --source "${AMA_TTS_SOURCE:-HF}"
fi

if ! "$PYTHON" -c 'import huggingface_hub' >/dev/null 2>&1; then "$PYTHON" -m pip install -U huggingface_hub; fi
"$PYTHON" - <<PY
from huggingface_hub import snapshot_download
snapshot_download(repo_id="bysq/TTS-KurisuMakise", local_dir=r"$MODEL", allow_patterns=["*.ckpt", "*.pth", "害羞示范.wav", "无奈.wav"])
PY

GPT_WEIGHT="$(find "$MODEL" -maxdepth 1 -type f -name '*.ckpt' | head -1)"
SOVITS_WEIGHT="$(find "$MODEL" -maxdepth 1 -type f -name '*.pth' | head -1)"
REF="${KURISU_REF_AUDIO:-$MODEL/无奈.wav}"
REF_SHY="${KURISU_REF_SHY:-$MODEL/害羞示范.wav}"
[ -s "$GPT_WEIGHT" ] && [ -s "$SOVITS_WEIGHT" ] && [ -s "$REF" ] || { echo "Kurisu model/reference download incomplete" >&2; exit 1; }

CONFIG="$WS/tts_infer_kurisu.yaml"
cat > "$CONFIG" <<YAML
custom:
  bert_base_path: $GSV/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
  cnhuhbert_base_path: $GSV/GPT_SoVITS/pretrained_models/chinese-hubert-base
  device: cuda
  is_half: true
  t2s_weights_path: $GPT_WEIGHT
  version: v2Pro
  vits_weights_path: $SOVITS_WEIGHT
YAML

for need in "$GSV/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large" "$GSV/GPT_SoVITS/pretrained_models/chinese-hubert-base"; do
  if [ ! -e "$need" ]; then echo "Missing GPT-SoVITS pretrained assets: $need" >&2; echo "Run once: AMA_TTS_INSTALL=1 $0" >&2; exit 1; fi
done

cd "$GSV"
"$PYTHON" - <<'PY'
import torch
print('torch cuda available:', torch.cuda.is_available())
if not torch.cuda.is_available(): raise SystemExit('CUDA is not available to PyTorch')
print('gpu:', torch.cuda.get_device_name(0))
PY

"$PYTHON" api_v2.py -a 127.0.0.1 -p 9880 -c "$CONFIG" &
GSV_PID=$!
cleanup(){ kill "$GSV_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
export GPT_SOVITS_UPSTREAM="http://127.0.0.1:9880"
export KURISU_REF_AUDIO="$REF"
export KURISU_REF_SHY="$REF_SHY"
export KURISU_PROMPT_LANG="ja"
export AMA_TTS_PORT="${AMA_TTS_PORT:-9881}"
cd "$ROOT"
for _ in $(seq 1 120); do
  if "$PYTHON" - <<'PY' >/dev/null 2>&1
import socket
s=socket.create_connection(('127.0.0.1',9880),1); s.close()
PY
  then break; fi
  sleep 1
done
exec "$PYTHON" tools/tts/ama_tts_proxy.py
