# AMA-DEUS own-voice training workspace

Put only voice material you are permitted to use into `.workspace/voice-training/raw/`. The raw corpus is ignored by Git and is never committed.

Prepare a normalized dataset:

```bash
python tools/voice-training/prepare_dataset.py .workspace/voice-training/raw
```

The script converts supported audio to mono PCM16 WAV at 32 kHz, applies conservative high-pass + loudness normalization, records duration/source provenance, and writes `metadata.tsv`. It deliberately leaves `text` and `approved` blank: transcripts and speaker identity must be verified before a training run. Clips with BGM, overlapping speakers, severe reverb, sound effects, or the wrong speaker should be rejected rather than blindly mixed into training.

The next training stage consumes only rows with `approved=1`; that stage should be added after the user's new corpus is present and audited. The existing 45 OGG reference clips remain product assets and are not silently promoted into a training dataset.
