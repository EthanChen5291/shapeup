"""
Primary GPU worker deployment for head reconstruction (auto-scaling, always on).

See the platform CLI's own docs for setup, dev/prod deploy commands, and team
invites — not duplicated here. After deploying, copy the printed web-endpoint
URL into FACELIFT_URL in .env.local.

Memory snapshot
---------------
On first deploy the container downloads the model weights into the Volume and
the platform snapshots CPU RAM + GPU VRAM. Subsequent cold starts restore from
the snapshot in ~10–15 s. The snapshot materialises after ~3–5 cold boots.

Weights location
----------------
The reconstruction model's inference.py downloads its weights to
{FACELIFT_DIR}/checkpoints/. We mount the weights Volume there so downloads
survive across deploys.

Synchronous design
------------------
POST /process_image accepts a multipart image, runs reconstruction inference
(~15–20 s on L40S), validates and uploads the .splat (+ meta.json) to S3 under
facelifts/<job_id>/, and returns the keys. job_id comes from the caller, so a
repeated request for the same job returns the finished result instead of
running the GPU again. An asyncio.Lock serialises GPU access within a
container; the platform auto-scales to additional containers for concurrent users.

Identity check
--------------
For a hair edit the caller also sends reference_s3_key (the user's original
selfie). Before reconstruction, the worker compares face embeddings of the
selfie and the edited image (FaceNet, ~30-80 ms warm) and records the cosine
similarity in meta.json. IDENTITY_CHECK_MODE picks what happens next:
  off (default)  skip the check entirely
  shadow         measure and record only, never block
  enforce        refuse with 422 {code: identity_drift} below
                 IDENTITY_MIN_SIMILARITY, before any GPU reconstruction runs
Embeddings live only in memory for the request; only the score is stored.
Both variables live in the shapeup-identity-check secret; redeploy after changing it.
The route only sends a reference for users who accepted the biometric notice
version that discloses this check (convex/lib/biometricConsent.ts).

Cancellation
------------
POST /cancel/{job_id} (same shared secret) marks a job as cancelled and answers
{"queued": bool} — true when this container has the job waiting or running. A
cancelled job that is still waiting for the GPU lock is skipped with
409 {"detail": {"code": "cancelled"}} and never touches the GPU. A job already
inside process_single_image runs to completion: inference.py calls the diffusion
pipeline with fixed arguments (no step callback), so there is no hook to stop it.
The route cancels when it gives up on a build (its upstream time budget) and
when a newer build for the same project supersedes a running one.
"""

import modal

IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

APP_NAME     = "shapeup-facelift"
FACELIFT_DIR = "/facelift"
WEIGHTS_DIR  = f"{FACELIFT_DIR}/checkpoints"   # Volume mounted here so weights persist

weights_volume = modal.Volume.from_name("facelift-weights", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install([
        "git", "wget", "ffmpeg",
        "libgl1-mesa-glx", "libglib2.0-0",
        "libsm6", "libxext6", "libxrender-dev",
        "build-essential", "cmake", "ninja-build", "clang",
    ])
    .pip_install("packaging==24.2", "typing-extensions==4.14.0")
    .pip_install(
        "torch==2.4.0",
        "torchvision==0.19.0",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "transformers==4.44.2",
        "diffusers[torch]==0.30.3",
        "huggingface-hub==0.35.3",
        "xformers==0.0.27.post2",
        "accelerate==0.33.0",
        "Pillow==10.4.0",
        "opencv-python==4.10.0.84",
        "scikit-image==0.21.0",
        "lpips==0.1.4",
        "rembg",
        "onnxruntime",          # required by rembg
        "numpy==1.26.4",
        "matplotlib==3.7.5",
        "scikit-learn==1.3.2",
        "einops==0.8.0",
        "jaxtyping==0.2.19",
        "pytorch-msssim==1.0.0",
        "easydict==1.13",
        "pyyaml==6.0.2",
        "wandb==0.19.1",
        "termcolor==2.4.0",
        "plyfile==1.0.3",
        "tqdm",
        "rich",
        "videoio==0.3.0",
        "ffmpeg-python==0.2.0",
        "fastapi",
        "uvicorn[standard]",
        "python-multipart",
        "boto3",                # upload PLY/splat straight to S3 from the GPU container
    )
    .run_commands(
        "pip install facenet-pytorch --no-deps",
        "pip install ninja wheel",
        # Clone the reconstruction model with its diff-gaussian-rasterization submodule.
        # Functional dependency — this container build step must reference the
        # real source repo, so the URL below isn't genericized like the prose
        # elsewhere in this file.
        f"git clone --recurse-submodules https://github.com/brubru6707/facelift {FACELIFT_DIR}",
        # Build CUDA extension from the bundled submodule (matches the secondary worker's build)
        # Targets: A100 (8.0), A10G (8.6), L40S (8.9)
        f"TORCH_CUDA_ARCH_LIST='8.0;8.6;8.9' pip install --no-build-isolation {FACELIFT_DIR}/diff-gaussian-rasterization",
    )
    .env({
        "FACELIFT_DIR":       FACELIFT_DIR,
        "HF_HOME":            WEIGHTS_DIR,
        "HF_HUB_CACHE":       WEIGHTS_DIR,
        "TRANSFORMERS_CACHE": WEIGHTS_DIR,
    })
    # Bake the identity-check embedding weights (FaceNet, VGGFace2) into the
    # image so containers never download them at start. Last layer, so adding
    # it doesn't rebuild the CUDA extension above.
    .run_commands(
        "python -c \"from facenet_pytorch import InceptionResnetV1; "
        "InceptionResnetV1(pretrained='vggface2')\"",
    )
    # Error reporting (inert unless SENTRY_DSN is set). Its own last layer so
    # adding it doesn't rebuild anything above.
    .pip_install("sentry-sdk[fastapi]>=2,<3")
)

