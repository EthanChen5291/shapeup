"""Unit tests for the prebake pipeline's pure parts (numpy only).

    cd scripts/prebake-pipeline && python -m unittest test_pipeline
"""
import json
import unittest

import numpy as np

import catalog
from extract import CLOTH, HAT, HAIR, face_strays, hair_mask, load_cameras, on_front_face
from fit import crown_z, fit_scale
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



class GhostFace(unittest.TestCase):
    """Hair-labelled Gaussians pushed onto the nose/lips are dropped; back hair and fringe stay."""

    def unproject(self, cams, row, col, depth):
        fx, fy, cx, cy = cams["K"][0]
        ray = np.array([(col + 0.5 - cx) / fx, (row + 0.5 - cy) / fy, 1.0]) * depth
        return cams["c2w"][0, :3, :3] @ ray + cams["c2w"][0, :3, 3]

    def test_ghost_inside_the_nose_goes_back_hair_and_fringe_stay(self):
        cams = load_cameras()
        labels = np.zeros((VIEWS, H, W), np.uint8)
        labels[0, 200:210, 250:260] = 4      # eyes -> eye line at row ~205
        labels[0, 280:300, 250:262] = 2      # nose (lower face)
        labels[0, 150:170, 250:262] = 1      # forehead skin (above the eye line)
        pts = {
            "nose_surface": (290, 255, 2.2),  # the face itself (not a candidate)
            "ghost": (290, 255, 2.32),        # hair-labelled, just inside the nose
            "back_hair": (290, 255, 3.0),     # behind the head, same pixel as the nose
            "forehead": (160, 255, 2.2),      # face surface above the eyes
            "fringe": (160, 256, 2.18),       # a fringe strand in front of the forehead
            "no_surface": (295, 261, 2.3),    # on a nose pixel with no face Gaussian to compare
        }
        d = {"labels": labels, "xyz": np.array([self.unproject(cams, *p) for p in pts.values()])}
        candidates = np.array([False, True, True, False, True, True])
        ghost = on_front_face(d, candidates, cams)
        self.assertEqual(dict(zip(pts, ghost.tolist())),
                         {"nose_surface": False, "ghost": True, "back_hair": False, "forehead": False, "fringe": False,
                          "no_surface": False})


class FaceStrays(unittest.TestCase):
    """Isolated clumps in front of the lower face go; connected strands and clumps elsewhere stay."""

    @staticmethod
    def block(center, n, spread=0.01, seed=0):
        return np.asarray(center) + np.random.default_rng(seed).uniform(-spread, spread, (n, 3))

    def test_ghost_nose_dropped_hanging_strand_and_back_clump_kept(self):
        g = np.stack(np.meshgrid(np.arange(-0.5, 0.5, 0.02), np.arange(-0.2, 0.6, 0.02), np.arange(0.2, 0.8, 0.02),
                                 indexing="ij"), -1).reshape(-1, 3)        # the hair mass (cap above the eye line)
        strand = np.stack([np.full(60, 0.1), np.full(60, -0.2), 0.2 - 0.015 * np.arange(60)], 1)  # hangs from the mass down the cheek, into the zone
        nose = self.block((0.0, -0.3, -0.25), 80)                           # isolated, in front of the lower face
        back = self.block((0.0, 0.5, -0.3), 80)                             # isolated but behind the head
        brow = self.block((0.0, -0.25, 0.1), 80)                            # isolated at brow level: above the zone
        xyz = np.concatenate([g, strand, nose, back, brow])
        opacity = np.full(len(xyz), 0.8)
        drop = face_strays(xyz, opacity)
        parts = np.split(drop, np.cumsum([len(g), len(strand), len(nose), len(back)]))
        self.assertFalse(parts[0].any(), "hair mass")
        self.assertFalse(parts[1].any(), "connected strand")
        self.assertTrue(parts[2].all(), "ghost nose")
        self.assertFalse(parts[3].any(), "back clump")
        self.assertFalse(parts[4].any(), "brow-level clump")

    def test_faint_gaussians_neither_bridge_nor_survive_in_the_zone(self):
        mass = self.block((0.0, -0.2, 0.3), 2000, spread=0.1)
        nose = self.block((0.0, -0.3, -0.25), 50)
        bridge = np.stack([np.zeros(30), np.full(30, -0.25), 0.2 - 0.015 * np.arange(30)], 1)  # faint chain from mass to nose
        xyz = np.concatenate([mass, nose, bridge])
        opacity = np.concatenate([np.full(2000, 0.8), np.full(50, 0.8), np.full(30, 0.02)])
        drop = face_strays(xyz, opacity)
        self.assertFalse(drop[:2000].any())
        self.assertTrue(drop[2000:2050].all(), "a faint chain must not connect the ghost to the mass")
        self.assertTrue(drop[2050:][xyz[2050:, 2] < 0.05].all(), "faint Gaussians alone in the zone go too")

    def test_residue_near_a_separate_strand_still_goes(self):
        mass = self.block((0.0, 0.3, 0.5), 3000, spread=0.3)                              # the hair
        strand = np.stack([np.full(500, 0.3), np.full(500, -0.1), 0.0 - 0.002 * np.arange(500)], 1)  # a separate loc beside the jaw
        clump = self.block((0.22, -0.1, -0.6), 60)                                        # residue 0.08 from the loc, in the zone
        xyz = np.concatenate([mass, strand, clump]); opacity = np.full(len(xyz), 0.8)
        drop = face_strays(xyz, opacity)
        self.assertFalse(drop[:3500].any())
        self.assertTrue(drop[3500:].all(), "a clump a few hundredths from a strand is not attached to it")

    def test_empty_and_no_zone_inputs(self):
        self.assertEqual(face_strays(np.zeros((0, 3)), np.zeros(0)).shape, (0,))
        xyz = self.block((0.0, 0.3, 0.5), 10)
        self.assertFalse(face_strays(xyz, np.full(10, 0.8)).any())


class CrownFit(unittest.TestCase):
    def test_crown_is_the_solid_top_not_the_sheer_halo(self):
        rng = np.random.default_rng(1)
        n = 400
        xy = rng.uniform([-0.15, -0.2], [0.15, 0.4], (n, 2))
        solid = np.column_stack([xy, rng.uniform(0.0, 0.60, n)])       # skull up to z = 0.60
        halo = np.column_stack([xy, rng.uniform(0.60, 0.75, n)])       # buzz fuzz above it
        xyz = np.concatenate([solid, halo])
        opacity = np.concatenate([np.full(n, 0.6), np.full(n, 0.02)])
        z = crown_z(xyz, opacity)
        self.assertAlmostEqual(z, 0.60, delta=0.02)
        self.assertIsNone(crown_z(xyz[:0], opacity[:0]))

    def test_manifest_carries_the_house_crowns(self):
        m = catalog.manifest()
        self.assertEqual(m["fit"]["anchorZ"], 0.0)
        self.assertEqual(set(m["fit"]["crownZ"]), {"men", "women"})
        self.assertAlmostEqual(fit_scale(0.569, m["fit"]["crownZ"]["men"]), 0.569 / 0.638, places=3)


if __name__ == "__main__":
    unittest.main()
