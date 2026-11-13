"""Gemini generation/edits with the production prompts, plus input-photo QA."""
import base64
import io
import json
import re
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
MODEL = "gemini-3.1-flash-image-preview"


def env():
    out = {}
    for name in (".env", ".env.local"):  # .env.local wins, like Next.js
        p = REPO / name
        if p.exists():
            for line in p.read_text().splitlines():
                m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
                if m:
                    out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def production_prompt(client_request: str) -> str:
    """The exact barber prompt the edit routes send (no reference image, no geometry)."""
    src = (REPO / "src/lib/hairEdit.ts").read_text(errors="replace")
    body = src[src.index("return `ROLE", src.index("function buildEditPrompt")) + len("return `"):]
    body = body[: body.index("`;\n}")]
    t0 = body.index("${hasReference ? `")
    colon = body.index("` : `", t0)
    end = body.index("`}", colon)
    body = body[:t0] + body[colon + len("` : `"):end] + body[end + 2:]
    return body.replace("${clientRequest}", client_request).replace("${geometryJson}", "unavailable")


def buzz_prompt() -> str:
    """QuickTryOns' BUZZ_PROMPT, read from source (the try-on base users get)."""
    src = (REPO / "src/components/QuickTryOns.tsx").read_text()
    start = src.index("const BUZZ_PROMPT")
    return "".join(re.findall(r"'([^']*)'", src[start:src.index(";", start)]))


def to_jpeg_1024(raw: bytes) -> bytes:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img.thumbnail((1024, 1024))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def gemini(api_key: str, prompt: str, image: bytes | None = None, barber: bool = False,
           aspect: str | None = "3:4", tries: int = 8) -> bytes:
    parts = []
    if image is not None:
        if barber:
            parts.append({"text": "SOURCE PHOTO — preserve this person, framing, and identity:"})
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(to_jpeg_1024(image)).decode()}})
    parts.append({"text": prompt})
    config = {"responseModalities": ["IMAGE", "TEXT"]}
    if aspect:
        config["imageConfig"] = {"aspectRatio": aspect}
    last = None
    for attempt in range(tries):
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            headers={"x-goog-api-key": api_key, "content-type": "application/json"},
            json={"contents": [{"role": "user", "parts": parts}], "generationConfig": config},
            timeout=240,
        )
        if r.status_code == 400 and "imageConfig" in config:
            config.pop("imageConfig")
            continue
        if r.ok:
            for cand in r.json().get("candidates", []):
                for part in cand.get("content", {}).get("parts", []):
                    data = part.get("inlineData") or part.get("inline_data")
                    if data:
                        return base64.b64decode(data["data"])
            last = "no image in response: " + json.dumps(r.json())[:300]
        else:
            last = f"HTTP {r.status_code}: {r.text[:300]}"
        # 429 is Google's spend-rate limit for the account tier: back off for a minute.
        time.sleep(60 if r.status_code == 429 else 3 * (attempt + 1))
    raise RuntimeError(last)


_detector = None


def qa(path: Path) -> dict:
    """Framing / tilt / background / saturation of a FaceLift input photo."""
    global _detector
    import torch
    from facenet_pytorch import MTCNN
    if _detector is None:
        _detector = MTCNN(keep_all=False, device=torch.device("cpu"))
    img = Image.open(path).convert("RGB")
    w, h = img.size
    boxes, _, lms = _detector.detect(img, landmarks=True)
    out = {"w": w, "h": h}
    if boxes is None:
        return {**out, "face": False}
    (x0, y0, x1, y1), lm = boxes[0], lms[0]
    le, re_ = lm[0], lm[1]
    out.update(face=True,
               tilt_deg=round(float(np.degrees(np.arctan2(re_[1] - le[1], re_[0] - le[0]))), 2),
               center_dx=round(float(((x0 + x1) / 2 - w / 2) / w), 3),
               face_h=round(float((y1 - y0) / h), 3))
    a = np.asarray(img).astype(float) / 255
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    out["bg_std"] = round(float(border.std()), 3)
    hsv = np.asarray(img.convert("HSV")).astype(float) / 255
    out["sat_mean"] = round(float(hsv[..., 1][a.min(axis=2) < 0.9].mean()), 3)
    return out


def qa_ok(q: dict) -> bool:
    return bool(q.get("face")) and abs(q["tilt_deg"]) <= 2.0 and abs(q["center_dx"]) <= 0.02 and 0.28 <= q["face_h"] <= 0.5
