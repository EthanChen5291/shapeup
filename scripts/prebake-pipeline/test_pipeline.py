"""Unit tests for the prebake pipeline's pure parts (numpy only).

    cd scripts/prebake-pipeline && python -m unittest test_pipeline
"""
import json
import unittest

import numpy as np

import catalog
from extract import CLOTH, HAT, HAIR, hair_mask
from splat_io import H, VIEWS, W, pixel_index, source_pixel, splat_bytes


class PixelBookkeeping(unittest.TestCase):
    def test_round_trip(self):
        rng = np.random.default_rng(0)
        v, r, c = rng.integers(0, VIEWS, 500), rng.integers(0, H, 500), rng.integers(0, W, 500)
        self.assertTrue(all(np.array_equal(a, b) for a, b in zip(source_pixel(pixel_index(v, r, c)), (v, r, c))))

    def test_gs_lrm_patch_order(self):
        # (views, 64 patch rows, 64 patch cols, 8, 8): the 9th index is the next row inside patch (0, 0).
        self.assertEqual(tuple(int(x) for x in source_pixel(np.array(8))), (0, 1, 0))
        self.assertEqual(tuple(int(x) for x in source_pixel(np.array(64))), (0, 0, 8))
        self.assertEqual(tuple(int(x) for x in source_pixel(np.array(H * W))), (1, 0, 0))


class SplatFormat(unittest.TestCase):
    def test_rows_are_32_bytes_most_opaque_first(self):
        xyz = np.array([[0, 0, 0], [1, 2, 3]], np.float32)
        raw = splat_bytes(xyz, np.full((2, 3), 0.01, np.float32), np.array([[2, 0, 0, 0], [1, 0, 0, 0]], np.float32),
                          np.array([0.2, 0.9], np.float32), np.array([[1, 0, 0], [0, 1, 0]], np.float32))
        self.assertEqual(len(raw), 64)
        rows = np.frombuffer(raw, dtype=[("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("q", "u1", 4)])
        self.assertEqual(rows["p"][0].tolist(), [1, 2, 3])          # opacity 0.9 sorted first
        self.assertEqual(rows["c"][0].tolist(), [0, 255, 0, 229])
        self.assertEqual(rows["q"][1].tolist(), [255, 128, 128, 128])  # normalised (1,0,0,0) -> 255,128,...


class Catalog(unittest.TestCase):
    def test_counts_and_names(self):
        catalog.check()

    def test_manifest_is_current(self):
        on_disk = json.loads(catalog.MANIFEST.read_text())
        self.assertEqual(on_disk, json.loads(json.dumps(catalog.manifest())), "run `python catalog.py`")

    def test_ids_are_unique_and_prefixed(self):
        m = catalog.manifest()
        for gender, sections in m["genders"].items():
            ids = [c["id"] for s in sections for c in s["cuts"]]
            self.assertEqual(len(ids), 25)
            self.assertEqual(len(set(ids)), 25)
            self.assertTrue(all(i.startswith("m-" if gender == "men" else "f-") for i in ids))

    def test_files_never_collide_with_legacy_names(self):
        self.assertEqual(catalog.file_stem("middlepart", "lightbrown"), "middlepart-lightbrown")


def synthetic_head(labels, rgb_by_pixel, opacity=0.8):
    """One Gaussian per labelled pixel of view 0, coloured per pixel."""
    vv, rr, cc = np.nonzero(np.ones_like(labels, bool))
    keep = np.ones(len(vv), bool)
    keep &= vv == 0
    vv, rr, cc = vv[keep], rr[keep], cc[keep]
    n = len(vv)
    return {
        "src_idx": pixel_index(vv, rr, cc) + 2, "n_total": np.array(VIEWS * H * W + 2),
        "labels": labels, "hair_prob": (labels == HAIR).astype(np.float16),
        "rgb": rgb_by_pixel[vv, rr, cc], "opacity": np.full(n, opacity, np.float32),
        "xyz": np.zeros((n, 3), np.float32),
    }, (vv, rr, cc)


class Extraction(unittest.TestCase):
    def setUp(self):
        self.labels = np.zeros((VIEWS, H, W), np.uint8)
        self.rgb = np.full((VIEWS, H, W, 3), 0.95, np.float32)  # white shirt / background
        self.labels[0, 100:200, 100:200] = HAIR
        self.rgb[0, 100:200, 100:200] = (0.2, 0.15, 0.1)          # dark hair
        self.labels[0, 100:200, 200:260] = HAT                     # braid mass the parser called "hat"
        self.rgb[0, 100:200, 200:260] = (0.2, 0.15, 0.1)
        self.labels[0, 200:206, 100:200] = CLOTH                   # braid ends over the shirt (touch hair)
        self.rgb[0, 200:206, 100:200] = (0.2, 0.15, 0.1)
        self.labels[0, 300:320, 100:200] = CLOTH                   # real shirt, far from hair
        self.rgb[0, 300:320, 100:200] = (0.95, 0.95, 0.95)

    def test_hat_and_touching_hair_coloured_cloth_count_as_hair(self):
        d, (v, r, c) = synthetic_head(self.labels, self.rgb)
        keep, st = hair_mask(d)
        at = lambda row, col: keep[(r == row) & (c == col)][0]  # noqa: E731
        self.assertTrue(at(150, 150))   # hair
        self.assertTrue(at(150, 230))   # hat -> hair
        self.assertTrue(at(203, 150))   # hair-coloured cloth touching hair -> reclaimed
        self.assertFalse(at(310, 150))  # real shirt stays out
        self.assertGreater(st["hat_as_hair"], 0)
        self.assertGreater(st["reclaimed_cloth"], 0)

    def test_light_hair_away_from_the_face_survives(self):
        self.rgb[0, 100:200, 100:260] = (0.9, 0.86, 0.8)  # platinum, skin-like
        self.labels[0, 400:420, 100:200] = 1               # face skin far from the hair
        self.rgb[0, 400:420, 100:200] = (0.88, 0.8, 0.72)
        d, (v, r, c) = synthetic_head(self.labels, self.rgb)
        keep, st = hair_mask(d)
        self.assertEqual(st["skin_in_hair"], 0)
        self.assertTrue(keep[(r == 150) & (c == 150)][0])


if __name__ == "__main__":
    unittest.main()
