"""Pixel bookkeeping and .splat writing shared by the prebake pipeline.

GS-LRM makes one Gaussian per pixel of the 6 generated views (512 px, 8 px patches).
The worker keeps each surviving Gaussian's original index (`src_idx`), so we can
always say which view/row/column it came from.
"""
import numpy as np

VIEWS, H, W, P = 6, 512, 512, 8
SPLAT_DTYPE = np.dtype([("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("q", "u1", 4)])


def source_pixel(local):
    """Flat pixel-Gaussian index -> (view, row, col). GS-LRM order: views, hp, wp, ph, pw."""
    local = np.asarray(local)
    pw = local % P
    local = local // P
    ph = local % P
    local = local // P
    wp = local % (W // P)
    local = local // (W // P)
    hp = local % (H // P)
    v = local // (H // P)
    return v, hp * P + ph, wp * P + pw


def pixel_index(v, row, col):
    """Inverse of source_pixel (used by tests)."""
    hp, ph = np.divmod(np.asarray(row), P)
    wp, pw = np.divmod(np.asarray(col), P)
    return (((np.asarray(v) * (H // P) + hp) * (W // P) + wp) * P + ph) * P + pw


def local_index(d):
    """Per-Gaussian index into the pixel-aligned block (the model prepends a few non-pixel Gaussians)."""
    return d["src_idx"] - (int(d["n_total"]) - VIEWS * H * W)


def erode(mask):
    """1-pixel 4-neighbour erosion on (..., H, W) masks."""
    m = mask.copy()
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        m &= np.roll(np.roll(mask, dy, axis=-2), dx, axis=-1)
    return m


def near(mask, radius):
    """Pixels within `radius` 4-neighbour steps of `mask`."""
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            grown |= np.roll(np.roll(out, dy, axis=-2), dx, axis=-1)
        out = grown
    return out


def splat_bytes(xyz, scale, rot, opacity, rgb):
    """antimatter15 .splat rows (what the app's viewer and merge expect), most opaque first."""
    order = np.argsort(-opacity)
    rows = np.zeros(len(order), dtype=SPLAT_DTYPE)
    rows["p"], rows["s"] = xyz[order], scale[order]
    rgba = np.concatenate([rgb[order], opacity[order, None]], axis=1)
    rows["c"] = np.clip(rgba * 255, 0, 255).astype(np.uint8)
    q = rot[order] / np.maximum(np.linalg.norm(rot[order], axis=1, keepdims=True), 1e-8)
    rows["q"] = np.clip(q * 128 + 128, 0, 255).astype(np.uint8)
    return rows.tobytes()
