#!/usr/bin/env python3
"""Recolor v3 — conservative assistant-hair pass.

Rules:
  1. Restore nothing here; input must be the ORIGINAL SDK textures.
  2. Locate the face via skin-tone cluster in the top band.
  3. Recolor ONLY pure-white, low-saturation pixels inside the hair band
     (y < HAIR_Y_END) and OUTSIDE the face bbox → chestnut.
     This excludes skin tones, eye whites and dress whites below the band.
  4. Shading texture: dark grays inside the same hair region → warm brown.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else 'models/Haru')
HAIR_Y_END = 480
CHESTNUT = (196, 108, 70)
LIGHTEN = 240
FACE_DILATE = 18


def find_face_bbox(img):
    """Skin-toned cluster bounds in the top band of the texture."""
    w, h = img.size
    px = img.load()
    xs, ys = [], []
    for y in range(0, min(h, 420), 2):
        for x in range(0, w, 2):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            # skin: warm pink, r dominant
            if 195 < r < 256 and 130 < g < 205 and 115 < b < 195 and (r - g) > 20 and (r - b) > 30:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    x0, x1 = max(0, min(xs) - FACE_DILATE), min(w, max(xs) + FACE_DILATE)
    y0, y1 = max(0, min(ys) - FACE_DILATE), min(h, max(ys) + FACE_DILATE)
    return (x0, y0, x1, y1)


def recolor_hair(img, face):
    w, h = img.size
    px = img.load()
    count = 0
    for y in range(0, min(h, HAIR_Y_END)):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            # neutral light-to-mid pixels (hair highlights + mid tones +
            # cool shadows). Skin excluded by red dominance; dark purples
            # excluded by mn floor.
            if mn > 80 and (mx - mn) < 40 and (r - g) < 25 and (b - g) < 35:
                lum = (r + g + b) / 3
                k = lum / LIGHTEN
                px[x, y] = (
                    min(255, int(CHESTNUT[0] * k)),
                    min(255, int(CHESTNUT[1] * k)),
                    min(255, int(CHESTNUT[2] * k)),
                    a,
                )
                count += 1
    return count


def recolor_shading(img, face):
    w, h = img.size
    px = img.load()
    count = 0
    for y in range(0, min(h, HAIR_Y_END)):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            if 30 < r < 170 and 30 < g < 170 and 30 < b < 170:
                px[x, y] = (min(255, int(r * 1.28)), int(g * 0.70), int(b * 0.55), a)
                count += 1
    return count


def main():
    tex_dir = ROOT / 'Haru.2048'
    t0 = Image.open(tex_dir / 'texture_00.png').convert('RGBA')
    t1 = Image.open(tex_dir / 'texture_01.png').convert('RGBA')
    face = find_face_bbox(t0)
    print('face bbox:', face)
    n0 = recolor_hair(t0, face)
    n1 = recolor_shading(t1, face)
    t0.save(tex_dir / 'texture_00.png')
    t1.save(tex_dir / 'texture_01.png')
    print(f'recolored v3: hair px={n0}, shading px={n1}')


if __name__ == '__main__':
    main()