app = modal.App(APP_NAME, image=image)


def ply_to_splat(ply_bytes: bytes) -> bytes:
    """Convert a Gaussian-splat PLY (binary little-endian float props) into the
    32-byte-per-splat .splat the web viewer expects.

    Byte-identical to the TypeScript plyToSplat() that previously ran in the
    Next.js route: per splat = [pos xyz f32][scale=exp(s) xyz f32][rgba u8]
    [quat normalized*128+128 u8], sorted by alpha (sigmoid(opacity)) descending.
    """
    import re

    import numpy as np

    SH_C0 = 0.28209479177387814
    end = b"end_header\n"
    header_end = ply_bytes.find(end)
    if header_end == -1:
        raise ValueError("Invalid PLY: no end_header")
    data_offset = header_end + len(end)
    header = ply_bytes[:header_end].decode("ascii", "replace")

    vmatch = re.search(r"element vertex (\d+)", header)
    if not vmatch:
        raise ValueError("No vertex count in PLY")
    vcount = int(vmatch.group(1))

    ply_type_to_np = {
        "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
        "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
        "short": "<i2", "int16": "<i2", "ushort": "<u2", "uint16": "<u2",
        "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
    }
    props = re.findall(r"^property (\S+) (\S+)$", header, re.MULTILINE)
    if not props:
        raise ValueError("No properties in PLY")
    dtype = np.dtype([(name, ply_type_to_np.get(t, "<f4")) for t, name in props])
    data = np.frombuffer(ply_bytes, dtype=dtype, count=vcount, offset=data_offset)

    # Compute in float64 like JS, but round-trip through float32 at each store
    # point (JS held these in Float32Arrays). This makes the output byte-for-byte
    # identical to the old TypeScript plyToSplat() — verified against it.
    def col(name: str) -> "np.ndarray":
        return data[name].astype(np.float64)

    def f32(v: "np.ndarray") -> "np.ndarray":
        return v.astype(np.float32).astype(np.float64)

    x, y, z = col("x"), col("y"), col("z")
    r = f32(np.clip(0.5 + SH_C0 * col("f_dc_0"), 0.0, 1.0))
    g = f32(np.clip(0.5 + SH_C0 * col("f_dc_1"), 0.0, 1.0))
    b = f32(np.clip(0.5 + SH_C0 * col("f_dc_2"), 0.0, 1.0))
    a = f32(1.0 / (1.0 + np.exp(-col("opacity"))))
    sx = f32(np.exp(col("scale_0")))
    sy = f32(np.exp(col("scale_1")))
    sz = f32(np.exp(col("scale_2")))

    quat = np.stack([col("rot_0"), col("rot_1"), col("rot_2"), col("rot_3")], axis=0)
    qlen = np.maximum(1e-8, np.sqrt((quat * quat).sum(axis=0)))
    quat = f32(quat / qlen)

    # Stable sort by (float32) alpha desc — matches JS Array.sort tie behaviour.
    order = np.argsort(-a, kind="stable")

    def u8(v: "np.ndarray") -> "np.ndarray":
        # JS Math.round == floor(x + 0.5); exact for the non-negative values here.
        return np.clip(np.floor(v + 0.5), 0, 255).astype(np.uint8)

    out_dt = np.dtype([
        ("pos", "<f4", 3),
        ("scale", "<f4", 3),
        ("rgba", "u1", 4),
        ("quat", "u1", 4),
    ])  # 32 bytes
    out = np.empty(vcount, out_dt)
    out["pos"][:, 0], out["pos"][:, 1], out["pos"][:, 2] = x[order], y[order], z[order]
    out["scale"][:, 0], out["scale"][:, 1], out["scale"][:, 2] = sx[order], sy[order], sz[order]
    out["rgba"][:, 0] = u8(r[order] * 255)
    out["rgba"][:, 1] = u8(g[order] * 255)
    out["rgba"][:, 2] = u8(b[order] * 255)
    out["rgba"][:, 3] = u8(a[order] * 255)
    out["quat"][:, 0] = u8(quat[0][order] * 128 + 128)
    out["quat"][:, 1] = u8(quat[1][order] * 128 + 128)
    out["quat"][:, 2] = u8(quat[2][order] * 128 + 128)
    out["quat"][:, 3] = u8(quat[3][order] * 128 + 128)
    return out.tobytes()


# ── Structured logs ──────────────────────────────────────────────────────────
# One JSON object per line, always carrying job_id, so Modal's logs can be
# searched and joined with the Vercel and Convex lines for the same build.

_SENTRY_ON = False


