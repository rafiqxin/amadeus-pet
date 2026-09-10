# Kurisu TTS Linux workspace

This is the GPU-side voice backend for AMA-DEUS. The Android APK does **not** embed the roughly 552 MB voice repository or the GPT-SoVITS runtime; it calls a stable LAN API instead.

## First setup

Use Python 3.10 and an NVIDIA/CUDA environment. Install system audio dependencies first:

```bash
sudo apt install -y git ffmpeg libsox-dev
AMA_TTS_INSTALL=1 AMA_TTS_DEVICE=CU126 ./tools/tts/start-kurisu-linux.sh
```

The script creates `.workspace/tts/`, clones GPT-SoVITS, downloads `bysq/TTS-KurisuMakise` v2Pro GPT/SoVITS weights plus its two reference WAV files, writes a CUDA/FP16 inference config, starts GPT-SoVITS on `127.0.0.1:9880`, then exposes the stable AMA-DEUS bridge on `0.0.0.0:9881`.

Subsequent runs normally only need:

```bash
./tools/tts/start-kurisu-linux.sh
```

In the Android app, set **TTS Endpoint** to the Linux machine's LAN address, for example `http://192.168.1.50:9881`. `GET /health` reports whether the upstream model server and reference audio are ready.

The first prototype deliberately returns WAV. The bridge keeps model paths/reference audio private to Linux and gives clients only `GET /health` and `POST /v1/tts`.
