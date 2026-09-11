"""Generate the desktop icon set from the Amadeus launcher artwork.

The source is the same asset the Java build ships and that the iOS workflow
already downloads:

    https://raw.githubusercontent.com/rafiqxin/Amadeus/master/app/src/main/ic_launcher-web.png

Run after replacing ``build/icon-src.png``:

    python tools/make-icons.py

Writes ``build/icon.ico`` (Windows) and ``build/icon.png`` (Linux), which is
where electron-builder looks by default.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "icon-src.png"
ICO = ROOT / "build" / "icon.ico"
PNG = ROOT / "build" / "icon.png"

# Windows picks a size per context: 16 in the title bar, 32 in the taskbar,
# 48 in Explorer, 256 in the large-icon view. Shipping all of them lets the OS
# downsample nothing.
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def main() -> int:
    if not SRC.exists():
        print(f"missing source icon: {SRC}", file=sys.stderr)
        return 1

    image = Image.open(SRC).convert("RGBA")
    print(f"source : {SRC.name}  {image.size[0]}x{image.size[1]}")

    largest = max(ICO_SIZES)
    if image.size[0] < largest:
        print(
            f"warning: source is {image.size[0]}px, smaller than the {largest}px "
            "entry Windows wants; that entry will be upscaled",
            file=sys.stderr,
        )

    image.save(ICO, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote  : {ICO.relative_to(ROOT)}  sizes={ICO_SIZES}")

    image.resize((512, 512), Image.LANCZOS).save(PNG, format="PNG")
    print(f"wrote  : {PNG.relative_to(ROOT)}  512x512")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