def log_event(event: str, level: str = "info", **fields) -> str:
    """Print and return one JSON log line: {"svc": "worker", "event": ..., **fields}. None values are dropped.

    With Sentry on, the same event also goes to Sentry Logs (level: info | warning | error),
    so Vercel's and the worker's lines for one job_id are searchable in one place.
    """
    import json
    import time

    clean = {k: v for k, v in fields.items() if v is not None}
    line = json.dumps(
        {"svc": "worker", "event": event, "ts": round(time.time(), 3), **clean},
        separators=(",", ":"), default=str,
    )
    print(line, flush=True)
    if _SENTRY_ON:
        import sentry_sdk

        emit = {"warning": sentry_sdk.logger.warning, "error": sentry_sdk.logger.error}.get(level, sentry_sdk.logger.info)
        emit(event, attributes={"svc": "worker", **{k: v if isinstance(v, (str, int, float, bool)) else str(v) for k, v in clean.items()}})
    return line


def init_sentry(dsn: "str | None", environment: "str | None" = None) -> bool:
    """Start error reporting when a DSN is configured; a no-op (False) otherwise."""
    if not dsn:
        return False
    import sentry_sdk

    global _SENTRY_ON
    sentry_sdk.init(
        dsn=dsn,
        environment=environment or "production",
        traces_sample_rate=0,      # errors only; no performance tracing yet
        send_default_pii=False,          # no IPs, cookies or user data
        max_request_body_size="never",   # never attach request bodies: they are selfies
        enable_logs=True,                # log_event lines go to Sentry Logs too
        # Off: the SDK would attach frame locals to errors (raw selfie bytes, the
        # shared_secret variable); its scrubber only matches exact key names.
        include_local_variables=False,
    )
    _SENTRY_ON = True
    return True


# ── Job ids ──────────────────────────────────────────────────────────────────
# The Next.js route mints one id per build (credit hold, project build, Convex
# facelift row) and sends it as job_id, so the S3 folder carries the same id.
# Anything that isn't a plain id gets a fresh UUID instead (it lands in an S3 key).
JOB_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9-]{7,63}$"


def resolve_job_id(requested: "str | None") -> "tuple[str, bool]":
    """(job_id, caller_supplied). Invalid or missing ids get a new UUID."""
    import re
    import uuid

    if requested and re.match(JOB_ID_PATTERN, requested):
        return requested, True
    return str(uuid.uuid4()), False


# ── Splat validation ─────────────────────────────────────────────────────────
# A .splat row is pos f32×3 | scale f32×3 | rgba u8×4 | quat u8×4 = 32 bytes.
# FaceLift heads sit within about ±1.2 of the origin with Gaussian scales under
# 0.2; the bounds below are ~10× that, so they only catch broken output (NaNs,
# exploded values, an empty or truncated cloud), never a real head.
SPLAT_ROW_BYTES = 32
MIN_GAUSSIANS = 1_000
MAX_ABS_POSITION = 10.0
MAX_SCALE = 10.0


def validate_splat(splat_bytes: bytes) -> dict:
    """Raise ValueError if the splat is malformed; else return its size facts."""
    import base64
    import hashlib

    import numpy as np

    size = len(splat_bytes)
    if size == 0 or size % SPLAT_ROW_BYTES != 0:
        raise ValueError(f"splat size {size} is not a positive multiple of {SPLAT_ROW_BYTES}")
    count = size // SPLAT_ROW_BYTES
    if count < MIN_GAUSSIANS:
        raise ValueError(f"only {count} gaussians (minimum {MIN_GAUSSIANS})")
    rows = np.frombuffer(splat_bytes, dtype="<f4").reshape(count, 8)
    pos, scale = rows[:, 0:3], rows[:, 3:6]
    if not np.isfinite(pos).all() or not np.isfinite(scale).all():
        raise ValueError("non-finite position or scale")
    if np.abs(pos).max() > MAX_ABS_POSITION:
        raise ValueError(f"position out of range (max |p| = {float(np.abs(pos).max()):.3g})")
    if scale.min() < 0 or scale.max() > MAX_SCALE:
        raise ValueError(f"scale out of range ({float(scale.min()):.3g}..{float(scale.max()):.3g})")
    digest = hashlib.sha256(splat_bytes)
    return {
        "gaussian_count": count,
        "splat_bytes": size,
        "sha256": digest.hexdigest(),
        # S3 recomputes this on upload and rejects the PUT if the bytes differ.
        "sha256_b64": base64.b64encode(digest.digest()).decode(),
    }


# ── Identity check ───────────────────────────────────────────────────────────
# Compares the original selfie with the edited image so an edit that changed the
# person is caught before a GPU build. A quality check, not a security control,
# so every failure to measure (no reference, no face, S3 error) passes.
IDENTITY_MODES = ("off", "shadow", "enforce")
# Lenient on purpose: flag only clearly different faces. Calibrated 2026-11-02 on one
# dev selfie: 10 real haircut edits (production prompt) scored 0.77-0.99 (bald lowest);
# different people 0.27-0.54; a 20-years-older face 0.39; subtle face changes
# (younger, beard + glasses) 0.66-0.72 pass. Confirm with shadow data before enforcing.
DEFAULT_IDENTITY_THRESHOLD = 0.60
# save-scan writes selfies as pictures/<uuid>/scan.<ext>; nothing else is fetched.
REFERENCE_KEY_PATTERN = r"^pictures/[A-Za-z0-9-]{8,64}/[A-Za-z0-9_-]{1,64}\.(png|jpe?g|webp)$"


