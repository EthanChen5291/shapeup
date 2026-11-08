"""Step 2 (GPU): FaceLift + per-pixel hair labels for every photo, in parallel on Modal.

    modal run facelift_modal.py --inputs <run_dir>/in --out <run_dir>/heads

Runs FaceLift exactly like production (server/modal_facelift.py image and weights,
seed 4, auto-crop, same filters). It also keeps each surviving Gaussian's original
index (its source pixel in the 6 generated views) and segments those views with a
face parser, so extract.py can keep the Gaussians that came from hair pixels.
Images that already have <out>/<name>.npz are skipped.
"""
import io
import sys
from pathlib import Path

import modal

# Locally this file sits in <repo>/scripts/prebake-pipeline; inside the Modal container it is
# mounted at /root, where there is no repo (modal_facelift is shipped as local python source).
_parents = Path(__file__).resolve().parents
if len(_parents) > 2:
    sys.path.insert(0, str(_parents[2] / "server"))
from modal_facelift import FACELIFT_DIR, WEIGHTS_DIR, image as worker_image, weights_volume  # noqa: E402

app = modal.App("shapeup-prebake-facelift", image=worker_image.add_local_python_source("modal_facelift"))
# Face parser (SegFormer on CelebAMask-HQ, non-commercial training data): fine for producing
# the catalog internally; swap for a commercially licensed segmenter before shipping it as a product step.
SEG_MODEL = "jonathandinu/face-parsing"


@app.function(gpu=["L40S", "A100-80GB", "H100"], volumes={WEIGHTS_DIR: weights_volume}, timeout=1800)
def split(images: dict) -> dict:
    import time

    import numpy as np
    import torch
    from easydict import EasyDict as edict
    from einops import rearrange
    from PIL import Image

    sys.path.insert(0, FACELIFT_DIR)
    import inference as fl
    from gslrm.model.gaussians_renderer import GaussianModel
    from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

    device = torch.device("cuda:0")
    mv_path, ckpt, cfg = fl.get_model_paths()
    pipe, generator, prompt_emb = fl.initialize_mvdiffusion_pipeline(mv_path, device)
    lrm = fl.initialize_gslrm_model(ckpt, cfg, device)
    fxfycxcy, c2w = fl.setup_camera_parameters(device)
    seg_proc = SegformerImageProcessor.from_pretrained(SEG_MODEL)
    seg_model = SegformerForSemanticSegmentation.from_pretrained(SEG_MODEL).to(device).eval()

    # Carry each Gaussian's original index through every filter (they all call filter()).
    # Patch once per container: Modal reuses containers across .map inputs.
    if not getattr(GaussianModel, "_src_tracked", False):
        original_filter = GaussianModel.filter

        def tracked_filter(self, mask):
            if hasattr(self, "_src_idx"):
                self._src_idx = self._src_idx[mask]
            return original_filter(self, mask)

        GaussianModel.filter = tracked_filter
        GaussianModel._src_tracked = True

    out = {}
    for name, raw in images.items():
        t0 = time.perf_counter()
        src = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
        try:
            inp = fl.preprocess_image(src)
        except Exception:  # same fallback as production
            inp = fl.remove(Image.fromarray(src), session=fl.REMBG_SESSION).resize(
                (fl.DEFAULT_IMG_SIZE, fl.DEFAULT_IMG_SIZE), Image.LANCZOS)
        generator.manual_seed(4)
        mv = pipe(inp, None, prompt_embeds=prompt_emb, guidance_scale=3.0, num_images_per_prompt=1,
                  num_inference_steps=50, generator=generator, eta=1.0).images
        views = mv[1:7] if len(mv) == 7 else mv[0:6]

        x = torch.from_numpy(np.stack([np.array(v) for v in views])).float()[None].to(device) / 255
        x = rearrange(x, "b v h w c -> b v c h w")
        idx = torch.stack([torch.zeros(6).long(), torch.arange(6).long()], dim=-1)[None].to(device)
        batch = edict({"image": x, "c2w": c2w, "fxfycxcy": fxfycxcy, "index": idx})
        with torch.no_grad(), torch.autocast(enabled=True, device_type="cuda", dtype=torch.float16):
            res = lrm.forward(batch, create_visual=False, split_data=False)
        g = res.gaussians[0]
        n_total = g._xyz.shape[0]
        g._src_idx = torch.arange(n_total, device=g._xyz.device)
        g.apply_all_filters(opacity_thres=0.04, scaling_thres=0.1, floater_thres=0.6,
                            crop_bbx=[-0.91, 0.91, -0.91, 0.91, -1.0, 1.0], cam_origins=None,
                            nearfar_percent=(0.0001, 1.0))

        with torch.no_grad():
            seg_in = seg_proc(images=[v.convert("RGB") for v in views], return_tensors="pt").to(device)
            up = torch.nn.functional.interpolate(seg_model(**seg_in).logits, size=views[0].size[::-1],
                                                 mode="bilinear", align_corners=False)
            labels = up.argmax(dim=1).to(torch.uint8).cpu().numpy()
            hair_prob = up.softmax(dim=1)[:, 13].half().cpu().numpy()

        dc = g._features_dc.reshape(g._features_dc.shape[0], -1)[:, :3]
        buf = io.BytesIO()
        np.savez_compressed(
            buf,
            xyz=g.get_xyz.float().cpu().numpy(),
            scale=g.get_scaling.float().cpu().numpy(),
            rot=g.get_rotation.float().cpu().numpy(),
            opacity=g.get_opacity.float().cpu().numpy().ravel(),
            rgb=(0.5 + 0.28209479177387814 * dc.float()).clamp(0, 1).cpu().numpy(),
            src_idx=g._src_idx.cpu().numpy().astype(np.int64),
            n_total=np.array(n_total),
            labels=labels,
            hair_prob=hair_prob,
        )
        strip = Image.new("RGB", (views[0].width * 6, views[0].height))
        for i, v in enumerate(views):
            strip.paste(v.convert("RGB"), (views[0].width * i, 0))
        png = io.BytesIO()
        strip.save(png, "PNG")
        out[name] = {"npz": buf.getvalue(), "views": png.getvalue(), "seconds": round(time.perf_counter() - t0, 2)}
        del res
        torch.cuda.empty_cache()
    return out


@app.local_entrypoint()
def main(inputs: str, out: str, chunk: int = 8):
    dst = Path(out).expanduser()
    dst.mkdir(parents=True, exist_ok=True)
    todo = [p for p in sorted(Path(inputs).expanduser().iterdir())
            if p.suffix.lower() == ".png" and not (dst / f"{p.stem}.npz").exists()]
    chunks = [{p.stem: p.read_bytes() for p in todo[i:i + chunk]} for i in range(0, len(todo), chunk)]
    print(f"{len(todo)} images in {len(chunks)} chunks", flush=True)
    for result in split.map(chunks, order_outputs=False):
        for name, r in result.items():
            (dst / f"{name}.npz").write_bytes(r["npz"])
            (dst / f"{name}_views.png").write_bytes(r["views"])
            print(f"{name}: {r['seconds']}s", flush=True)
