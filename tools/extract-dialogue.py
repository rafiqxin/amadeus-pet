#!/usr/bin/env python3
"""Generic dialogue extractor: pull one speaker's lines from a script file
into a JSON list. Useful for building your own dialog-bank entries.

Usage:
    python3 tools/extract-dialogue.py <script.md> <Speaker> [--out out.json]

Example:
    python3 tools/extract-dialogue.py Prompts/SG_Dialogues_EN.md Kurisu

Output format (one JSON array of lines). Review the result, keep only what
you have the rights to use, then paste the lines into src/pet/dialog-bank.js
as original `replies` entries.
"""
import json
import re
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    src = Path(sys.argv[1])
    speaker = sys.argv[2]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else f'/tmp/{speaker}-lines.json'

    lines = []
    for line in src.read_text(encoding='utf-8', errors='ignore').splitlines():
        m = re.match(r'^([A-Za-z?]+):\s*(.*)$', line)
        if m and m.group(1) == speaker and m.group(2).strip():
            lines.append(m.group(2).strip())

    Path(out).write_text(json.dumps(lines, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'extracted {len(lines)} lines of "{speaker}" -> {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
