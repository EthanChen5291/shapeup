"""Step 1: input photos. Resumable; every photo is QA'd and regenerated if it fails.

    python generate.py <run_dir> house          # 3 candidate house models per gender (only for a new cast)
    python generate.py <run_dir> buzz           # buzz-cut bases of the house models (review renders)
    python generate.py <run_dir> bases          # one photo per style, in the base colour
    python generate.py <run_dir> recolors [--strict name1,name2]   # the other 5 colours of each style

Photos land in <run_dir>/in/<m|f>_<cut>__<color>.png; QA results in <run_dir>/qa.json.
The house models are house/male.png and house/female.png: keep them fixed so every
prebake comes from the same head.
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import catalog  # noqa: E402
import lib  # noqa: E402

HOUSE = {"male": HERE / "house/male.png", "female": HERE / "house/female.png"}
HOUSE_PROMPT = (
    "Ultra-realistic studio photograph for a 3D head scan reference. Head-and-shoulders portrait, the person "
    "faces the camera straight on: head perfectly level, not tilted or turned, centered in the frame, "
    "shoulders square. Neutral relaxed expression, mouth closed, eyes open looking directly into the lens. "
    "No glasses, no jewelry, no makeup beyond natural. Plain white crew-neck t-shirt. Seamless plain white "
    "background with no props, shadows or gradients. Soft, even, diffuse frontal lighting from a large "
    "softbox: no harsh shadows, no rim light, no hair light. Neutral white balance. True-to-life, natural, "
    "low-saturation color like an unedited raw photo; natural skin texture with pores, no retouching, no "
    "beauty filter, no HDR, no cinematic grading. Sharp focus, 85mm lens at f/8. Framing from mid-chest to "
    "just above the top of the head, with a little headroom; the face fills about 40% of the image height."
)
HOUSE_PEOPLE = {
    "male": "A 27-year-old man with a typical, well-defined facial structure, clean-shaven. Short, neat, "
            "medium-brown hair combed back off the forehead so the full hairline is visible. ",
    "female": "A 26-year-old woman with a typical, well-defined facial structure. Medium-brown hair pulled "
              "straight back into a low bun so the full hairline and ears are visible. ",
}


class Run:
    def __init__(self, run_dir: Path):
        self.dir = run_dir
        self.inp = run_dir / "in"
        self.inp.mkdir(parents=True, exist_ok=True)
        self.qa_path = run_dir / "qa.json"
        self.key = lib.env()["GEMINI_API_KEY"]

    def generate(self, job, tries=3):
        """job = (path, prompt, source image or None, barber prompt?). Returns (path, qa, attempts)."""
        path, prompt, source, barber = job
        q = {}
        for attempt in range(tries):
            try:
                data = lib.gemini(self.key, prompt, image=source.read_bytes() if source else None,
                                  barber=barber, aspect="3:4")
            except Exception as exc:  # keep the batch going; a re-run retries it
                return path, {"error": str(exc)[:200]}, attempt + 1
            path.write_bytes(data)
            q = lib.qa(path)
            if lib.qa_ok(q):
                return path, q, attempt + 1
        return path, {**q, "failed_qa": True}, tries

    def run(self, jobs, workers=2):  # 2 workers: Google's spend-rate limit throttles bursts
        qa = json.loads(self.qa_path.read_text()) if self.qa_path.exists() else {}
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for path, q, attempts in pool.map(self.generate, jobs):
                qa[path.stem] = {**q, "attempts": attempts}
                self.qa_path.write_text(json.dumps(qa, indent=1))
                bad = q.get("failed_qa") or q.get("error")
                print(f"{path.stem}: {'PROBLEM ' + str(q.get('error', 'failed QA')) if bad else 'ok'} ({attempts} tries)", flush=True)


def main():
    run = Run(Path(sys.argv[1]).expanduser())
    step = sys.argv[2]
    jobs = []
    if step == "house":
        for g in ("male", "female"):
            for i in range(3):
                jobs.append((run.dir / f"house_{g}_{i}.png", HOUSE_PEOPLE[g] + HOUSE_PROMPT, None, False))
    elif step == "buzz":  # house/<gender>_buzz.png already holds these; regenerate only for a new cast
        (run.dir / "house_in").mkdir(exist_ok=True)
        for g in ("male", "female"):
            jobs.append((run.dir / "house_in" / f"house_{g}_buzz.png",
                         lib.production_prompt(lib.buzz_prompt()), HOUSE[g], True))
    elif step == "bases":
        for g, table in catalog.styles().items():
            for cut, (_s, _n, _b, prompt) in table.items():
                path = run.inp / f"{catalog.image_name(g, cut, catalog.base_color(g))}.png"
                if not path.exists():
                    jobs.append((path, lib.production_prompt(f"{prompt} {catalog.BASE_COLOR_TEXT[g]}"), HOUSE[g], True))
    elif step == "recolors":
        strict = set(sys.argv[4].split(",")) if len(sys.argv) > 4 and sys.argv[3] == "--strict" else set()
        for g, table in catalog.styles().items():
            for cut in table:
                base = run.inp / f"{catalog.image_name(g, cut, catalog.base_color(g))}.png"
                for c, (_l, _s, text) in catalog.COLORS[g].items():
                    path = run.inp / f"{catalog.image_name(g, cut, c)}.png"
                    if text is None or (path.exists() and path.stem not in strict) or not base.exists():
                        continue
                    request = catalog.recolor_request(text, strict=path.stem in strict)
                    jobs.append((path, lib.production_prompt(request), base, True))
    else:
        raise SystemExit(__doc__)
    print(f"{len(jobs)} generations", flush=True)
    run.run(jobs)


if __name__ == "__main__":
    main()
