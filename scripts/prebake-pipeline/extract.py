"""Hair extraction: keep the Gaussians that came from hair pixels (house-model photos only).

Rules learned on the 2026-11 catalog run:
  - the face parser calls rounded braid/twist masses seen from behind "hat"   -> hat counts as hair
  - a skin-coloured filter removes platinum/silver hair                       -> only applied near the face
  - braid ends over the shirt / twists over the nape come back "cloth"/"neck" -> reclaimed when they touch
    hair in their view and their colour is clearly the hair's, not the shirt's or the skin's
  - Gaussians at ear edges are dropped (earrings, ear shells)
  - "ghost face": GS-LRM pushes some hair-pixel Gaussians from the angled views through
    the head onto its most protruding points (nose tip, lips). Hair-coloured, labelled
    hair, but sitting on the face: on another head they show as a second nose and mouth.
    Dropped by projecting into the front view: anything that lands on a face pixel there
    and is the front-most thing at that pixel is face, not hair (real bangs are labelled
    hair in the front view, so they stay).
  - what that still misses (face_strays, geometric, runs last and also on finished .splat
    files via clean.py): small clumps that sit inside or in front of the lower face and
    don't touch the rest of the hair. Seen on 282 of the 329 shipped prebakes as floating
    nose, lip and chin blobs. Real hair there (long strands over the cheeks, fringe ends)
    hangs from the main mass, so connectivity tells them apart; the zone stops at the eye
    line, so fringe tips over the brows are never touched.
"""
import json
from pathlib import Path

import numpy as np

from scipy import sparse
from scipy.sparse import csgraph
from scipy.spatial import cKDTree

from splat_io import erode, local_index, near, source_pixel

HAIR, HAT = 13, 14
FACE = [1, 2, 4, 5, 6, 7, 10, 11, 12]  # skin, nose, eyes, brows, mouth, lips
EAR = [8, 9, 15]                          # ears, earrings
NECK, CLOTH = 17, 18
KEYS = ("xyz", "scale", "rot", "opacity", "rgb")
CAMERAS_JSON = Path(__file__).resolve().parent / "cameras.json"  # FaceLift's 6 view cameras (fixed)
# Ghost-face blobs sit within ~0.3 of the visible face surface (inside the nose/lips) or in
# front of it; real hair on those pixels is the back of the head, > 0.5 behind (measured on
# the 2026-11 catalog: lob, layered bob, wolf cut).
GHOST_DEPTH = 0.3
LOWER_FACE = [2, 10, 11, 12]  # nose, mouth, lips; plus skin below the eye line (see on_front_face)


def load_cameras(path: Path = CAMERAS_JSON) -> dict | None:
    if not path.exists():
        return None
    cam = json.loads(path.read_text())
    return {"c2w": np.array(cam["c2w"], dtype=np.float64).reshape(6, 4, 4),
            "K": np.array(cam["fxfycxcy"], dtype=np.float64).reshape(6, 4)}


def project(xyz: np.ndarray, cameras: dict, view: int):
    """World points -> (row, col, depth) in one of the generated views (OpenCV pinhole)."""
    R, t = cameras["c2w"][view, :3, :3], cameras["c2w"][view, :3, 3]
    xc = (xyz - t) @ R
    fx, fy, cx, cy = cameras["K"][view]
    z = np.maximum(xc[:, 2], 1e-6)
    return np.floor(fy * xc[:, 1] / z + cy).astype(int), np.floor(fx * xc[:, 0] / z + cx).astype(int), xc[:, 2]


def on_front_face(d: dict, candidates: np.ndarray, cameras: dict) -> np.ndarray:
    """Candidate hair that sits inside or in front of the lower face, seen from the front view.

    Lower face only (nose, mouth, lips, skin below the eyes), so fringe strands over the
    forehead are never touched. "Inside": within GHOST_DEPTH behind the front surface formed
    by the non-candidate (face) Gaussians at that pixel.
    """
    labels0 = d["labels"][0]
    h, w = labels0.shape
    eye_rows = np.nonzero(np.isin(labels0, [4, 5]))[0]
    eye_line = eye_rows.mean() if len(eye_rows) else h * 0.45
    rows = np.arange(h)[:, None]
    lower_face = np.isin(labels0, LOWER_FACE) | ((labels0 == 1) & (rows > eye_line))
    row, col, depth = project(d["xyz"], cameras, 0)
    inside = (row >= 0) & (row < h) & (col >= 0) & (col < w)
    flat = np.where(inside, row * w + col, 0)
    face = ~candidates & inside
    zface = np.full(h * w, np.inf)
    np.minimum.at(zface, flat[face], depth[face])
    measured = np.isfinite(zface[flat])  # no face Gaussian at that pixel: nothing to compare with, keep
    return candidates & inside & lower_face.ravel()[flat] & measured & (depth < zface[flat] + GHOST_DEPTH)


