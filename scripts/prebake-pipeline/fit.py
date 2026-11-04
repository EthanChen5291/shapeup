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



if __name__ == "__main__":
    for path in sys.argv[1:]:
        d = np.load(path)
        print(f"{path}: crown_z = {crown_z(d['xyz'], d['opacity']):.3f}")


# ---------------------------------------------------------------------------
# Hairline: where the buzz-cut head's front surface turns from skin to stubble.
# Mirrors hairlineZ in src/lib/splatFit.ts (same constants; keep them identical).
HAIR_X_SAMPLES = (-0.1, 0.0, 0.1)
HAIR_HALF_WIDTH = 0.05
HAIR_Z_LO, HAIR_Z_HI, HAIR_Z_STEP = 0.0, 0.66, 0.03
HAIR_MIN_ALPHA = 0.1
HAIR_MIN_PER_BIN = 12
HAIR_FRONT_FRACTION = 0.25
SKIN_LUMA = 0.5
STUBBLE_RATIO = 0.6
MIN_SKIN_BINS = 2
HAIRLINE_MIN_Z = 0.15
HAIRLINE_CROWN_GAP = 0.08
HAIRLINE_MAX_SPREAD = 0.06


def _hairline_at_column(xyz, luma, opacity, xc):
    x, y, z = xyz.T
    nb = int(np.ceil((HAIR_Z_HI - HAIR_Z_LO) / HAIR_Z_STEP))
    sel = (opacity >= HAIR_MIN_ALPHA) & (np.abs(x - xc) < HAIR_HALF_WIDTH) & (y < 0) & (z >= HAIR_Z_LO) & (z < HAIR_Z_HI)
    bins = np.floor((z[sel] - HAIR_Z_LO) / HAIR_Z_STEP).astype(int)
    ys, ls = y[sel], luma[sel]
    med = np.full(nb, np.nan)
    for i in range(nb):
        m = bins == i
        if m.sum() < HAIR_MIN_PER_BIN:
            continue
        order = np.argsort(ys[m], kind="stable")                  # most negative y first = facing the camera
        front = ls[m][order][: max(8, int(m.sum() * HAIR_FRONT_FRACTION))]
        med[i] = float(np.median(front))
    skin_bins, skin_sum = 0, 0.0
    for i in range(nb):
        L = med[i]
        if np.isnan(L):
            continue
        if skin_bins >= MIN_SKIN_BINS:
            level = (skin_sum / skin_bins) * STUBBLE_RATIO
            if L < level:
                j = i - 1
                while j >= 0 and np.isnan(med[j]):
                    j -= 1
                za, zb = HAIR_Z_LO + (j + 0.5) * HAIR_Z_STEP, HAIR_Z_LO + (i + 0.5) * HAIR_Z_STEP
                la = med[j]
                t = min(1.0, max(0.0, (la - level) / (la - L))) if la > L else 1.0
                return za + (zb - za) * t
        if L >= SKIN_LUMA:
            skin_bins += 1
            skin_sum += L
    return None


def hairline_z(xyz: np.ndarray, rgb: np.ndarray, opacity: np.ndarray, crown: float | None = None) -> float | None:
    """Wearer hairline (object z) off a buzz-cut head, or None when the three x samples disagree,
    the brightness step is missing (bald, dark skin under dark stubble) or it lands outside the band."""
    xyz = np.asarray(xyz, np.float64)
    rgb = np.asarray(rgb, np.float64)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    luma = 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]
    found = []
    for xc in HAIR_X_SAMPLES:
        zc = _hairline_at_column(xyz, luma, np.asarray(opacity, np.float64), xc)
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
