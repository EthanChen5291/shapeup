# Prebake pipeline

Makes the hair-only try-on splats (`public/prebake/<men|women>/<cut>-<color>.splat`)
from generated photos of two fixed house models. First run: 2026-11-02, 25 styles x 6
colours per gender (outputs kept in `~/Documents/ShapeUp-prebake-runs/2026-11-02`).

## How it works

1. **Photos** (`generate.py`): Gemini edits the house model (`house/male.png`,
   `house/female.png`) into each style in a base colour, then recolours that photo into
   the other five colours, using the same barber prompt as the app's edit route. Every
   photo is checked (face found, tilt <= 2 deg, centred, face size) and regenerated if it fails.
   Same person every time, so every prebake fits the same head.
2. **3D + labels** (`facelift_modal.py`, Modal GPUs): FaceLift exactly as production
   (seed 4, same crop and filters). GS-LRM makes one Gaussian per pixel of 6 generated
   views; the worker keeps each survivor's original index (= its source pixel) and
   segments the 6 views with a face parser.
3. **Hair extraction** (`build.py` + `extract.py`): keep the Gaussians whose source pixel
   was hair (see the rules at the top of `extract.py`), write them as `.splat`.
   FaceLift-native, so the app places them with `scale 2.772`, no offsets, opacity 1.0
   (`NATIVE_TRANSFORM` in `catalog.py`): no per-cut calibration. `cameras.json` (FaceLift's
   6 fixed view cameras) drives the ghost-face rule: hair pixels from the angled views that
   GS-LRM pushed onto the house model's nose and lips are dropped, or they show up as a
   second nose on anyone else's head.
   Last pass, `extract.face_strays`: small isolated clumps inside or in front of the lower
   face are dropped (what the ghost-face rule misses). `python clean.py` runs the same rule
   over finished `public/prebake/*.splat` files when the heads are gone.
4. **Per-head fit** (`fit.py`): FaceLift normalises on the face, not the skull, and skull
   height above the eye line varies ~0.25 between people, so native placement hovers over a
   flat crown. `catalog.FIT` carries the house models' crown heights (`python fit.py
   <house_male_buzz.npz> <house_female_buzz.npz>`, re-measure if the house heads change) and
   the app scales each cut vertically about the eye line to the wearer's crown
   (`src/lib/splatFit.ts`, same estimator). Object space is x right, y back, **z up**.
5. **Review** (`review_modal.py`, optional): renders each prebake on the house buzz-cut
   heads and writes contact sheets. Look at them before uploading.

The style list, display names, sections and colours live in `catalog.py`;
`python catalog.py` regenerates `src/data/prebakeCatalog.json`, which the try-on panel reads.

## Run it

```bash
cd scripts/prebake-pipeline
python -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
RUN=~/Documents/ShapeUp-prebake-runs/$(date +%F)

.venv/bin/python generate.py $RUN bases          # one photo per style (existing ones are skipped)
.venv/bin/python generate.py $RUN recolors       # the other colours
modal run facelift_modal.py --inputs $RUN/in --out $RUN/heads
.venv/bin/python build.py $RUN                   # -> public/prebake/*.splat AND their .spz twins (the app loads the .spz); prints outlines worth checking

# optional review (house buzz heads once per run dir):
mkdir -p $RUN/house_in && cp house/male_buzz.png $RUN/house_in/house_male_buzz.png && cp house/female_buzz.png $RUN/house_in/house_female_buzz.png
modal run facelift_modal.py --inputs $RUN/house_in --out $RUN/heads
modal run review_modal.py --run $RUN             # -> $RUN/review/*.jpg

python catalog.py                                 # if you added/renamed styles
cd ../.. && npm run prebake:upload              # build.py already ran prebake:spz (skip with --no-spz)
```

If a recolour restyled the hair (e.g. a ponytail let down), delete its photo and head,
then `generate.py $RUN recolors --strict <name>` and re-run the GPU + build steps.

## Things learned the hard way

- Google's image API has a **spend-rate limit** per billing tier: keep 2 workers; 429s back off for a minute.
- Check the output files, not the Modal command: a run can stop (`APP_STATE_STOPPED`) yet look busy.
- FaceLift's rasterizer isn't built for H100: render on L40S (`review_modal.py` pins it).
- The face parser is trained on non-commercial data (CelebAMask-HQ); fine for internal catalogue
  production, swap it before this becomes a user-facing step.
- FaceLift's weights are Adobe Research License (noncommercial); the prebakes are FaceLift outputs.

## Tests

`python -m unittest test_pipeline` (numpy only; no GPU, no network).
