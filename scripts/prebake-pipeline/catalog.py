"""The prebake catalog: styles, colours, prompts and the display data the app reads.

`python catalog.py` writes src/data/prebakeCatalog.json (the app's list). Add or edit
styles here, regenerate, and the try-on panel picks them up.
"""
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "src/data/prebakeCatalog.json"
FILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")  # src/lib/prebakeKeys.ts FILE_RE (minus extension)

# key: (section, display name, blurb, prompt)
MEN = {
    "middlepart": ("medium", "Middle Part", "straight curtains", "Straight middle-part curtains: medium-length straight hair parted in the center, a curtain fringe falling to the cheekbones on both sides, sides covering the tops of the ears, back reaching the nape."),
    "wavymiddlepart": ("medium", "Wavy Middle Part", "loose centre-part waves", "Wavy middle part: medium-length loose waves parted in the center, framing the face to the cheekbones, sides over the ears, back reaching the nape."),
    "wavyfringe": ("medium", "Wavy Fringe", "soft waves forward", "Wavy fringe: medium-length wavy hair with a soft wavy fringe falling forward onto the forehead, volume on top, sides over the ears."),
    "wolfcut": ("medium", "Wolf Cut", "shaggy, choppy layers", "Wolf cut: shaggy, heavily layered, medium length. Choppy layers with volume on top and at the crown; a textured, piece-y, slightly messy fringe falling onto the forehead down to the eyebrows with separated strands; longer feathered layers at the back reaching the top of the neck; the sides cover the tops of the ears."),
    "mullet": ("medium", "Modern Mullet", "longer at the back", "Modern mullet: medium-length textured top and sides with choppy texture (sides covering the ears, not shaved), and noticeably longer flowing layers at the back reaching past the nape onto the neck."),
    "shag": ("medium", "Layered Shag", "choppy and textured", "Layered shag: medium-length shaggy cut with many choppy layers, texture and movement, a loose fringe to the eyebrows, sides over the ears, back to the nape."),
    "kpopperm": ("medium", "Soft Perm", "Korean curtain fringe", "Korean soft perm with curtain fringe: medium-length hair with a soft, loose perm on top and a full curtain fringe parted in the center down to the eyebrows, hair covering the tops of the ears."),
    "sidefringe": ("medium", "Side Fringe", "swept across the brow", "Side-swept textured fringe: medium-length textured hair swept diagonally across the forehead, the fringe ending near one eyebrow, sides over the ears."),
    "slickedback": ("medium", "Slicked Back", "combed back, soft hold", "Slicked-back medium length: medium-length hair combed straight back from the forehead with a soft natural hold, falling behind the ears to the nape."),
    "broflow": ("medium", "Bro Flow", "swept back, ear length", "Bro flow: medium-length hair swept back off the face, ear length, flowing behind the ears with a natural wave and flicking out at the nape."),
    "sidepart": ("medium", "Side Part", "deep part, lifted", "Voluminous side part: medium-length hair with a deep side part, volume swept up and over, sides covering the tops of the ears."),
    "tuckedcurtains": ("medium", "Tucked Curtains", "chin length, behind the ears", "Grown-out curtains tucked behind the ears: chin-length, center-parted hair tucked behind both ears."),
    "messytextured": ("medium", "Messy Textured", "tousled and piece-y", "Messy textured medium: tousled, piece-y medium-length hair with natural movement all over and a loose fringe onto the forehead."),
    "eboy": ("medium", "Long Fringe", "heavy, messy fringe", "Long messy fringe: medium-length, textured hair with a heavy, piece-y fringe covering the whole forehead and touching the eyebrows, strands separated and messy with gaps showing the forehead between them; sides fall over the ears."),
    "surferwaves": ("long", "Surfer Waves", "shoulder-length waves", "Surfer waves: shoulder-length, sun-tousled loose waves, loose center part, tucked behind the ears."),
    "longstraight": ("long", "Long Straight", "shoulder length, centre part", "Long straight hair reaching the shoulders, center part, worn down."),
    "longlayers": ("long", "Long Layers", "chest length", "Long layered hair reaching the chest, worn down, natural texture with soft layers and a center part."),
    "curlymop": ("curls", "Curly Mop", "springy curls", "Medium curly mop: dense, springy curls all over, medium length, curls falling onto the forehead, sides over the ears."),
    "longcurls": ("curls", "Long Curls", "shoulder-length curls", "Long curls: defined 3B curls reaching the shoulders, worn down with volume."),
    "afro": ("curls", "Afro", "rounded, even", "Medium afro: about 3 inches of coily hair all over, shaped into an even, soft, round silhouette."),
    "twists": ("curls", "Two-Strand Twists", "medium length", "Two-strand twists, medium length (about 5 inches), even coverage over the whole head, the twists falling naturally around the head to ear level with a few framing the forehead."),
    "locs": ("curls", "Locs", "shoulder length", "Shoulder-length locs (dreadlocks) of medium thickness, worn down, some falling in front of the shoulders."),
    "manbun": ("tied", "Man Bun", "tied on the crown", "Man bun: long hair gathered into a neat bun on the crown, sides and back pulled back smoothly, the full hairline visible."),
    "halfupbun": ("tied", "Half-Up Bun", "top tied, rest down", "Half-up bun: the top section of long hair tied in a small bun on the crown, the rest worn down to the shoulders."),
    "lowponytail": ("tied", "Low Ponytail", "tied at the nape", "Low ponytail: long hair pulled back into a low ponytail at the nape, with a few loose strands framing the face."),
}
WOMEN = {
    "layeredbob": ("short", "Layered Bob", "jaw length", "Layered bob: jaw-length bob with soft layers and gentle volume."),
    "asymbob": ("short", "Asymmetric Bob", "longer on one side", "Asymmetrical bob: jaw length, longer on one side, with a deep side part."),
    "lob": ("short", "Textured Lob", "collarbone length", "Textured lob: collarbone-length long bob with soft tousled texture and a slight off-center part."),
    "hushcut": ("short", "Hush Cut", "airy Korean layers", "Hush cut: soft, airy Korean layered cut, shoulder length, wispy face-framing layers and light see-through bangs."),
    "shag": ("short", "Shag", "shoulder length, choppy", "Medium shag: shoulder-length, choppy layered shag with lots of texture and a messy fringe."),
    "mediumcurtains": ("short", "Curtain Bangs", "collarbone length", "Collarbone-length hair with long curtain bangs parted in the center and a soft blowout."),
    "ccurl": ("short", "C-Curl", "ends curled in", "Korean C-curl: shoulder-length hair with the ends curled softly inward, airy face-framing layers and see-through bangs."),
    "hollywoodwaves": ("short", "Hollywood Waves", "glossy, side-swept", "Hollywood waves: shoulder-length glossy, sculpted vintage waves with a deep side part, swept to one side."),
    "mullet": ("short", "Modern Mullet", "longer at the back", "Modern mullet: shorter, choppy layers on top and at the sides covering the ears, with longer layers at the back past the shoulders, and a fringe."),
    "longlayersbangs": ("long", "Long Layers + Bangs", "curtain bangs", "Long layers with curtain bangs: long hair past the shoulders with soft layers and curtain bangs parted in the center, worn down."),
    "butterfly": ("long", "Butterfly Cut", "bouncy face-framing layers", "Butterfly cut, worn down: long hair past the shoulders with many face-framing layers starting at the cheekbones, a voluminous bouncy blowout, and wispy curtain bangs parted in the middle with a few loose strands across the forehead."),
    "wolfcut": ("long", "Wolf Cut", "shaggy, with fringe", "Wolf cut: shaggy, heavily layered, past the shoulders, choppy layers with volume at the crown and a textured fringe."),
    "sleekstraight": ("long", "Sleek Straight", "long and glossy", "Sleek long straight hair past the shoulders, center part, glossy and smooth, worn down."),
    "beachwaves": ("long", "Beach Waves", "long, loose waves", "Long beach waves: long, loose, tousled waves past the shoulders, worn down with a soft center part."),
    "bluntbangs": ("long", "Blunt Bangs", "long, full fringe", "Long hair past the shoulders with full, blunt, straight bangs to the eyebrows, worn down."),
    "faceframing": ("long", "Face-Framing Layers", "long, no bangs", "Long hair past the shoulders with long face-framing layers starting at the chin, no bangs, center part."),
    "birkin": ("long", "Birkin Bangs", "wispy fringe", "Long straight hair worn down past the shoulders with wispy Birkin bangs: a light, see-through fringe covering the forehead down to the eyebrows, made of separated wispy strands with skin visible between them."),
    "mermaidwaves": ("long", "Mermaid Waves", "extra long", "Extra-long mermaid waves: long, defined, uniform waves well past the shoulders, worn down."),
    "curlyshag": ("curls", "Curly Shag", "curls with a fringe", "Curly shag: shoulder-length 3B/3C curls cut into a layered shag with a curly fringe."),
    "longcurls": ("curls", "Long Curls", "voluminous", "Long natural curls: defined 3B curls past the shoulders, voluminous, worn down."),
    "afro": ("curls", "Afro", "full and rounded", "Big afro: voluminous, rounded 4C coily hair, even and full all around the head."),
    "braids": ("curls", "Box Braids", "long, knotless", "Long medium-size knotless box braids, worn down with a middle part, falling past the shoulders to mid-back, some braids hanging in front of the shoulders."),
    "locs": ("curls", "Locs", "long", "Long locs past the shoulders, medium thickness, worn down with a center part."),
    "highponytail": ("tied", "High Ponytail", "sleek, at the crown", "Sleek high ponytail: hair pulled smoothly back into a high ponytail at the crown, the ponytail falling past the shoulders, hairline fully visible."),
    "halfup": ("tied", "Half Up", "top clipped back", "Half-up half-down: the top section pulled back and clipped at the crown, the rest worn down in soft waves past the shoulders."),
}
SECTIONS = {
    "male": [("medium", "Medium"), ("long", "Long"), ("curls", "Curls & coils"), ("tied", "Tied back")],
    "female": [("short", "Bobs & shoulder length"), ("long", "Long"), ("curls", "Curls & coils"), ("tied", "Tied up")],
}
# key: (label, UI swatch, recolour description; None = the base photo's colour)
COLORS = {
    "male": {
        "darkbrown": ("Dark Brown", "#3b2a20", None),
        "jetblack": ("Jet Black", "#141212", "jet black"),
        "lightbrown": ("Light Brown", "#8a6243", "light brown"),
        "ashblonde": ("Ash Blonde", "#a8957a", "dirty ash blonde"),
        "platinum": ("Platinum", "#e3dccd", "platinum icy blonde, bleached evenly from root to tip"),
        "silver": ("Silver", "#a9aaae", "silver gray"),
    },
    "female": {
        "espresso": ("Espresso", "#2a1c16", None),
        "mocha": ("Mocha", "#6b4a35", "warm milk-chocolate mocha brown, clearly lighter and warmer than espresso"),
        "caramelbalayage": ("Caramel Balayage", "linear-gradient(135deg, #3a271c 0%, #3a271c 40%, #c08a4e 100%)",
                            "dark brown roots melting into clearly visible bright caramel and honey balayage through the mid-lengths and ends"),
        "honeyblonde": ("Honey Blonde", "#c9a061", "buttery honey blonde"),
        "copper": ("Copper", "#a8532c", "natural copper red"),
        "cherrycola": ("Cherry Cola", "#4a1d1f", "cherry cola, a deep dark red-brown"),
    },
}
BASE_COLOR_TEXT = {"male": "Natural dark brown.", "female": "Espresso dark brown."}
GENDER_DIR = {"male": "men", "female": "women"}
CUT_ID_PREFIX = {"male": "m-", "female": "f-"}  # keeps ids apart from the legacy hand-cut prebakes
# FaceLift-native hair: placed straight into the head's object space (k = 1, no offsets,
# opacity as reconstructed). See src/lib/splatMerge.ts.
# headAlpha 1.0: the wearer's buzz-cut base is NOT gained under catalog hair. With the hand-cut
# default (1.5) the scalp out-blends the thin hair that lies flush on the temples, so the sides read
# as stubble "floating" below the hair (2026-11-04, measured on two real heads).
NATIVE_TRANSFORM = {"scale": 2.772, "dx": 0, "dy": 0, "dz": 0, "alpha": 1.0, "headAlpha": 1.0}
# Where the house models' skulls top out (fit.crown_z on the 2026-11-02 house buzz heads):
# the app scales each cut vertically about the eye line so this lands on the wearer's crown.
# hairlineZ: where the house hairline sits (object z). The app measures the wearer's from the
# buzz-cut base (fit.hairline_z / splatFit.hairlineZ) and maps house → wearer so the fringe
# starts on the wearer's hairline, not the house model's. These values are the front-edge of
# the non-fringe cuts measured on 2026-11-04 (men 0.33–0.36, women 0.30–0.36); replace with
# fit.hairline_z on the house buzz heads when those are rebuilt.
# widthX / depthY / centerX: head width (x), depth (y) and x centre at the temple band of the house
# buzz heads (fit.py on their FaceLift .npz, 2026-11-04). The app scales a cut's x and y by the
# wearer's width/depth over these and shifts it by the centre difference (lib/splatFit).
FIT = {"anchorZ": 0.0, "crownZ": {"men": 0.638, "women": 0.602}, "hairlineZ": {"men": 0.35, "women": 0.34},
       "widthX": {"men": 0.79, "women": 0.765}, "depthY": {"men": 0.958, "women": 0.917},
       "centerX": {"men": -0.019, "women": -0.008}}

