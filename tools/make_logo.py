"""Generate the horizontal Stitchee logo (icon + wordmark) as lossless WebP.

Brand: gradient #a855f7 -> #7c3aed rounded-square tile with a white cross-stitch X,
followed by the "Stitchee" wordmark to the right (horizontal lockup).

Usage:
    python tools/make_logo.py
Outputs (written to App/static/ and mirrored into _site/):
    stitchee-logo.webp       - white wordmark, transparent bg (use on dark UI)
    stitchee-logo-dark.webp  - dark wordmark, transparent bg (use on light UI)
    icon-192.png             - PWA app icon, 192x192
    icon-512.png             - PWA app icon, 512x512
    icon-maskable-512.png    - PWA maskable icon (full-bleed, safe-zone padded)
"""

from __future__ import annotations

import os
import shutil

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- config ----
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "App", "static")  # source of truth
MIRROR_DIR = os.path.join(ROOT, "_site")  # static GitHub Pages build

BRAND_1 = (168, 85, 247)  # #a855f7  --brand
BRAND_2 = (124, 58, 237)  # #7c3aed  --brand-2
WHITE = (255, 255, 255, 255)
DARK = (15, 17, 23, 255)  # --bg, used for the light-background variant

WORD = "Stitchee"
FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"  # Segoe UI Bold

ICON = 240.0  # final icon side, px
GAP = 58.0  # icon -> wordmark gap
PAD_Y = 44.0  # vertical breathing room
PAD_X = 6.0  # tiny bleed so antialiasing never clips
CAP_RATIO = 0.70  # cap height / font size for Segoe UI Bold
TEXT_H = 148.0  # desired cap height of the wordmark
SS = 4  # supersample factor (render big, downscale for crisp edges)


# ------------------------------------------------------------- primitives ---
def diagonal_gradient(size: int, c1, c2) -> Image.Image:
    """Smooth 45-degree gradient square from c1 (top-left) to c2 (bottom-right)."""
    n = 256
    img = Image.new("RGB", (n, n))
    px = img.load()
    span = 2.0 * (n - 1)
    for y in range(n):
        for x in range(n):
            t = (x + y) / span
            px[x, y] = (
                round(c1[0] + (c2[0] - c1[0]) * t),
                round(c1[1] + (c2[1] - c1[1]) * t),
                round(c1[2] + (c2[2] - c1[2]) * t),
            )
    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size: int, radius: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_cross(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float],
               color, width: float) -> None:
    """Cross-stitch 'X' with rounded caps."""
    x0, y0, x1, y1 = box
    r = width / 2.0
    for a, b in (((x0, y0), (x1, y1)), ((x1, y0), (x0, y1))):
        draw.line([a, b], fill=color, width=round(width))
        for cx, cy in (a, b):
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


# ------------------------------------------------------------------ build ---
def build(text_color, out_name: str) -> str:
    # --- measure the wordmark at supersampled scale -------------------------
    font = ImageFont.truetype(FONT_BOLD, round(TEXT_H / CAP_RATIO * SS))
    text_w = font.getlength(WORD)

    icon = ICON * SS
    gap = GAP * SS
    pad_x = PAD_X * SS
    canvas_h = round(ICON * SS + 2 * PAD_Y * SS)
    canvas_w = round(pad_x * 2 + icon + gap + text_w)

    logo = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    # --- icon tile ---------------------------------------------------------
    iy = round((canvas_h - icon) / 2)
    tile = diagonal_gradient(round(icon), BRAND_1, BRAND_2).convert("RGBA")
    tile.putalpha(rounded_mask(round(icon), radius=icon * 0.225))

    layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    layer.paste(tile, (round(pad_x), iy), tile)
    logo = Image.alpha_composite(logo, layer)

    draw = ImageDraw.Draw(logo)
    inset = icon * 0.265
    draw_cross(
        draw,
        (pad_x + inset, iy + inset, pad_x + icon - inset, iy + icon - inset),
        WHITE,
        width=icon * 0.108,
    )

    # --- wordmark ----------------------------------------------------------
    tx = pad_x + icon + gap
    asc, desc = font.getmetrics()
    ty = (canvas_h - (asc + desc)) / 2
    draw.text((tx, ty), WORD, font=font, fill=text_color)

    # --- downscale for crisp antialiasing ----------------------------------
    final = logo.resize(
        (round(canvas_w / SS), round(canvas_h / SS)), Image.LANCZOS
    )

    out_path = os.path.join(OUT_DIR, out_name)
    os.makedirs(OUT_DIR, exist_ok=True)
    final.save(out_path, format="WEBP", lossless=True, quality=100, method=6)
    if os.path.isdir(MIRROR_DIR):
        shutil.copy(out_path, os.path.join(MIRROR_DIR, out_name))
    return out_path


def build_icon(size: int, out_name: str, maskable: bool = False) -> str:
    """Square PWA icon: gradient tile + white cross-stitch X, saved as PNG.

    A normal icon uses a rounded tile; a *maskable* icon is full-bleed with the
    X kept inside the 80% safe zone, so platform masks (circle, squircle...)
    never clip the mark.
    """
    ss = 4
    S = size * ss
    tile = diagonal_gradient(S, BRAND_1, BRAND_2).convert("RGBA")
    if not maskable:
        tile.putalpha(rounded_mask(S, radius=S * 0.225))

    icon = Image.alpha_composite(Image.new("RGBA", (S, S), (0, 0, 0, 0)), tile)
    draw = ImageDraw.Draw(icon)
    inset = S * (0.34 if maskable else 0.265)
    draw_cross(draw, (inset, inset, S - inset, S - inset), WHITE, width=S * 0.108)

    final = icon.resize((size, size), Image.LANCZOS)
    out_path = os.path.join(OUT_DIR, out_name)
    os.makedirs(OUT_DIR, exist_ok=True)
    final.save(out_path, format="PNG", optimize=True)
    if os.path.isdir(MIRROR_DIR):
        shutil.copy(out_path, os.path.join(MIRROR_DIR, out_name))
    return out_path


if __name__ == "__main__":
    for color, name in ((WHITE, "stitchee-logo.webp"), (DARK, "stitchee-logo-dark.webp")):
        path = build(color, name)
        with Image.open(path) as im:
            print(f"{os.path.basename(path)}  {im.size[0]}x{im.size[1]}  {im.mode}  "
                  f"{os.path.getsize(path) / 1024:.1f} KB")
    for size, name, maskable in (
        (192, "icon-192.png", False),
        (512, "icon-512.png", False),
        (512, "icon-maskable-512.png", True),
    ):
        path = build_icon(size, name, maskable)
        print(f"{os.path.basename(path)}  {size}x{size}  "
              f"{os.path.getsize(path) / 1024:.1f} KB")
