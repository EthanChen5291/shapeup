"""Hair extraction: keep the Gaussians that came from hair pixels (house-model photos only).

Rules learned on the 2026-11 catalog run:
  - the face parser calls rounded braid/twist masses seen from behind "hat"   -> hat counts as hair
  - a skin-coloured filter removes platinum/silver hair                       -> only applied near the face
  - braid ends over the shirt / twists over the nape come back "cloth"/"neck" -> reclaimed when they touch
    hair in their view and their colour is clearly the hair's, not the shirt's or the skin's
  - Gaussians at ear edges are dropped (earrings, ear shells)
"""
import numpy as np

from splat_io import erode, local_index, near, source_pixel

HAIR, HAT = 13, 14
FACE = [1, 2, 4, 5, 6, 7, 10, 11, 12]  # skin, nose, eyes, brows, mouth, lips
EAR = [8, 9, 15]                          # ears, earrings
NECK, CLOTH = 17, 18
KEYS = ("xyz", "scale", "rot", "opacity", "rgb")


def hair_mask(d: dict) -> tuple[np.ndarray, dict]:
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
    stats = {"hair": int(hair.sum()), "hat_as_hair": int((hair & (lab == HAT)).sum()),
             "reclaimed_cloth": int(reclaim_cloth.sum()), "reclaimed_neck": int(reclaim_neck.sum()),
             "skin_in_hair": int(skin_in_hair.sum()), "ear_edge": int(ear_edge.sum()), "kept": int(keep.sum())}
    return keep, stats
