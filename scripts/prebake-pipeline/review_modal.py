"""Step 4 (GPU, optional): render every prebake on the house buzz heads, then contact sheets.

    modal run review_modal.py --run <run_dir>

Needs <run_dir>/heads/house_male_buzz.npz and house_female_buzz.npz (generate.py buzz,
then facelift_modal.py on those two photos). Writes <run_dir>/scenes/<name>.jpg (4 views)
and <run_dir>/review/<style>.jpg + overview_<gender>.jpg. Renders on L40S: FaceLift's
rasterizer isn't compiled for H100 (sm_90).
"""
import io
import sys
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "server"))
from modal_facelift import FACELIFT_DIR, image as worker_image  # noqa: E402

app = modal.App("shapeup-prebake-review", image=worker_image.add_local_python_source("modal_facelift"))
KEYS = ("xyz", "scale", "rot", "opacity", "rgb")


@app.function(gpu="L40S", timeout=1800)
def render_chunk(job: dict) -> dict:
    import numpy as np
    import torch
    from PIL import Image

    sys.path.insert(0, FACELIFT_DIR)
    from gslrm.model.gaussians_renderer import GaussianModel, RGB2SH, render_turntable

    houses = {g: dict(np.load(io.BytesIO(b))) for g, b in job["houses"].items()}
    for h in houses.values():
        h["opacity"] = np.minimum(1.0, h["opacity"] * 1.5)  # production headAlpha
    out = {}
    for name, blob in job["items"].items():
        hair = dict(np.load(io.BytesIO(blob)))
        house = houses["m" if name.startswith("m_") else "f"]
        d = {k: np.concatenate([house[k], hair[k]]).astype(np.float32) for k in KEYS}
        t = lambda a: torch.from_numpy(np.ascontiguousarray(a)).float().cuda()  # noqa: E731
        g = GaussianModel(sh_degree=0)
        g._xyz, g._features_dc = t(d["xyz"]), RGB2SH(t(d["rgb"]))[:, None, :]
        g._scaling, g._rotation = torch.log(t(d["scale"])), t(d["rot"])
        op = t(d["opacity"]).clamp(1e-5, 1 - 1e-5)
        g._opacity = torch.log(op / (1 - op))[:, None]
        with torch.no_grad():
            img = render_turntable(g, rendering_resolution=384, num_views=4)
        img = img if isinstance(img, np.ndarray) else img.cpu().numpy()
        if img.dtype != np.uint8:
            img = (np.clip(img, 0, 1) * 255).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(img).save(buf, "JPEG", quality=88)
        out[name] = buf.getvalue()
    return out


@app.local_entrypoint()
def main(run: str, chunk: int = 15):
    import numpy as np

    run_dir = Path(run).expanduser()
    scenes, heads = run_dir / "scenes", run_dir / "heads"
    houses = {}
    for g, n in (("m", "house_male_buzz"), ("f", "house_female_buzz")):
        d = np.load(heads / f"{n}.npz")
        buf = io.BytesIO()
        np.savez(buf, **{k: d[k] for k in KEYS})
        houses[g] = buf.getvalue()
    todo = [p for p in sorted(scenes.glob("*.npz")) if not (scenes / f"{p.stem}.jpg").exists()]
    jobs = [{"houses": houses, "items": {p.stem: p.read_bytes() for p in todo[i:i + chunk]}}
            for i in range(0, len(todo), chunk)]
    print(f"{len(todo)} scenes in {len(jobs)} chunks", flush=True)
    for result in render_chunk.map(jobs, order_outputs=False):
        for name, jpg in result.items():
            (scenes / f"{name}.jpg").write_bytes(jpg)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import sheets
    sheets.write(run_dir)
    print("review sheets in", run_dir / "review", flush=True)
