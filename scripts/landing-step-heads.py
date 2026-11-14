#!/usr/bin/env python3
"""Turns a FaceLift build of the landing guy into the head file scripts/landing-step-clips.mjs renders.

The whole chain, for each of his two photos (public/face1_selfie.webp as it is, and the same
photo given the app's buzz cut):

  1. swift scripts/subject-cutout.swift photo.png cut.png     # the person only; put it on white
     (the selfie's hallway and ceiling lamp otherwise end up in the head as grey smears)
  2. modal run scripts/prebake-pipeline/facelift_modal.py --inputs <dir> --out <dir>   # -> name.npz
  3. python scripts/landing-step-heads.py name.npz public/lab/turntable_guy[_own].splat

Step 3 is this file. FaceLift builds the head out of six generated views and keeps, for every
point, the pixel it came from and what that pixel was (skin, hair, cloth, background). Two kinds
of point are not him: the few that came from background pixels (a pale rim round the outline),
which are dropped, and the pale grey patches the generator paints on his black jacket, which are
darkened to the jacket's own colour.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "prebake-pipeline"))
import splat_io  # noqa: E402

BACKGROUND, CLOTH = 0, 18  # face-parser classes (see extract.py)
PALE, GREY, JACKET = 0.28, 0.2, 0.15  # brighter than PALE and less saturated than GREY is not black leather

src, dst = sys.argv[1], sys.argv[2]
d = np.load(src)
view, row, col = splat_io.source_pixel(splat_io.local_index(d))
from_pixel = (view >= 0) & (view < len(d["labels"]))
label = np.where(from_pixel, d["labels"][np.clip(view, 0, len(d["labels"]) - 1), row, col], 255)

rgb = d["rgb"].copy()
brightness = rgb.max(1)
saturation = (brightness - rgb.min(1)) / np.maximum(brightness, 1e-6)
pale_cloth = (label == CLOTH) & (brightness > PALE) & (saturation < GREY)
rgb[pale_cloth] *= (JACKET / brightness[pale_cloth])[:, None]

keep = label != BACKGROUND
out = splat_io.splat_bytes(d["xyz"][keep], d["scale"][keep], d["rot"][keep], d["opacity"][keep], rgb[keep])
Path(dst).write_bytes(out)
print(f"{dst}: {int(keep.sum())} points, dropped {int((~keep).sum())} from background pixels, darkened {int(pale_cloth.sum())} pale jacket points")
