"""Step 3: heads -> prebake .splat files in public/prebake/, plus review data.

    python build.py <run_dir>

Writes public/prebake/<men|women>/<cut>-<color>.splat for every head in <run_dir>/heads,
hair-only review scenes to <run_dir>/scenes/, and <run_dir>/shape.json: how far each
recolour's front hair outline moved from its base colour (IoU; < 0.8 is worth a look —
light and very dark hair score low without any real change, so check by eye).
Then: `npm run prebake:spz` and `npm run prebake:upload`.
"""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import catalog  # noqa: E402
from extract import KEYS, hair_mask  # noqa: E402
from splat_io import splat_bytes  # noqa: E402

PUBLIC = catalog.REPO / "public/prebake"


def front_hair(npz: Path) -> np.ndarray:
    return np.isin(np.load(npz)["labels"][0], [13, 14])  # view 0 = the generated front view


def main():
    run = Path(sys.argv[1]).expanduser()
    heads, scenes = run / "heads", run / "scenes"
    scenes.mkdir(exist_ok=True)
    shape, stats, written = {}, {}, 0
    for gender, table in catalog.styles().items():
        out_dir = PUBLIC / catalog.GENDER_DIR[gender]
        out_dir.mkdir(parents=True, exist_ok=True)
        for cut in table:
            base = heads / f"{catalog.image_name(gender, cut, catalog.base_color(gender))}.npz"
            base_front = front_hair(base) if base.exists() else None
            for color in catalog.COLORS[gender]:
                name = catalog.image_name(gender, cut, color)
                npz = heads / f"{name}.npz"
                if not npz.exists():
                    print("missing head:", name)
                    continue
                d = dict(np.load(npz))
                keep, st = hair_mask(d)
                stats[name] = st
                (out_dir / f"{catalog.file_stem(cut, color)}.splat").write_bytes(
                    splat_bytes(*(d[k][keep] for k in KEYS)))
                np.savez(scenes / f"{name}.npz", **{k: d[k][keep].astype(np.float32) for k in KEYS})
                if base_front is not None and npz != base:
                    f = front_hair(npz)
                    shape[name] = round(float((f & base_front).sum() / max(1, (f | base_front).sum())), 3)
                written += 1
    (run / "shape.json").write_text(json.dumps(shape, indent=1))
    (run / "extract_stats.json").write_text(json.dumps(stats, indent=1))
    low = sorted((v, k) for k, v in shape.items() if v < 0.8)
    print(f"{written} prebakes -> {PUBLIC.relative_to(catalog.REPO)}; check by eye (outline IoU < 0.8): "
          + (", ".join(f"{k} {v}" for v, k in low) or "none"))


if __name__ == "__main__":
    main()
