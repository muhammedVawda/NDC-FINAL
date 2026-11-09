#!/usr/bin/env python3
"""
Generate the sized logo assets used by the header, footer and hero watermark.

WHY THIS EXISTS
The approved header artwork (assets/img/ndc-logo-header.png, 1031x785) carries
~27% dead padding, and browsers downscale it ~8x when it is shown at ~100px
tall, which turns the small lettering ("DEBT CONSULTANTS", the tagline) to mush.
This script crops to the artwork (INCLUDING the faint South Africa outline,
measured to x 235-963, y 53-734) with a safe margin, then resamples with
Lanczos to the exact pixel sizes needed at 1x / 2x / 3x so the browser never
has to do a large downscale itself.

It does not redraw, recolour or alter the artwork. The background stays the
flattened #09161D the header, footer and hero use.

Usage (needs Pillow):  python3 scripts/make-logo-assets.py
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "img"
SRC = IMG / "ndc-logo-header.png"          # approved flattened artwork, RGBA
BG = (9, 22, 29)                            # --color-charcoal-900

# Artwork bbox is x 235..963, y 53..734 at diff>3 against BG. 14px safety
# margin on every side keeps the faint outline fully inside the crop.
CROP = (221, 39, 977, 748)                  # 756 x 709
ASPECT = (CROP[2] - CROP[0]) / (CROP[3] - CROP[1])

# Rendered heights in CSS px. Header desktop 96, header mobile 64, footer 108.
# Each is produced at 1x, 2x and 3x.
CSS_HEIGHTS = {96, 64, 108}
HEIGHTS = sorted({h * m for h in CSS_HEIGHTS for m in (1, 2, 3)})


def resize(img, h):
    w = round(h * ASPECT)
    out = img.resize((w, h), Image.LANCZOS)
    # Gentle sharpen: restores the thin strokes of the small lettering that a
    # large Lanczos reduction softens. Radius/percent are deliberately small.
    return out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=55, threshold=2))


def main():
    base = Image.open(SRC).convert("RGBA").crop(CROP)
    for h in HEIGHTS:
        im = resize(base, h)
        path = IMG / f"ndc-logo-h{h}.webp"
        im.save(path, "WEBP", lossless=True, quality=100, method=6)
        print(f"{path.name:22s} {im.size[0]}x{im.size[1]}  {path.stat().st_size/1024:5.1f} KB")

    # PNG fallback for browsers without WebP (very old Safari): 2x desktop.
    fb = resize(base, 192)
    fb.save(IMG / "ndc-logo-h192.png", optimize=True)
    print(f"ndc-logo-h192.png      {fb.size[0]}x{fb.size[1]}  {(IMG/'ndc-logo-h192.png').stat().st_size/1024:5.1f} KB")

    # Hero watermark: flattened onto the hero colour, lossy is fine at 5% opacity.
    flat = Image.new("RGB", base.size, BG)
    flat.paste(base, mask=base.getchannel("A"))
    wm_w = 760
    wm = flat.resize((wm_w, round(wm_w / ASPECT)), Image.LANCZOS)
    wm.save(IMG / "ndc-watermark.webp", "WEBP", quality=82, method=6)
    print(f"ndc-watermark.webp     {wm.size[0]}x{wm.size[1]}  {(IMG/'ndc-watermark.webp').stat().st_size/1024:5.1f} KB")


if __name__ == "__main__":
    main()
