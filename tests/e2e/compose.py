"""Stacks the frame, page and overlay screenshots from shot-bar.mjs into one PNG per state."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(sys.argv[1])
for spec in sorted(out.glob("*.json")):
    layers = json.loads(spec.read_text())
    frame = Image.open(out / layers["frame"]).convert("RGBA")
    page = Image.open(out / layers["page"]).convert("RGBA")
    mask = Image.new("L", page.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, page.size[0] - 1, page.size[1] - 1), radius=layers["radius"], fill=255)
    frame.paste(page, tuple(layers["pageAt"]), mask)
    if "overlay" in layers:
        ov = Image.open(out / layers["overlay"]).convert("RGBA")
        frame.alpha_composite(ov, tuple(layers["overlayAt"]))
    frame.convert("RGB").save(out / f"{spec.stem}.png")
    print(spec.stem)
