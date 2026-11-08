"""Per-head fit for the catalog prebakes: where the wearer's skull tops out.

The prebakes are FaceLift-native, so a cut lands on any head in the same place it sat on
the house model. FaceLift normalises on the face, not the skull, and skull height above the
eye line varies by ~0.25 between people (house male 0.64, a flat-crowned tester 0.57, a tall
one 0.76). Hair built on the house male therefore hovers over a lower crown and is swallowed
by a taller one. The app scales each cut vertically about the eye line (z = ANCHOR_Z) so the
house crown lands on the wearer's crown (src/lib/splatFit.ts); the house crowns measured here
are baked into the catalog manifest (catalog.FIT).

    python fit.py <house_male_buzz.npz> <house_female_buzz.npz>

crown_z must stay identical to crownZ in src/lib/splatFit.ts.
"""
import sys

import numpy as np

ANCHOR_Z = 0.0          # eye line: hair below it (sides, back, lengths) is left alone
CELL = 0.1              # column size over the top of the head (FaceLift object units)
X_EDGES = (-0.15, -0.05, 0.05, 0.15)
Y_EDGES = (-0.2, -0.1, 0.0, 0.1, 0.2, 0.3, 0.4)
MIN_PER_CELL = 20
TRANSMITTANCE = 0.3     # looking straight down a column, the skull is where this much light is blocked


def crown_z(xyz: np.ndarray, opacity: np.ndarray) -> float | None:
    """Highest point of the solid head seen from above (None if the top is empty).

    Per column cell, walk down from the top accumulating opacity until the transmittance
    drops below TRANSMITTANCE; sheer halos (a buzz cut's fuzz) are walked through.
    """
    x, y, z = np.asarray(xyz, np.float64).T
    a = np.asarray(opacity, np.float64)
    best = None
    for x0, x1 in zip(X_EDGES, X_EDGES[1:]):
        for y0, y1 in zip(Y_EDGES, Y_EDGES[1:]):
            m = (x >= x0) & (x < x1) & (y >= y0) & (y < y1)
            if m.sum() < MIN_PER_CELL:
                continue
            order = np.argsort(-z[m], kind="stable")
            t = np.cumprod(1.0 - a[m][order])
            hit = np.nonzero(t < TRANSMITTANCE)[0]
            if len(hit):
                zt = float(z[m][order][hit[0]])
                best = zt if best is None else max(best, zt)
    return best


def fit_scale(wearer_crown: float, house_crown: float, anchor: float = ANCHOR_Z) -> float:
    """Vertical scale (about the anchor) that puts the house crown on the wearer's."""
    return (wearer_crown - anchor) / (house_crown - anchor)




# ---------------------------------------------------------------------------
# Hairline: where the buzz-cut head's front surface turns from forehead colour to stubble
# colour. Mirrors hairlineZ in src/lib/splatFit.ts (same constants; keep them identical).
#
# Per x column the rows are binned in z; each bin's colour is the per-channel median RGB of
# its front-most rows. The forehead colour is the lowest run of SKIN_REF_BINS consecutive
# bins that agree within HAIR_MIN_CONTRAST (the bins right above the eye line are often brow
# shadow), the stubble colour is the top STUBBLE_REF_BINS bins, and the hairline is where a
# bin's distance from the forehead crosses HAIRLINE_FRACTION of the forehead→stubble
# contrast. A fraction of the contrast rather than a fixed distance is what works on dark
# skin and on platinum/grey stubble alike; no contrast (bald) = unmeasurable.
HAIR_X_SAMPLES = (-0.1, 0.0, 0.1)
HAIR_HALF_WIDTH = 0.05
HAIR_Z_LO, HAIR_Z_HI, HAIR_Z_STEP = 0.0, 0.66, 0.03
HAIR_MIN_ALPHA = 0.1
HAIR_MIN_PER_BIN = 12
HAIR_FRONT_FRACTION = 0.25
SKIN_REF_BINS = 3
STUBBLE_REF_BINS = 3
HAIR_MIN_CONTRAST = 0.15
HAIRLINE_FRACTION = 0.5
HAIRLINE_MIN_Z = 0.15
HAIRLINE_CROWN_GAP = 0.08
HAIRLINE_MAX_SPREAD = 0.06


