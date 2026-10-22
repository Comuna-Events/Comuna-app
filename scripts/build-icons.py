# Builds every app icon in icons/ from the Comuna mark (omark() in index.html): gold rings and a red dot on green.
#   python3 scripts/build-icons.py        (needs Pillow: pip install pillow)
# To use a designer's icon instead, replace the files in icons/ with the same names and sizes.
from pathlib import Path
from PIL import Image, ImageDraw

GREEN, SUN, RED = (0x24, 0x4D, 0x3A), (0xD6, 0xA6, 0x38), (0xA4, 0x37, 0x26)   # --green, --sun, --red
OUT = Path(__file__).resolve().parent.parent / 'icons'

def icon(px, scale):
    # same proportions as omark(), drawn 4x large and scaled down for smooth edges
    n = px * 4; im = Image.new('RGB', (n, n), GREEN); d = ImageDraw.Draw(im)
    c = n / 2; r = n * scale / 2; sw = max(2, n * scale * .085)
    ro = r - sw / 2; d.ellipse([c - ro - sw / 2, c - ro - sw / 2, c + ro + sw / 2, c + ro + sw / 2], outline=SUN, width=round(sw))
    ri = r * .42; w2 = round(sw * .8); d.ellipse([c - ri - w2 / 2, c - ri - w2 / 2, c + ri + w2 / 2, c + ri + w2 / 2], outline=SUN, width=w2)
    rd = r * .14; d.ellipse([c - rd, c - rd, c + rd, c + rd], fill=RED)
    return im.resize((px, px), Image.LANCZOS)

FILES = {
    'icon-192.png': (192, .62), 'icon-512.png': (512, .62),
    # Android crops maskable icons to a circle: keep the mark well inside the central safe zone
    'icon-192-maskable.png': (192, .52), 'icon-512-maskable.png': (512, .52),
    'apple-touch-icon.png': (180, .62),
    'favicon-32.png': (32, .86),          # bigger mark so it reads in a browser tab
    'app-store-1024.png': (1024, .62),    # for App Store Connect: 1024 px, no transparency
}
OUT.mkdir(exist_ok=True)
for name, (px, scale) in FILES.items():
    icon(px, scale).save(OUT / name, optimize=True)
    print(name, f'{px}x{px}')
