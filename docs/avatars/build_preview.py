"""Compose the Clawd HQ avatars from parts.json and write the previews.

Usage:  python3 build_preview.py [--crops DIR]

Writes preview.png and preview.html next to this file. With --crops it also
writes one image per panel into DIR (handy for looking closely while tuning).
"""
import html
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BACKGROUNDS = {"dark": "#1a1a1a", "light": "#F4F1EA"}
TEXT = {"dark": "#E8E4DC", "light": "#2A2622"}
MUTED = {"dark": "#8C877E", "light": "#7A746A"}
BIG_SCALE, ICON_SCALE = 10, 4
COLUMNS, GAP, MARGIN, LABEL_H = 6, 24, 32, 34
Grid = list[list[str | None]]
FONT_PATHS = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]


def load_font(size: int) -> ImageFont.ImageFont:
    for path in FONT_PATHS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def blank(width: int, height: int) -> Grid:
    return [[None] * width for _ in range(height)]


def paint(grid: Grid, part: dict, name: str) -> Grid:
    """Return a new grid with the part painted on top."""
    out = [row[:] for row in grid]
    width = len(part["rows"][0])
    for dy, row in enumerate(part["rows"]):
        if len(row) != width:
            raise ValueError(f"{name}: row {dy} is {len(row)} wide, expected {width}")
        for dx, ch in enumerate(row):
            if ch == ".":
                continue
            x, y = part["x"] + dx, part["y"] + dy
            if not (0 <= y < len(out) and 0 <= x < len(out[0])):
                raise ValueError(f"{name}: pixel ({x},{y}) is outside the grid")
            out[y][x] = ch
    return out


def compose(data: dict, character: dict) -> Grid:
    width, height = data["meta"]["grid"]
    grid = paint(blank(width, height), data["body"], "body")
    for layer in data["meta"]["layer_order"][1:]:
        name = character[layer]
        grid = paint(grid, data["parts"][layer][name], f"{layer}/{name}")
    return grid


def compose_compact(data: dict, character: dict) -> Grid:
    width, height = data["meta"]["compact_grid"]
    compact = data["compact"]
    grid = paint(blank(width, height), compact["body"], "compact/body")
    hat = character["headwear"]
    grid = paint(grid, compact["headwear"][hat], f"compact/headwear/{hat}")
    accent = character["compact_accent"]
    return paint(grid, compact["accent"][accent], f"compact/accent/{accent}")


def validate(data: dict, sprites: list[Grid], icons: list[Grid]) -> None:
    palette, limit = data["palette"], data["meta"]["max_colors_per_sprite"]
    seen = {}
    for character, sprite, icon in zip(data["characters"], sprites, icons):
        for kind, grid in (("sprite", sprite), ("icon", icon)):
            used = {ch for row in grid for ch in row if ch}
            unknown = used - set(palette)
            if unknown:
                raise ValueError(f"{character['id']} {kind}: unknown colours {sorted(unknown)}")
            if len(used) > limit:
                raise ValueError(f"{character['id']} {kind}: {len(used)} colours, limit is {limit}")
        combo = tuple(character[layer] for layer in data["meta"]["layer_order"][1:])
        if combo in seen:
            raise ValueError(f"{character['id']} has the same parts as {seen[combo]}")
        seen[combo] = character["id"]


def draw_grid(draw: ImageDraw.ImageDraw, grid: Grid, palette: dict, left: int, top: int, scale: int) -> None:
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch:
                box = [left + x * scale, top + y * scale, left + (x + 1) * scale - 1, top + (y + 1) * scale - 1]
                draw.rectangle(box, fill=palette[ch])