def identity_mode(raw: "str | None") -> str:
    mode = (raw or "").strip().lower()
    return mode if mode in IDENTITY_MODES else "off"


def identity_threshold(raw: "str | None") -> float:
    import math

    try:
        value = float(raw) if raw is not None else DEFAULT_IDENTITY_THRESHOLD
    except ValueError:
        return DEFAULT_IDENTITY_THRESHOLD
    return value if math.isfinite(value) and -1.0 <= value <= 1.0 else DEFAULT_IDENTITY_THRESHOLD


def valid_reference_key(key: "str | None") -> bool:
    import re

    return bool(key) and re.match(REFERENCE_KEY_PATTERN, key) is not None


def cosine_similarity(a, b) -> float:
    import numpy as np

    a = np.asarray(a, dtype=np.float64).ravel()
    b = np.asarray(b, dtype=np.float64).ravel()
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    if a.shape != b.shape or norm == 0.0:
        raise ValueError("embeddings must be non-zero vectors of the same length")
    return float(np.dot(a, b) / norm)


def identity_verdict(score: float, threshold: float, mode: str) -> "tuple[str, bool]":
    """(status, block). Only enforce mode ever blocks."""
    status = "pass" if score >= threshold else "drift"
    return status, mode == "enforce" and status == "drift"


def load_identity_models(device):
    """Face detector + FaceNet embedder (weights baked into the image)."""
    from facenet_pytorch import MTCNN, InceptionResnetV1

    detector = MTCNN(image_size=160, margin=14, select_largest=True, post_process=True, device=device)
    embedder = InceptionResnetV1(pretrained="vggface2").eval().to(device)
    return detector, embedder


def face_embedding(detector, embedder, image, device):
    """512-d L2-normalised embedding of the largest face, or None if no face."""
    import torch

    with torch.no_grad():
        face = detector(image.convert("RGB"))
        if face is None:
            return None
        return embedder(face.unsqueeze(0).to(device))[0].cpu().numpy()


def result_from_meta(meta: dict, job_id: str) -> "dict | None":
    """The /process_image response for a job that already finished (from its meta.json)."""
    out = meta.get("output") or {}
    splat_key = out.get("splat_s3_key")
    if meta.get("job_id") != job_id or not splat_key:
        return None
    return {
        "job_id": job_id,
        "ply_s3_key": out.get("ply_s3_key"),
        "splat_s3_key": splat_key,
        "meta_s3_key": f"facelifts/{job_id}/meta.json",
        "gaussian_count": out.get("gaussian_count"),
        "splat_bytes": out.get("splat_bytes"),
        "splat_sha256": out.get("sha256"),
        "identity": meta.get("identity"),
        # No GPU ran for this request; don't meter it again.
        "elapsed_s": 0,
        "queue_wait_s": 0,
        "convert_s": 0,
        "upload_s": 0,
        "total_s": 0,
        "deduped": True,
    }


# ── Cancellation ─────────────────────────────────────────────────────────────
# See the module docstring. Only the wait for the GPU lock is interruptible; the
# check happens right after the lock is acquired, before any GPU work.
CANCEL_MAX_AGE_S = 900.0  # == the container timeout: no job outlives this


class CancelRegistry:
    """Job ids a caller asked us to drop, keyed to when they asked.

    A cancel can reach a container that never sees that job (there are up to two,
    and the caller does not know which took it), so entries are pruned by age
    rather than relying on the job itself to clear them.
    """

    def __init__(self) -> None:
        self._requested: "dict[str, float]" = {}

    def cancel(self, job_id: str, now: float) -> None:
        self.prune(now)
        self._requested[job_id] = now

    def is_cancelled(self, job_id: str) -> bool:
        return job_id in self._requested

    def forget(self, job_id: str) -> None:
        self._requested.pop(job_id, None)

    def prune(self, now: float, max_age_s: float = CANCEL_MAX_AGE_S) -> None:
        for job_id in [j for j, at in self._requested.items() if now - at > max_age_s]:
            del self._requested[job_id]

    def __len__(self) -> int:
        return len(self._requested)


def cancel_job(registry: CancelRegistry, inflight, job_id: str, now: float) -> dict:
    """Record a cancel. `queued` says whether this container has the job waiting or running."""
    registry.cancel(job_id, now)
    return {"queued": job_id in inflight}


