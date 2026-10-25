"""Stacks the layers written by site/screens-app.mjs (frame, page views, overlay, peek) into one picture per shot and
saves it as WebP in site/assets. Usage: python site/shots.py <layers dir>"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

src = Path(sys.argv[1])
dest = Path(__file__).parent / "assets"
for spec in sorted(src.glob("*.json")):
    shot = json.loads(spec.read_text())
    base = None
    k = 1.0  # pixels per window unit: 2 when the app ran with --force-device-scale-factor=2
    for layer in shot["layers"]:
        im = Image.open(src / layer["file"]).convert("RGBA")
        if base is None:
            base = im
            if "win" in shot:
                k = base.width / shot["win"][0]
            continue
        r = round(layer.get("radius", 0) * k)
        if r:
            mask = Image.new("L", im.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), radius=r, fill=255)
            alpha = Image.composite(im.getchannel("A"), Image.new("L", im.size, 0), mask)
            im.putalpha(alpha)
        base.alpha_composite(im, (round(layer["x"] * k), round(layer["y"] * k)))
    if "crop" in shot:
        x, y, w, h = (round(v * k) for v in shot["crop"])
        base = base.crop((x, y, x + w, y + h))
    if base.width > 1920:  # enough for a 960 px wide frame on a 2x screen
        base = base.resize((1920, round(base.height * 1920 / base.width)), Image.LANCZOS)
    base.convert("RGB").save(dest / f"{shot['name']}.webp", "WEBP", quality=82, method=6)
    print(shot["name"], base.size)