def _median_rgb(cs):
    """Per-channel median, upper-middle element for even counts (same as the TypeScript)."""
    s = np.sort(np.asarray(cs, np.float64), axis=0)
    return s[len(s) // 2]


def _hairline_at_column(xyz, rgb, opacity, xc):
    x, y, z = xyz.T
    nb = int(np.ceil((HAIR_Z_HI - HAIR_Z_LO) / HAIR_Z_STEP))
    sel = (opacity >= HAIR_MIN_ALPHA) & (np.abs(x - xc) < HAIR_HALF_WIDTH) & (y < 0) & (z >= HAIR_Z_LO) & (z < HAIR_Z_HI)
    bins = np.floor((z[sel] - HAIR_Z_LO) / HAIR_Z_STEP).astype(int)
    ys, cs = y[sel], rgb[sel]
    colour = [None] * nb
    for i in range(nb):
        m = bins == i
        if m.sum() < HAIR_MIN_PER_BIN:
            continue
        order = np.argsort(ys[m], kind="stable")                  # most negative y first = facing the camera
        colour[i] = _median_rgb(cs[m][order][: max(8, int(m.sum() * HAIR_FRONT_FRACTION))])
    measurable = [i for i in range(nb) if colour[i] is not None]
    dist = lambda a, b: float(np.linalg.norm(a - b))  # noqa: E731
    # Forehead colour: the lowest SKIN_REF_BINS consecutive measurable bins that agree with each other.
    skin, skin_top = None, -1
    for s in range(len(measurable) - SKIN_REF_BINS + 1):
        idx = measurable[s:s + SKIN_REF_BINS]
        if idx[-1] - idx[0] != SKIN_REF_BINS - 1:
            continue
        ref = [colour[i] for i in idx]
        if max(dist(a, b) for a in ref for b in ref) <= HAIR_MIN_CONTRAST:
            skin, skin_top = _median_rgb(ref), idx[-1]
            break
    if skin is None:
        return None
    # Stubble colour: the top of the column. No contrast against the forehead = nothing to find.
    above = [i for i in measurable if i > skin_top]
    if len(above) < STUBBLE_REF_BINS:
        return None
    contrast = dist(_median_rgb([colour[i] for i in above[-STUBBLE_REF_BINS:]]), skin)
    if contrast < HAIR_MIN_CONTRAST:
        return None
    # Walk up: the first bin past the level is stubble; interpolate the crossing between the
    # last forehead bin's centre and this bin's centre.
    level = contrast * HAIRLINE_FRACTION
    j = skin_top
    for i in above:
        d = dist(colour[i], skin)
        if d > level:
            za, zb = HAIR_Z_LO + (j + 0.5) * HAIR_Z_STEP, HAIR_Z_LO + (i + 0.5) * HAIR_Z_STEP
            da = dist(colour[j], skin)
            t = min(1.0, max(0.0, (level - da) / (d - da))) if d > da else 1.0
            return za + (zb - za) * t
        j = i
    return None


def hairline_z(xyz: np.ndarray, rgb: np.ndarray, opacity: np.ndarray, crown: float | None = None) -> float | None:
    """Wearer hairline (object z) off a buzz-cut head, or None when the three x samples disagree,
    the forehead→stubble colour step is missing (bald, stubble the colour of the skin) or it
    lands outside the band."""
    xyz = np.asarray(xyz, np.float64)
    rgb = np.asarray(rgb, np.float64)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    found = []
    for xc in HAIR_X_SAMPLES:
        zc = _hairline_at_column(xyz, rgb, np.asarray(opacity, np.float64), xc)
        if zc is None:
            return None
        found.append(zc)
    found.sort()
    if found[2] - found[0] > HAIRLINE_MAX_SPREAD:
        return None
    zc = found[1]
    max_z = (HAIR_Z_HI if crown is None else crown) - HAIRLINE_CROWN_GAP
    if zc < HAIRLINE_MIN_Z or zc > max_z:
        return None
    return zc


# ---------------------------------------------------------------------------
# Head width, depth and centre at the temple band (mirrors lib/splatFit.ts headWidthX /
# headDepthY / headCenterX). The app scales a cut's x by wearer_width / house_width and its
# y by wearer_depth / house_depth (each clamped to 0.85–1.2) and shifts it by the centre
# difference, so these three numbers go into catalog.FIT per gender.

TEMPLE_Z = (0.2, 0.3)
TEMPLE_FRONT_Y = 0.15      # width/centre: forehead to ear only
TEMPLE_MIN_ALPHA = 0.1
TEMPLE_MIN_ROWS = 100


def _temple(xyz, opacity, axis: str):
    xyz = np.asarray(xyz, np.float64)
    a = np.asarray(opacity, np.float64)
    sel = (a >= TEMPLE_MIN_ALPHA) & (xyz[:, 2] >= TEMPLE_Z[0]) & (xyz[:, 2] < TEMPLE_Z[1])
    if axis == "x":
        sel &= xyz[:, 1] < TEMPLE_FRONT_Y
    vals = xyz[sel, 0 if axis == "x" else 1]
    return None if len(vals) < TEMPLE_MIN_ROWS else np.sort(vals)


def _q(s, p):
    return float(s[min(len(s) - 1, int(p * len(s)))])


def head_width_x(xyz, opacity) -> float | None:
    s = _temple(xyz, opacity, "x")
    return None if s is None else _q(s, 0.98) - _q(s, 0.02)


def head_depth_y(xyz, opacity) -> float | None:
    s = _temple(xyz, opacity, "y")
    return None if s is None else _q(s, 0.98) - _q(s, 0.02)


def head_center_x(xyz, opacity) -> float | None:
    """Midpoint of the temple band's x extent, not its median: a single-selfie head has more
    Gaussians on one side, which biased the median by up to 0.06 on real heads."""
    s = _temple(xyz, opacity, "x")
    return None if s is None else (_q(s, 0.02) + _q(s, 0.98)) / 2


if __name__ == "__main__":
    for path in sys.argv[1:]:
        d = np.load(path)
        xyz, op = d["xyz"], d["opacity"]
        crown = crown_z(xyz, op)
        rgb = d["rgb"] if "rgb" in d else None
        hl = hairline_z(xyz, rgb, op, crown) if rgb is not None else None
        fmt = lambda v: "None" if v is None else f"{v:.3f}"
        print(f"{path}: crown_z={fmt(crown)} hairline_z={fmt(hl)} width_x={fmt(head_width_x(xyz, op))} "
              f"depth_y={fmt(head_depth_y(xyz, op))} center_x={fmt(head_center_x(xyz, op))}")
