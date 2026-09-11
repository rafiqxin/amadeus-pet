#!/usr/bin/env python3
"""Normalize user-supplied voice clips into a reproducible training workspace."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

AUDIO_EXT = {'.wav', '.flac', '.mp3', '.ogg', '.m4a', '.aac', '.opus'}

def ffprobe_duration(path: Path) -> float:
    p = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)], capture_output=True, text=True, check=True)
    return float(p.stdout.strip() or 0)

def normalize(src: Path, dst: Path, sample_rate: int):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(src),'-vn','-ac','1','-ar',str(sample_rate),'-sample_fmt','s16','-af','highpass=f=55,loudnorm=I=-20:TP=-2:LRA=11',str(dst)], check=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('raw', type=Path); ap.add_argument('--out', type=Path, default=Path('.workspace/voice-training/dataset-v1')); ap.add_argument('--sample-rate', type=int, default=32000); args = ap.parse_args()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'): raise SystemExit('ffmpeg and ffprobe are required')
    files = sorted(p for p in args.raw.rglob('*') if p.is_file() and p.suffix.lower() in AUDIO_EXT)
    if not files: raise SystemExit(f'no audio files found under {args.raw}')
    wav_dir = args.out / 'wav'; wav_dir.mkdir(parents=True, exist_ok=True); rows=[]; total=0.0
    for i, src in enumerate(files, 1):
        token=hashlib.sha1(str(src.relative_to(args.raw)).encode()).hexdigest()[:10]; dst=wav_dir/f'{i:05d}_{token}.wav'; normalize(src,dst,args.sample_rate); dur=ffprobe_duration(dst); total+=dur
        rows.append({'id':dst.stem,'wav':str(dst.relative_to(args.out)),'source':str(src),'duration_s':f'{dur:.3f}','language':'ja','emotion':'','text':'','approved':'0'})
    manifest=args.out/'metadata.tsv'
    with manifest.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=rows[0].keys(),delimiter='\t'); w.writeheader(); w.writerows(rows)
    stats={'clips':len(rows),'duration_s':round(total,3),'duration_min':round(total/60,2),'sample_rate':args.sample_rate,'channels':1,'format':'PCM16 WAV','transcripts_verified':False}
    (args.out/'stats.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps(stats,ensure_ascii=False,indent=2)); print(f'metadata: {manifest}')

if __name__=='__main__': main()