def panel(data: dict, sprites: list[Grid], icons: list[Grid], theme: str) -> Image.Image:
    palette = data["palette"]
    sprite_w, sprite_h = (n * BIG_SCALE for n in data["meta"]["grid"])
    icon_w, icon_h = (n * ICON_SCALE for n in data["meta"]["compact_grid"])
    rows = -(-len(sprites) // COLUMNS)
    width = MARGIN * 2 + COLUMNS * sprite_w + (COLUMNS - 1) * GAP
    icon_gap = (width - MARGIN * 2 - len(icons) * icon_w) // (len(icons) - 1)
    height = MARGIN + 30 + rows * (sprite_h + LABEL_H) + 40 + icon_h + 28 + MARGIN
    image = Image.new("RGB", (width, height), BACKGROUNDS[theme])
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN, MARGIN - 8), f"{theme} background  |  24x24 at {BIG_SCALE}x", fill=MUTED[theme], font=load_font(15))
    top = MARGIN + 30
    for i, (character, sprite) in enumerate(zip(data["characters"], sprites)):
        left = MARGIN + (i % COLUMNS) * (sprite_w + GAP)
        y = top + (i // COLUMNS) * (sprite_h + LABEL_H)
        draw_grid(draw, sprite, palette, left, y, BIG_SCALE)
        draw.text((left + sprite_w // 2, y + sprite_h + 4), character["label"], fill=TEXT[theme], font=load_font(15), anchor="ma")
    y = top + rows * (sprite_h + LABEL_H) + 12
    draw.text((MARGIN, y), f"list icons  |  16x12 at {ICON_SCALE}x", fill=MUTED[theme], font=load_font(15))
    y += 28
    for i, (character, icon) in enumerate(zip(data["characters"], icons)):
        left = MARGIN + i * (icon_w + icon_gap)
        draw_grid(draw, icon, palette, left, y, ICON_SCALE)
        draw.text((left + icon_w // 2, y + icon_h + 4), character["short"], fill=MUTED[theme], font=load_font(10), anchor="ma")
    return image


def svg(grid: Grid, palette: dict, scale: int) -> str:
    rects = []
    for y, row in enumerate(grid):
        x = 0
        while x < len(row):
            ch, start = row[x], x
            while x < len(row) and row[x] == ch:
                x += 1
            if ch:
                rects.append(f'<rect x="{start}" y="{y}" width="{x - start}" height="1" fill="{palette[ch]}"/>')
    width, height = len(grid[0]), len(grid)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width * scale}" height="{height * scale}" '
            f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges">{"".join(rects)}</svg>')


def page(data: dict, sprites: list[Grid], icons: list[Grid]) -> str:
    palette, layers = data["palette"], data["meta"]["layer_order"][1:]
    sections = []
    for theme, background in BACKGROUNDS.items():
        cards = "".join(
            f'<figure>{svg(sprite, palette, BIG_SCALE)}<figcaption>{html.escape(c["label"])}</figcaption></figure>'
            for c, sprite in zip(data["characters"], sprites))
        small = "".join(
            f'<figure>{svg(icon, palette, ICON_SCALE)}<figcaption>{html.escape(c["short"])}</figcaption></figure>'
            for c, icon in zip(data["characters"], icons))
        sections.append(
            f'<section style="background:{background};color:{TEXT[theme]}"><h2>{theme} background</h2>'
            f'<div class="big">{cards}</div><h2>list icons (16x12 at {ICON_SCALE}x)</h2><div class="small">{small}</div></section>')
    table = "".join(
        "<tr><td>{}</td><td>{}</td><td>{}</td></tr>".format(
            html.escape(c["label"]), html.escape(", ".join(f"{layer}: {c[layer]}" for layer in layers)), html.escape(c["why"]))
        for c in data["characters"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clawd HQ avatars</title>
<style>
body{{margin:0;font-family:ui-monospace,Menlo,monospace;background:#1a1a1a;color:#E8E4DC}}
section{{padding:24px 32px}} h1{{margin:0;padding:24px 32px 0;font-size:18px}}
h2{{font-size:13px;font-weight:400;opacity:.6;margin:8px 0 16px}}
.big,.small{{display:flex;flex-wrap:wrap;gap:20px}} figure{{margin:0;text-align:center}}
figcaption{{font-size:13px;margin-top:4px}} .small figcaption{{font-size:10px;opacity:.7}}
svg{{display:block;margin:0 auto}}
table{{border-collapse:collapse;margin:24px 32px;font-size:13px;max-width:1200px}}
td{{border-top:1px solid #444;padding:8px 12px;vertical-align:top}}
</style></head><body>
<h1>Clawd HQ avatars: design exploration</h1>
{"".join(sections)}
<table><tr><td>skill</td><td>parts</td><td>why</td></tr>{table}</table>
</body></html>
"""


def main() -> None:
    data = json.loads((HERE / "parts.json").read_text())
    sprites = [compose(data, c) for c in data["characters"]]
    icons = [compose_compact(data, c) for c in data["characters"]]
    validate(data, sprites, icons)
    panels = [panel(data, sprites, icons, theme) for theme in BACKGROUNDS]
    sheet = Image.new("RGB", (panels[0].width, sum(p.height for p in panels)))
    offset = 0
    for image in panels:
        sheet.paste(image, (0, offset))
        offset += image.height
    sheet.save(HERE / "preview.png")
    (HERE / "preview.html").write_text(page(data, sprites, icons))
    if "--crops" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--crops") + 1])
        out.mkdir(parents=True, exist_ok=True)
        for theme, image in zip(BACKGROUNDS, panels):
            image.save(out / f"panel_{theme}.png")
    sys.stdout.write(f"wrote preview.png ({sheet.width}x{sheet.height}) and preview.html for {len(sprites)} characters\n")


if __name__ == "__main__":
    main()
