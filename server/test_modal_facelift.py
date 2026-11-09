"""Unit tests for the worker's pure helpers (no GPU, no network).

Run with the Python that has `modal` installed:
    cd server && python -m unittest test_modal_facelift
"""

import base64
import hashlib
import unittest

import numpy as np

from modal_facelift import (
    CANCEL_MAX_AGE_S,
    DEFAULT_IDENTITY_THRESHOLD,
    MIN_GAUSSIANS,
    CancelRegistry,
    cancel_job,
    cosine_similarity,
    identity_mode,
    identity_threshold,
    identity_verdict,
    init_sentry,
    log_event,
    record_stage_spans,
    stage_spans,
    resolve_job_id,
    result_from_meta,
    valid_reference_key,
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

    def test_carries_the_recorded_identity_score(self):
        identity = {"mode": "shadow", "status": "pass", "score": 0.81, "threshold": 0.45}
        meta = {"job_id": "job-12345678", "identity": identity,
                "output": {"splat_s3_key": "facelifts/job-12345678/output.splat"}}
        self.assertEqual(result_from_meta(meta, "job-12345678")["identity"], identity)


class IdentityConfig(unittest.TestCase):
    def test_mode_defaults_to_off(self):
        for raw in (None, "", "nonsense", "ENFORCED"):
            self.assertEqual(identity_mode(raw), "off", raw)
        self.assertEqual(identity_mode(" Shadow "), "shadow")
        self.assertEqual(identity_mode("enforce"), "enforce")

    def test_threshold_falls_back_on_bad_input(self):
        self.assertEqual(identity_threshold("0.6"), 0.6)
        for raw in (None, "", "abc", "nan", "inf", "1.5", "-2"):
            self.assertEqual(identity_threshold(raw), DEFAULT_IDENTITY_THRESHOLD, raw)


class ReferenceKey(unittest.TestCase):
    def test_accepts_only_selfie_keys(self):
        self.assertTrue(valid_reference_key("pictures/0b6f3a52-6f1e-4d5e-9a57-2b8f4c1d9e10/scan.png"))
        for bad in (None, "", "facelifts/job/output.splat", "edit-images/x.png",
                    "pictures/../users/secret.png", "pictures/short/scan.png",
                    "pictures/0b6f3a52-6f1e-4d5e-9a57-2b8f4c1d9e10/scan.exe",
                    "pictures/0b6f3a52-6f1e-4d5e-9a57-2b8f4c1d9e10/a/b.png"):
            self.assertFalse(valid_reference_key(bad), bad)


class IdentityScore(unittest.TestCase):
    def test_cosine_similarity(self):
        self.assertAlmostEqual(cosine_similarity([1, 0], [1, 0]), 1.0)
        self.assertAlmostEqual(cosine_similarity([1, 0], [0, 1]), 0.0)
        self.assertAlmostEqual(cosine_similarity([1, 0], [-1, 0]), -1.0)
        self.assertAlmostEqual(cosine_similarity([2, 0], [1, 0]), 1.0)  # scale-free

    def test_cosine_rejects_zero_or_mismatched_vectors(self):
        with self.assertRaises(ValueError):
            cosine_similarity([0, 0], [1, 0])
        with self.assertRaises(ValueError):
            cosine_similarity([1, 0, 0], [1, 0])

    def test_only_enforce_mode_blocks_drift(self):
        self.assertEqual(identity_verdict(0.8, 0.45, "enforce"), ("pass", False))
        self.assertEqual(identity_verdict(0.2, 0.45, "shadow"), ("drift", False))
        self.assertEqual(identity_verdict(0.2, 0.45, "enforce"), ("drift", True))
        self.assertEqual(identity_verdict(0.45, 0.45, "enforce"), ("pass", False))


class Cancellation(unittest.TestCase):
    def test_a_cancelled_job_stays_marked_until_it_finishes_or_is_skipped(self):
        reg = CancelRegistry()
        self.assertFalse(reg.is_cancelled("job-12345678"))
        reg.cancel("job-12345678", now=100.0)
        self.assertTrue(reg.is_cancelled("job-12345678"))
        self.assertFalse(reg.is_cancelled("job-87654321"))
        reg.forget("job-12345678")  # the job's finally block
        self.assertFalse(reg.is_cancelled("job-12345678"))
        reg.forget("job-12345678")  # idempotent for a job cancelled twice

    def test_cancels_for_jobs_this_container_never_saw_are_pruned_by_age(self):
        reg = CancelRegistry()
        reg.cancel("job-stale-0001", now=0.0)
        reg.cancel("job-fresh-0002", now=CANCEL_MAX_AGE_S + 1)
        self.assertFalse(reg.is_cancelled("job-stale-0001"))
        self.assertTrue(reg.is_cancelled("job-fresh-0002"))
        self.assertEqual(len(reg), 1)

    def test_cancel_reports_whether_the_job_is_queued_or_running_here(self):
        reg = CancelRegistry()
        inflight = {"job-12345678": object()}  # the server's _inflight futures
        self.assertEqual(cancel_job(reg, inflight, "job-12345678", now=1.0), {"queued": True})
        self.assertEqual(cancel_job(reg, inflight, "job-elsewhere-1", now=1.0), {"queued": False})
        # Both are recorded: the queued one is skipped when it reaches the GPU lock;
        # the other is honoured if its request arrives late, and pruned otherwise.
        self.assertTrue(reg.is_cancelled("job-12345678"))
        self.assertTrue(reg.is_cancelled("job-elsewhere-1"))


if __name__ == "__main__":
    unittest.main()


class StructuredLogTest(unittest.TestCase):
    def test_log_event_is_one_json_line_with_job_id_and_no_nulls(self):
        import contextlib
        import io
        import json

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            line = log_event("job.done", job_id="job_abc12345", elapsed_s=8.5, gaussians=None)
        self.assertEqual(buf.getvalue().strip(), line)
        self.assertNotIn("\n", line)
        record = json.loads(line)
        self.assertEqual(record["svc"], "worker")
        self.assertEqual(record["event"], "job.done")
        self.assertEqual(record["job_id"], "job_abc12345")
        self.assertEqual(record["elapsed_s"], 8.5)
        self.assertNotIn("gaussians", record)
        self.assertIsInstance(record["ts"], float)

    def test_log_event_leaves_level_out_of_the_line(self):
        import contextlib
        import io
        import json

        with contextlib.redirect_stdout(io.StringIO()):
            record = json.loads(log_event("job.failed", level="error", job_id="job_x", status=500))
        self.assertNotIn("level", record)
        self.assertEqual(record["status"], 500)

    def test_sentry_stays_off_without_a_dsn(self):
        self.assertFalse(init_sentry(None))
        self.assertFalse(init_sentry(""))

    def test_sentry_init_keeps_selfies_and_locals_out(self):
        import sys
        import types
        from unittest import mock

        import modal_facelift

        fake = types.ModuleType("sentry_sdk")
        fake.init = mock.Mock()
        try:
            with mock.patch.dict(sys.modules, {"sentry_sdk": fake}):
                self.assertTrue(init_sentry("https://key@example.ingest.sentry.io/1", "test"))
        finally:
            modal_facelift._SENTRY_ON = False
        kwargs = fake.init.call_args.kwargs
        self.assertIs(kwargs["include_local_variables"], False)
        self.assertEqual(kwargs["max_request_body_size"], "never")
        self.assertIs(kwargs["send_default_pii"], False)
        self.assertIs(kwargs["enable_logs"], True)
        self.assertEqual(kwargs["environment"], "test")
        self.assertEqual(kwargs["traces_sample_rate"], 1.0)


class StageSpanTest(unittest.TestCase):
    def test_stage_spans_convert_to_epoch_in_start_order_and_skip_unfinished(self):
        marks = {
            "inference": (12.0, 20.5),
            "prepare": (10.0, 10.4),
            "gpu_queue": (10.4, 12.0),
            "upload": (21.0, None),      # never finished: the build failed mid-upload
            "convert": (20.6, 20.5),     # reversed: ignored rather than drawn backwards
        }
        spans = stage_spans(marks, perf_to_epoch=1_700_000_000.0)
        self.assertEqual([s[0] for s in spans], ["prepare", "gpu_queue", "inference"])
        self.assertEqual(spans[2], ("inference", 1_700_000_012.0, 1_700_000_020.5))

    def test_record_stage_spans_is_a_no_op_without_sentry(self):
        self.assertEqual(record_stage_spans({"prepare": (1.0, 2.0)}, 0.0, "job_x"), 0)

    def test_record_stage_spans_opens_and_closes_one_span_per_stage(self):
        import sys
        import types
        from unittest import mock

        import modal_facelift

        span = mock.Mock()
        fake = types.ModuleType("sentry_sdk")
        fake.start_span = mock.Mock(return_value=span)
        modal_facelift._SENTRY_ON = True
        try:
            with mock.patch.dict(sys.modules, {"sentry_sdk": fake}):
                n = record_stage_spans({"prepare": (1.0, 2.0), "inference": (2.0, 9.0)}, 100.0, "job_y")
        finally:
            modal_facelift._SENTRY_ON = False
        self.assertEqual(n, 2)
        fake.start_span.assert_any_call(op="facelift.stage", name="inference", start_timestamp=102.0)
        span.finish.assert_any_call(end_timestamp=109.0)
        span.set_data.assert_any_call("job_id", "job_y")
