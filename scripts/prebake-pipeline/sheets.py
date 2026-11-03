"""Contact sheets from the review renders: one per style (front + side, all colours) and one overview per gender."""
from pathlib import Path

from PIL import Image, ImageDraw

import catalog


def _view(path: Path, i: int, size: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    w = im.height
    return im.crop((i * w, 0, (i + 1) * w, w)).resize((size, size))


def write(run_dir: Path):
    scenes, out = run_dir / "scenes", run_dir / "review"
    out.mkdir(exist_ok=True)
    for gender, table in catalog.styles().items():
        colors = list(catalog.COLORS[gender])
        cell = 150
        overview = Image.new("RGB", (110 + cell * len(colors), 16 + cell * len(table)), "white")
        draw = ImageDraw.Draw(overview)
        for j, c in enumerate(colors):
            draw.text((110 + j * cell + 4, 2), c, fill="black")
        for r, cut in enumerate(table):
            draw.text((4, 16 + r * cell + cell // 2), cut, fill="black")
            detail = Image.new("RGB", (len(colors) * 240, 2 * 240 + 18), "white")
            dd = ImageDraw.Draw(detail)
            for j, c in enumerate(colors):
                jpg = scenes / f"{catalog.image_name(gender, cut, c)}.jpg"
                if not jpg.exists():
                    continue
                overview.paste(_view(jpg, 0, cell), (110 + j * cell, 16 + r * cell))
                dd.text((j * 240 + 4, 2), c, fill="black")
                detail.paste(_view(jpg, 0, 240), (j * 240, 18))
                detail.paste(_view(jpg, 1, 240), (j * 240, 258))
            detail.save(out / f"{catalog.image_name(gender, cut, 'all')}.jpg", quality=86)
        overview.save(out / f"overview_{gender}.jpg", quality=86)