def hair_mask(d: dict, cameras: dict | None = None) -> tuple[np.ndarray, dict]:
    """Boolean mask over d's Gaussians (hair to keep) and counts for the run log."""
    v, r, c = source_pixel(local_index(d))
    labels = d["labels"]
    lab = labels[v, r, c]
    hair_px = np.isin(labels, [HAIR, HAT])
    prob = d["hair_prob"][v, r, c]  # class-13 probability; hat pixels lean on the label instead
    hair = erode(hair_px)[v, r, c] & ((prob >= 0.5) | (lab == HAT))

    rgb = d["rgb"]

    def median(mask):
        return np.median(rgb[mask], axis=0) if mask.sum() else np.full(3, 0.5)

    def dist(ref):
        return np.linalg.norm(rgb - ref, axis=1)

    hair_rgb, skin_rgb = median(hair), median(np.isin(lab, FACE))
    touching = near(hair_px, 12)[v, r, c]
    reclaim_cloth = (lab == CLOTH) & touching & (dist(hair_rgb) < 0.6 * dist(median(lab == CLOTH)))
    reclaim_neck = (lab == NECK) & touching & (dist(hair_rgb) < 0.6 * dist(median(lab == NECK)))
    hair |= reclaim_cloth | reclaim_neck

    by_face = near(np.isin(labels, FACE), 6)[v, r, c]
    skin_in_hair = hair & by_face & (dist(skin_rgb) < dist(hair_rgb)) & (d["opacity"] > 0.2)
    ear_edge = hair & near(np.isin(labels, EAR), 4)[v, r, c]
    keep = hair & ~skin_in_hair & ~ear_edge
    ghost_face = on_front_face(d, keep, cameras) if cameras is not None else np.zeros_like(keep)
    keep &= ~ghost_face
    stats = {"hair": int(hair.sum()), "hat_as_hair": int((hair & (lab == HAT)).sum()),
             "reclaimed_cloth": int(reclaim_cloth.sum()), "reclaimed_neck": int(reclaim_neck.sum()),
             "skin_in_hair": int(skin_in_hair.sum()), "ear_edge": int(ear_edge.sum()),
             "ghost_face": int(ghost_face.sum()), "kept": int(keep.sum())}
    return keep, stats


# ── Face strays (geometric, no labels needed) ──────────────────────────────────
# Object space is FaceLift's: x right, y back (the face is toward -y), z up, eye line z=0.
# The zone is the lower face and the air in front of it: below the eye line, inside the
# face's width, forward of the ear line. Nothing is hair there unless it hangs from the
# rest of the hair, so an isolated clump in the zone is face residue.
STRAY_ZONE = {"z": (-0.9, 0.05), "x": 0.25, "y_max": 0.05}
STRAY_LINK = 0.03            # two visible Gaussians this close are the same piece of hair
STRAY_MIN_ALPHA = 25 / 255   # fainter Gaussians are invisible: they don't count as a connection
STRAY_SMALL = 400            # a piece with fewer visible Gaussians is a clump, never a strand
                             # (the largest residue seen: 131; a real strand runs to thousands)


def face_strays(xyz: np.ndarray, opacity: np.ndarray) -> np.ndarray:
    """Boolean mask of hair Gaussians to drop: isolated clumps in the lower-face zone.

    Visible Gaussians are grouped into pieces by exact distance (STRAY_LINK, single
    linkage); a piece with at least STRAY_SMALL Gaussians is hair. A Gaussian in the zone
    is dropped unless some hair Gaussian lies within STRAY_LINK of it. That covers faint
    Gaussians too: alone in the zone they are invisible residue, and they never bridge a
    clump to the hair because only visible ones form pieces.

    Exact distance, not a voxel grid: residue often sits 0.05-0.1 from a separate strand
    (a loc, a long front layer), and a grid with that reach counted it as attached.
    """
    xyz = np.asarray(xyz, dtype=np.float64)
    if len(xyz) == 0:
        return np.zeros(0, dtype=bool)
    zone = ((xyz[:, 2] >= STRAY_ZONE["z"][0]) & (xyz[:, 2] < STRAY_ZONE["z"][1])
            & (np.abs(xyz[:, 0]) < STRAY_ZONE["x"]) & (xyz[:, 1] < STRAY_ZONE["y_max"]))
    if not zone.any():
        return zone
    visible = np.flatnonzero(np.asarray(opacity) >= STRAY_MIN_ALPHA)
    if len(visible) == 0:
        return zone
    tree = cKDTree(xyz[visible])
    pairs = tree.query_pairs(STRAY_LINK, output_type="ndarray")
    m = len(visible)
    graph = sparse.coo_matrix((np.ones(len(pairs), dtype=np.int8), (pairs[:, 0], pairs[:, 1])), shape=(m, m))
    _, piece = csgraph.connected_components(graph, directed=False)
    hair = visible[np.bincount(piece)[piece] >= STRAY_SMALL]
    if len(hair) == 0:
        return zone
    near_hair, _ = cKDTree(xyz[hair]).query(xyz[zone], distance_upper_bound=STRAY_LINK)
    drop = zone.copy()
    drop[zone] = ~np.isfinite(near_hair)
    return drop
