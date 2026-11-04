"""Drop face residue from finished prebake .splat files (no heads or labels needed).

    python clean.py                      # every public/prebake/<men|women>/*.splat, in place
    python clean.py path/to/a.splat ...  # just these
    options: --dry (report only)  --no-spz (skip re-encoding the .spz twins)

Applies extract.face_strays: small isolated clumps inside or in front of the lower face
(floating nose, lip and chin blobs left by the ghost-face mechanism) are removed; the
rest of the file is untouched, row order included. Keep a copy of the originals first
(build.py writes them from the run's heads, which may be gone).
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import catalog  # noqa: E402
from extract import STRAY_MIN_ALPHA, face_strays  # noqa: E402
from splat_io import SPLAT_DTYPE  # noqa: E402


def clean_file(path: Path, dry: bool = False) -> tuple[int, int, int]:
    """Returns (rows before, rows dropped, visible rows dropped)."""
    rows = np.fromfile(path, dtype=SPLAT_DTYPE)
    alpha = rows["c"][:, 3] / 255.0
    drop = face_strays(rows["p"].astype(np.float64), alpha)
    if drop.any() and not dry:
        rows[~drop].tofile(path)
    return len(rows), int(drop.sum()), int((drop & (alpha >= STRAY_MIN_ALPHA)).sum())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    files = [Path(a) for a in args] or sorted((catalog.REPO / "public/prebake").glob("*/*.splat"))
    touched = 0
    for f in files:
        before, dropped, visible = clean_file(f, dry)
        if dropped:
            touched += 1
            print(f"{'would drop' if dry else 'dropped':10} {dropped:5d} ({visible:4d} visible) of {before:7d}  "
                  f"{f.relative_to(catalog.REPO) if f.is_relative_to(catalog.REPO) else f}")
    print(f"\n{len(files)} files, {touched} with face residue{' (dry run, nothing written)' if dry else ''}")
    if touched and not dry and "--no-spz" not in sys.argv:
        subprocess.run(["npm", "run", "prebake:spz"], cwd=catalog.REPO, check=True)


if __name__ == "__main__":
    main()