STRICT = ("This is a colour change only: do not restyle. If the hair is tied back (ponytail, bun), it stays tied back "
          "exactly as it is; straight hair stays straight; nothing is let down, curled, lengthened or shortened. ")


def recolor_request(color: str, strict: bool = False) -> str:
    return ((STRICT if strict else "") + f"Recolor the hair only, to {color}. Keep exactly the same haircut, length, "
            "shape, parting, texture, strand placement and lighting. Realistic salon colour with natural dimension, "
            "not oversaturated or flat; skin, face and background unchanged.")


def styles():
    """{gender: {cut: (section, name, blurb, prompt)}}"""
    return {"male": MEN, "female": WOMEN}


def base_color(gender: str) -> str:
    return next(k for k, v in COLORS[gender].items() if v[2] is None)


def file_stem(cut: str, color: str) -> str:
    """<cut>-<color>: hyphenated, so it can't collide with legacy <cut>_<color> files."""
    return f"{cut}-{color}"


def image_name(gender: str, cut: str, color: str) -> str:
    return f"{'m' if gender == 'male' else 'f'}_{cut}__{color}"


def manifest() -> dict:
    out = {"transform": NATIVE_TRANSFORM, "fit": FIT, "genders": {}}
    for gender, table in styles().items():
        sections = []
        for sid, label in SECTIONS[gender]:
            cuts = [{
                "id": CUT_ID_PREFIX[gender] + cut,
                "name": name,
                "blurb": blurb,
                "variants": [{"color": c, "label": lab, "swatch": sw, "file": file_stem(cut, c)}
                             for c, (lab, sw, _) in COLORS[gender].items()],
            } for cut, (sec, name, blurb, _) in table.items() if sec == sid]
            sections.append({"id": sid, "label": label, "cuts": cuts})
        out["genders"][GENDER_DIR[gender]] = sections
    return out


def check():
    for gender, table in styles().items():
        assert len(table) == 25, f"{gender}: {len(table)} styles"
        assert len(COLORS[gender]) == 6
        assert sum(v[2] is None for v in COLORS[gender].values()) == 1
        sections = {s for s, _ in SECTIONS[gender]}
        for cut, (sec, *_rest) in table.items():
            assert sec in sections, f"{cut}: unknown section {sec}"
            for c in COLORS[gender]:
                assert FILE_RE.match(file_stem(cut, c)), file_stem(cut, c)


if __name__ == "__main__":
    check()
    MANIFEST.write_text(json.dumps(manifest(), indent=1) + "\n")
    print(f"wrote {MANIFEST.relative_to(REPO)}")