@app.cls(
    # Preference order. L40S alone left requests queued indefinitely during an
    # L40S capacity shortage ("waiting to be scheduled on a GPU_L40S worker");
    # the fallbacks all have >=48 GB VRAM, so the same snapshot-loaded models fit.
    gpu=["L40S", "A100-80GB", "H100"],
    # Kept just long enough that a container warmed in parallel with the image
    # model (the /warmup route, fired when an edit starts) survives the ~8-12s
    # image generation and is still up when the real /process_image lands a moment
    # later. Cold start is ~6-8s, so warming at t=0 → warm by t≈8 → this 10s idle
    # window holds it to t≈18, past the t≈10-15 facelift arrival. Bump higher
    # only once requests start clustering enough to justify more idle GPU spend.
    scaledown_window=10,
    # Hard cap on concurrent GPUs — bounds peak demo spend regardless of load.
    # The app-side monthly GPU-seconds guard (convex/gpuUsage.ts) bounds total.
    max_containers=2,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    volumes={WEIGHTS_DIR: weights_volume},
    # AWS creds + bucket for uploading results straight to S3 from the container.
    # Secret must contain AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION /
    # AWS_S3_BUCKET_NAME (create with `modal secret create shapeup-aws-s3 ...`).
    # Identity check settings: IDENTITY_CHECK_MODE / IDENTITY_MIN_SIMILARITY (see top
    # of file). Change with `modal secret create shapeup-identity-check ... --force`.
    secrets=[modal.Secret.from_name("shapeup-aws-s3"),
             modal.Secret.from_name("shapeup-identity-check"),
             modal.Secret.from_name("shapeup-sentry")],  # SENTRY_DSN / SENTRY_ENVIRONMENT
    timeout=900,
)
class FaceLiftServer:
    @modal.enter(snap=True)
    def load_models(self) -> None:
        import sys
        import torch
        sys.path.insert(0, FACELIFT_DIR)
        from inference import (
            get_model_paths,
            initialize_face_detector,
            initialize_mvdiffusion_pipeline,
            initialize_gslrm_model,
            setup_camera_parameters,
        )
        self.device = torch.device("cuda:0")

        # get_model_paths() downloads HF weights into FACELIFT_DIR/checkpoints/
        # on first run; subsequent runs find them already on the Volume.
        mvdiffusion_path, gslrm_ckpt_path, gslrm_cfg_path = get_model_paths()

        self.face_detector = initialize_face_detector(self.device)
        self.mv_pipeline, self.generator, self.color_prompt_embeddings = (
            initialize_mvdiffusion_pipeline(mvdiffusion_path, self.device)
        )
        self.gslrm_model = initialize_gslrm_model(gslrm_ckpt_path, gslrm_cfg_path, self.device)
        self.camera_intrinsics, self.camera_extrinsics = setup_camera_parameters(self.device)
        self.generator.manual_seed(4)
        self.seed = 4
        # Provenance for the sidecar meta.json: which FaceLift commit and GPU made each head.
        try:
            import subprocess
            self.model_commit = subprocess.check_output(
                ["git", "-C", FACELIFT_DIR, "rev-parse", "--short", "HEAD"], text=True
            ).strip()
        except Exception:
            self.model_commit = "unknown"
        self.gpu_name = torch.cuda.get_device_name(0)
        # Identity check models. Optional: if they fail to load, the check reports
        # "unavailable" and builds carry on.
        try:
            self.id_detector, self.id_embedder = load_identity_models(self.device)
        except Exception as exc:
            self.id_detector = self.id_embedder = None
            print(f"[facelift] identity models unavailable ({exc}); check disabled", flush=True)
        vram_gb = torch.cuda.memory_allocated(self.device) / 1024**3
        print(
            f"[facelift] Models on GPU (VRAM allocated {vram_gb:.2f} GB) — snapshotting.",
            flush=True,
        )

    @modal.asgi_app()
    def serve(self):
        import asyncio
        import os
        import shutil
        import sys
        import time
        from io import BytesIO

        from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
        from PIL import Image, UnidentifiedImageError

        sys.path.insert(0, FACELIFT_DIR)
        from inference import process_single_image

        import boto3

        # Errors with a 5xx are reported to Sentry, tagged with the job id below.
        sentry_on = init_sentry(os.environ.get("SENTRY_DSN"), os.environ.get("SENTRY_ENVIRONMENT"))

        api   = FastAPI()
        _lock = asyncio.Lock()
        # Jobs running in this container, so a repeated request for the same
        # job_id waits on the first one instead of starting a second GPU run.
        _inflight: dict = {}
        # Jobs the route asked us to drop (see CancelRegistry); _cancel_lock guards it.
        _cancelled = CancelRegistry()
        _cancel_lock = asyncio.Lock()
        shared_secret = os.environ.get("FACELIFT_SHARED_SECRET")
        max_image_bytes = 6 * 1024 * 1024
        max_pixels = 12_000_000
        s3 = boto3.client("s3")  # creds + region come from the attached AWS secret
        bucket = os.environ["AWS_S3_BUCKET_NAME"]
        id_mode = identity_mode(os.environ.get("IDENTITY_CHECK_MODE"))
        id_threshold = identity_threshold(os.environ.get("IDENTITY_MIN_SIMILARITY"))

        def _identity_score(edited: bytes, reference: bytes) -> "float | None":
            a = face_embedding(self.id_detector, self.id_embedder, Image.open(BytesIO(edited)), self.device)
            b = face_embedding(self.id_detector, self.id_embedder, Image.open(BytesIO(reference)), self.device)
            return None if a is None or b is None else cosine_similarity(a, b)

        @api.post("/warmup")
        async def warmup(
            x_shapeup_facelift_secret: str | None = Header(default=None),
        ):
            # Cheap container wake. Hitting any route spins up a container and
            # runs @modal.enter(snap=True) (the ~6-8s snapshot restore), so by
            # the time we return, the GPU is loaded and ready for the real
            # /process_image that follows once the image model finishes. Does NO
            # inference and touches no GPU, but it does cost a cold start, so it
            # carries the same shared-secret gate as /process_image — a wake is
            # a (small) spend lever and must not be anonymous.
            if shared_secret and x_shapeup_facelift_secret != shared_secret:
                print("[facelift] warmup 401 — bad or missing shared secret", flush=True)
                raise HTTPException(401, "Unauthorized")
            print("[facelift] warmup — container ready", flush=True)
            return {"ok": True}

        @api.post("/cancel/{job_id}")
        async def cancel(
            job_id: str,
            x_shapeup_facelift_secret: str | None = Header(default=None),
        ):
            # Drop a job before it reaches the GPU (a retry superseded it, or the
            # route stopped waiting). Same gate as /process_image: cancelling
            # someone else's build must not be anonymous either.
            if shared_secret and x_shapeup_facelift_secret != shared_secret:
                print("[facelift] cancel 401 — bad or missing shared secret", flush=True)
                raise HTTPException(401, "Unauthorized")
            job_id, supplied = resolve_job_id(job_id)
            if not supplied:
                return {"queued": False}
            async with _cancel_lock:
                result = cancel_job(_cancelled, _inflight, job_id, time.monotonic())
            print(f"[facelift] {job_id} cancel requested — queued={result['queued']}", flush=True)
            return result

        def _finished_result(job_id: str):
            """The stored result if this job already completed (its meta.json exists), else None."""
            import json
            try:
                obj = s3.get_object(Bucket=bucket, Key=f"facelifts/{job_id}/meta.json")
            except s3.exceptions.NoSuchKey:
                return None
            except Exception as exc:  # can't tell; build rather than fail the request
                print(f"[facelift] {job_id} dedupe lookup failed ({exc}); building", flush=True)
                return None
            try:
                return result_from_meta(json.loads(obj["Body"].read()), job_id)
            except Exception:
                return None

        @api.post("/process_image")
        async def process_image(
            image: UploadFile = File(...),
            # The web viewer only consumes the .splat. The raw ~40 MB .ply is
            # uploaded to S3 only when the caller asks for it (need_ply=true),
            # e.g. the hair-subtraction flow that diffs two Gaussian clouds.
            # Skipping it removes the dominant chunk of the S3 upload time.
            need_ply: bool = Form(default=False),
            # The caller's build id (see resolve_job_id). Repeats are deduped.
            job_id: str | None = Form(default=None),
            # Edits only: the user's original selfie, for the identity check.
            reference_s3_key: str | None = Form(default=None),
            x_shapeup_facelift_secret: str | None = Header(default=None),
        ):
            if shared_secret and x_shapeup_facelift_secret != shared_secret:
                print("[facelift] 401 — bad or missing shared secret", flush=True)
                raise HTTPException(401, "Unauthorized")

            job_id, supplied = resolve_job_id(job_id)
            if supplied:
                running = _inflight.get(job_id)
                if running is not None:
                    print(f"[facelift] {job_id} duplicate — joining the running job", flush=True)
                    return await asyncio.shield(running)
                loop = asyncio.get_event_loop()
                done = await loop.run_in_executor(None, _finished_result, job_id)
                if done is not None:
                    print(f"[facelift] {job_id} duplicate — already built, returning it", flush=True)
                    return done

            future = asyncio.get_event_loop().create_future()
            _inflight[job_id] = future
            if sentry_on:
                import sentry_sdk
                sentry_sdk.set_tag("job_id", job_id)
            started = time.perf_counter()
            log_event("job.started", job_id=job_id, need_ply=need_ply, edit=bool(reference_s3_key))
            try:
                result = await _build(image, need_ply, job_id, reference_s3_key)
                future.set_result(result)
                facts = result if isinstance(result, dict) else {}
                log_event("job.done", job_id=job_id, elapsed_s=round(time.perf_counter() - started, 2),
                          gaussians=facts.get("gaussian_count"), splat_bytes=facts.get("splat_bytes"))
                return result
            except asyncio.CancelledError:
                future.cancel()
                log_event("job.cancelled", level="warning", job_id=job_id, elapsed_s=round(time.perf_counter() - started, 2))
                raise
            except Exception as exc:
                future.set_exception(exc)
                future.exception()  # mark retrieved so an unjoined failure isn't logged as lost
                status = getattr(exc, "status_code", None)
                log_event("job.failed", level="error", job_id=job_id, elapsed_s=round(time.perf_counter() - started, 2),
                          status=status, error=str(getattr(exc, "detail", exc))[:300])
                raise
            finally:
                _inflight.pop(job_id, None)
                async with _cancel_lock:
                    _cancelled.forget(job_id)

        async def _build(image: UploadFile, need_ply: bool, job_id: str, reference_s3_key: "str | None"):
            req_start  = time.perf_counter()
            input_dir  = "/tmp/facelift_inputs"
            output_root = "/tmp/facelift_outputs"
            os.makedirs(input_dir, exist_ok=True)
            os.makedirs(output_root, exist_ok=True)

            # Name the image after the job so concurrent jobs never share a path.
            # inference.py derives output_dir/<image_name>/gaussians.ply from
            # the filename stem, so we get output_dir/<job_id>/gaussians.ply.
            img_filename = f"{job_id}.png"
            img_path     = os.path.join(input_dir, img_filename)
            output_dir   = os.path.join(output_root, job_id)

            raw = await image.read()
            print(
                f"[facelift] {job_id} received — {len(raw) / 1024:.0f} KB upload",
                flush=True,
            )
            if len(raw) > max_image_bytes:
                print(f"[facelift] {job_id} 413 — upload too large ({len(raw)} B)", flush=True)
                raise HTTPException(413, "Image is too large")
            try:
                with Image.open(BytesIO(raw)) as img:
                    img.verify()
                    width, height = img.size
            except UnidentifiedImageError as exc:
                print(f"[facelift] {job_id} 400 — unidentifiable image", flush=True)
                raise HTTPException(400, "Invalid image") from exc
            if width * height > max_pixels:
                print(
                    f"[facelift] {job_id} 413 — too many pixels ({width}x{height})",
                    flush=True,
                )
                raise HTTPException(413, "Image has too many pixels")

            print(f"[facelift] {job_id} accepted — {width}x{height} px", flush=True)

            with open(img_path, "wb") as f:
                f.write(raw)

            try:
                loop = asyncio.get_event_loop()
                # Identity check, part 1 (no GPU): fetch the selfie to compare against.
                identity: dict = {"mode": id_mode, "status": "off"}
                identity_start = time.perf_counter()
                reference_raw = None
                if id_mode != "off":
                    if not valid_reference_key(reference_s3_key):
                        identity["status"] = "no_reference"
                    elif self.id_embedder is None:
                        identity["status"] = "unavailable"
                    else:
                        try:
                            reference_raw = await loop.run_in_executor(None, lambda: s3.get_object(
                                Bucket=bucket, Key=reference_s3_key)["Body"].read())
                        except Exception as exc:
                            identity["status"] = "error"
                            print(f"[facelift] {job_id} identity: selfie fetch failed ({exc})", flush=True)
                # Fetch time now; scoring time is added inside the lock (queueing excluded).
                identity_s = time.perf_counter() - identity_start if id_mode != "off" else 0.0

                queue_wait = time.perf_counter() - req_start
                async with _lock:
                    # Cancelled while waiting for the GPU: skip it entirely. This is
                    # the only point a build can be stopped (see module docstring).
                    async with _cancel_lock:
                        cancelled = _cancelled.is_cancelled(job_id)
                    if cancelled:
                        print(
                            f"[facelift] {job_id} 409 — cancelled while queued "
                            f"(waited {queue_wait:.2f}s); GPU skipped",
                            flush=True,
                        )
                        raise HTTPException(409, detail={
                            "code": "cancelled",
                            "message": "This build was cancelled before it started.",
                        })
                    print(
                        f"[facelift] {job_id} GPU acquired (waited {queue_wait:.2f}s) — "
                        f"running inference",
                        flush=True,
                    )
                    # Identity check, part 2: compare embeddings before the expensive
                    # reconstruction, so a blocked edit costs ~50 ms of GPU, not a build.
                    if reference_raw is not None:
                        score_start = time.perf_counter()
                        try:
                            score = await loop.run_in_executor(None, _identity_score, raw, reference_raw)
                        except Exception as exc:
                            score = None
                            identity["status"] = "error"
                            print(f"[facelift] {job_id} identity: scoring failed ({exc})", flush=True)
                        identity_s += time.perf_counter() - score_start
                        if score is not None:
                            status, block = identity_verdict(score, id_threshold, id_mode)
                            identity.update(status=status, score=round(score, 4), threshold=id_threshold)
                            print(f"[facelift] {job_id} identity {status} score={score:.3f} "
                                  f"threshold={id_threshold} mode={id_mode}", flush=True)
                            if block:
                                raise HTTPException(422, detail={
                                    "code": "identity_drift",
                                    "message": "The edited image no longer matches the selfie.",
                                })
                        elif identity["status"] != "error":
                            identity["status"] = "no_face"
                    identity_s = round(identity_s, 3)

                    # Reseed per request. The snapshot froze the RNG state, so the first
                    # job after a restore always got the same noise and later jobs drifted
                    # (same photo, different Gaussian counts). Same input -> same head, and
                    # the seed is recorded in meta.json.
                    self.generator.manual_seed(self.seed)
                    gpu_start = time.perf_counter()
                    await loop.run_in_executor(None, lambda: process_single_image(
                        image_file=img_filename,
                        input_dir=input_dir,
                        output_dir=output_root,
                        auto_crop=True,
                        unclip_pipeline=self.mv_pipeline,
                        generator=self.generator,
                        color_prompt_embedding=self.color_prompt_embeddings,
                        gs_lrm_model=self.gslrm_model,
                        demo_fxfycxcy=self.camera_intrinsics,
                        demo_c2w=self.camera_extrinsics,
                        guidance_scale_2D=3.0,
                        step_2D=50,
                        face_detector=self.face_detector,
                    ))
                    elapsed_s = round(time.perf_counter() - gpu_start, 3)
                print(f"[facelift] {job_id} inference done in {elapsed_s}s", flush=True)

                ply_path = os.path.join(output_dir, "gaussians.ply")
                if not os.path.exists(ply_path):
                    print(
                        f"[facelift] {job_id} 500 — no gaussians.ply at {ply_path}",
                        flush=True,
                    )
                    raise HTTPException(500, "FaceLift produced no gaussians.ply")

                with open(ply_path, "rb") as f:
                    ply_bytes = f.read()

                # Convert + upload here so the GPU container — not the Next.js route —
                # does the heavy lifting, and only tiny S3 keys travel back over HTTP.
                convert_start = time.perf_counter()
                splat_bytes = ply_to_splat(ply_bytes)
                convert_s = round(time.perf_counter() - convert_start, 3)
                # Refuse to publish a broken cloud (NaNs, exploded values, empty or
                # truncated output). The route then falls back to the next worker.
                try:
                    splat_info = validate_splat(splat_bytes)
                except ValueError as exc:
                    print(f"[facelift] {job_id} 500 — invalid splat: {exc}", flush=True)
                    raise HTTPException(500, "FaceLift produced an invalid splat") from exc

                upload_start = time.perf_counter()
                splat_key = f"facelifts/{job_id}/output.splat"
                # Job outputs never change under their key: let browsers/CDNs
                # keep them for a year once a signed URL has been cached.
                s3.put_object(Bucket=bucket, Key=splat_key, Body=splat_bytes,
                              ContentType="application/octet-stream",
                              CacheControl=IMMUTABLE_CACHE_CONTROL,
                              ChecksumSHA256=splat_info["sha256_b64"])
                # The 40 MB+ .ply dominates upload time; only ship it when asked.
                ply_key = None
                if need_ply:
                    ply_key = f"facelifts/{job_id}/output.ply"
                    s3.put_object(Bucket=bucket, Key=ply_key, Body=ply_bytes,
                                  ContentType="application/octet-stream",
                                  CacheControl=IMMUTABLE_CACHE_CONTROL)
                upload_s = round(time.perf_counter() - upload_start, 3)

                # Sidecar meta.json next to the splat: the viewer transform (previously
                # hard-coded in HairScene.tsx) and provenance, so the data describes itself.
                import json
                import math
                from datetime import datetime, timezone
                meta_key = f"facelifts/{job_id}/meta.json"
                meta = {
                    "schema_version": 1,
                    "job_id": job_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "model": {"name": "facelift", "commit": self.model_commit,
                              "seed": self.seed, "steps_2d": 50, "guidance_scale_2d": 3.0},
                    "gpu": {"name": self.gpu_name},
                    "input": {"width": width, "height": height, "bytes": len(raw)},
                    # splat_bytes + sha256 let a reader check it got the whole, exact file.
                    "output": {"splat_s3_key": splat_key, "ply_s3_key": ply_key,
                               "gaussian_count": splat_info["gaussian_count"],
                               "splat_bytes": splat_info["splat_bytes"],
                               "sha256": splat_info["sha256"]},
                    "timings_s": {"queue_wait": round(queue_wait, 3), "inference": elapsed_s,
                                  "convert": convert_s, "upload": upload_s,
                                  "identity_check": identity_s},
                    # Selfie-vs-edit similarity (a score only; embeddings are never stored).
                    "identity": identity,
                    # FaceLift emits in the input camera's frame (y down, z forward); the
                    # viewer applies this to get a y-up head at the app's scale.
                    "viewer": {"rotation_euler_xyz": [-math.pi / 2, math.pi, math.pi],
                               "scale": 2.772, "position": [0.0, -0.07, 0.48]},
                }
                s3.put_object(Bucket=bucket, Key=meta_key, Body=json.dumps(meta).encode(),
                              ContentType="application/json",
                              CacheControl=IMMUTABLE_CACHE_CONTROL)

                total_s = round(time.perf_counter() - req_start, 3)
                ply_size_note = f"ply {len(ply_bytes) / 1024:.0f}KB " if need_ply else "ply skipped "
                print(
                    f"[facelift] {job_id} OK — {len(splat_bytes) // 32} splats, "
                    f"{ply_size_note}splat {len(splat_bytes) / 1024:.0f}KB, "
                    f"gpu {elapsed_s}s convert {convert_s}s upload {upload_s}s total {total_s}s",
                    flush=True,
                )
                return {
                    "job_id":         job_id,
                    "ply_s3_key":     ply_key,
                    "splat_s3_key":   splat_key,
                    "meta_s3_key":    meta_key,
                    "gaussian_count": splat_info["gaussian_count"],
                    "splat_bytes":    splat_info["splat_bytes"],
                    "splat_sha256":   splat_info["sha256"],
                    "identity":       identity,
                    "elapsed_s":      elapsed_s,
                    "queue_wait_s":   round(queue_wait, 3),
                    "convert_s":      convert_s,
                    "upload_s":       upload_s,
                    "total_s":        total_s,
                }
            except HTTPException:
                raise
            except Exception:
                import traceback
                print(
                    f"[facelift] {job_id} 500 — inference raised:\n{traceback.format_exc()}",
                    flush=True,
                )
                raise HTTPException(500, "FaceLift inference failed")
            finally:
                try:
                    os.remove(img_path)
                except OSError:
                    pass
                shutil.rmtree(output_dir, ignore_errors=True)

        return api
