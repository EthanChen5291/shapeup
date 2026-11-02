"""Unit tests for the worker's pure helpers (no GPU, no network).

Run with the Python that has `modal` installed:
    cd server && python -m unittest test_modal_facelift
"""

import base64
import hashlib
import unittest

import numpy as np

from modal_facelift import (
    MIN_GAUSSIANS,
    resolve_job_id,
    result_from_meta,
    validate_splat,
)


def make_splat(n=MIN_GAUSSIANS, pos=0.5, scale=0.05):
    rows = np.zeros((n, 8), dtype="<f4")
    rows[:, 0:3] = pos
    rows[:, 3:6] = scale
    raw = bytearray(rows.tobytes())
    # rgba/quat bytes live in the last two float slots; any bytes are valid there.
    return bytes(raw)


class ResolveJobId(unittest.TestCase):
    def test_keeps_a_caller_uuid(self):
        jid = "0b6f3a52-6f1e-4d5e-9a57-2b8f4c1d9e10"
        self.assertEqual(resolve_job_id(jid), (jid, True))

    def test_replaces_missing_or_unsafe_ids(self):
        for bad in (None, "", "short", "../../etc", "a/b/c/d/e/f/g", "x" * 80, "job id with spaces"):
            jid, supplied = resolve_job_id(bad)
            self.assertFalse(supplied, bad)
            self.assertRegex(jid, r"^[0-9a-f-]{36}$")


class ValidateSplat(unittest.TestCase):
    def test_accepts_a_head_shaped_cloud_and_reports_size_and_hash(self):
        data = make_splat()
        info = validate_splat(data)
        self.assertEqual(info["gaussian_count"], MIN_GAUSSIANS)
        self.assertEqual(info["splat_bytes"], len(data))
        self.assertEqual(info["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(base64.b64decode(info["sha256_b64"]), hashlib.sha256(data).digest())

    def test_rejects_sizes_that_are_not_whole_rows(self):
        with self.assertRaisesRegex(ValueError, "multiple of 32"):
            validate_splat(make_splat()[:-5])
        with self.assertRaisesRegex(ValueError, "multiple of 32"):
            validate_splat(b"")

    def test_rejects_near_empty_output(self):
        with self.assertRaisesRegex(ValueError, "gaussians"):
            validate_splat(make_splat(n=10))

    def test_rejects_nan_and_exploded_values(self):
        with self.assertRaisesRegex(ValueError, "non-finite"):
            validate_splat(make_splat(pos=float("nan")))
        with self.assertRaisesRegex(ValueError, "position"):
            validate_splat(make_splat(pos=1e6))
        with self.assertRaisesRegex(ValueError, "scale"):
            validate_splat(make_splat(scale=-1.0))
        with self.assertRaisesRegex(ValueError, "scale"):
            validate_splat(make_splat(scale=1e3))


class ResultFromMeta(unittest.TestCase):
    def test_rebuilds_the_response_without_metering_gpu_again(self):
        meta = {"job_id": "job-12345678", "output": {
            "splat_s3_key": "facelifts/job-12345678/output.splat", "ply_s3_key": None,
            "gaussian_count": 5, "splat_bytes": 160, "sha256": "ab"}}
        res = result_from_meta(meta, "job-12345678")
        self.assertEqual(res["splat_s3_key"], "facelifts/job-12345678/output.splat")
        self.assertEqual(res["meta_s3_key"], "facelifts/job-12345678/meta.json")
        self.assertEqual(res["elapsed_s"], 0)
        self.assertTrue(res["deduped"])

    def test_ignores_meta_for_another_job_or_without_a_splat(self):
        self.assertIsNone(result_from_meta({"job_id": "other", "output": {"splat_s3_key": "k"}}, "job-12345678"))
        self.assertIsNone(result_from_meta({"job_id": "job-12345678", "output": {}}, "job-12345678"))


if __name__ == "__main__":
    unittest.main()
