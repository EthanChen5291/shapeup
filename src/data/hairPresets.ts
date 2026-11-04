// ============================================================
// Preset hairstyles — the FREE "try-on" library
// ------------------------------------------------------------
// Quick try-ons: users preview pre-baked hairstyles on a buzz-cut
// version of their own head without a per-style GPU build. Each look
// is a hair-only Gaussian splat (.splat) merged into the head splat
// at a fixed overlay transform (see lib/splatMerge PREBAKE_OVERLAY).
//
// A "cut" is a base style (e.g. Middle Part) that ships in one or
// more hair colors.
//
// Files are requested as /prebake/<gender>/<cut>_<color>.splat. Locally the
// git-ignored public/ copies answer; in deploys the request is rewritten to
// /api/prebake/..., which redirects to S3 (prebake/<gender>/<file>.splat in the
// app bucket). After adding or regenerating a file: `npm run prebake:upload`.
//
// Two generations of files:
//   - the catalog (prebakeCatalog.json, from scripts/prebake-pipeline): 25 cuts x 6
//     colours per gender, FaceLift-native, named <cut>-<color>; ids are m-/f- prefixed;
//   - the original hand-cut set below (<cut>_<color>). Cuts the catalog redoes are kept
//     `hidden` (files and calibrations stay valid); the rest still show.
// ============================================================

import catalog from './prebakeCatalog.json';

export type HairColor = 'black' | 'brown' | 'blonde';
export type PresetGender = 'man' | 'woman';

export const HAIR_COLOR_LABEL: Record<HairColor, string> = {
  black: 'Black',
  brown: 'Brown',
  blonde: 'Blonde',
};

// Swatch used for the little color dot in the UI.
export const HAIR_COLOR_SWATCH: Record<HairColor, string> = {
  black: '#2b2622',
  brown: '#5a3a22',
  blonde: '#c9a05a',
};

export interface PresetVariant {
  /** Stable id — `${cutId}_${colorKey}`. */
  id: string;
  /** A HairColor bucket (hand-cut set) or a catalog colour key, e.g. "caramelbalayage". */
  color: string;
  /** Display label, e.g. "Blonde" or "Caramel Balayage". */
  label: string;
  /** CSS background for the swatch (a colour, or a gradient for balayage). */
  swatch: string;
  splatUrl: string;
}

export interface HairCut {
  id: string;
  name: string;
  blurb?: string;
  variants: PresetVariant[];
  /** Superseded by a catalog cut: kept so its files and calibrations stay valid, not listed. */
  hidden?: boolean;
}

/** A heading in the try-on list and the cuts under it, in order. */
export interface PresetSection {
  id: string;
  label: string;
  cutIds: string[];
}

export interface PresetCategory {
  id: PresetGender;
  label: string;
  tagline: string;
  /** Every cut, listed ones first (in section order), then hidden ones. */
  cuts: HairCut[];
  sections: PresetSection[];
}

const MEN_DIR = '/prebake/men';
const WOMEN_DIR = '/prebake/women';

// Build a `variant()` bound to a gender's splat directory. The cut id prefixes
// the variant id so ids stay unique across cuts.
function variantMaker(dir: string) {
  return (cutId: string, file: string, color: HairColor, label: string): PresetVariant => ({
    id: `${cutId}_${file}`,
    color,
    label,
    swatch: HAIR_COLOR_SWATCH[color],
    splatUrl: `${dir}/${file}.splat`,
  });
}

const m = variantMaker(MEN_DIR);
const w = variantMaker(WOMEN_DIR);

// The original hand-cut set. Cuts with a catalog equivalent are `hidden`.
const HAND_CUT: Array<Omit<PresetCategory, 'sections'>> = [
  {
    id: 'man',
    label: "Men's",
    tagline: 'Fades, crops & classic cuts',
    cuts: [
      {
        id: 'middlepart',
        hidden: true,
        name: 'Middle Part',
        blurb: 'soft centre part',
        variants: [
          // No "Black + Streaks" / "Light Brown" here: those files were byte-for-byte
          // copies of the Wavy Middle Part ones, so they showed the wrong cut.
          m('middlepart', 'middlepart_black', 'black', 'Black'),
          m('middlepart', 'middlepart_brown', 'brown', 'Brown'),
          m('middlepart', 'middlepart_blonde', 'blonde', 'Blonde'),
          m('middlepart', 'middlepart_blonde2', 'blonde', 'Blonde 2'),
        ],
      },
      {
        id: 'wavymiddlepart',
        hidden: true,
        name: 'Wavy Middle Part',
        blurb: 'textured centre part',
        variants: [
          m('wavymiddlepart', 'wavymiddlepart_black', 'black', 'Black'),
          m('wavymiddlepart', 'wavymiddlepart_blackblondestreaks', 'black', 'Black + Streaks'),
          m('wavymiddlepart', 'wavymiddlepart_lightbrown', 'brown', 'Light Brown'),
        ],
      },
      {
        id: 'wavyfringe',
        hidden: true,
        name: 'Wavy Fringe',
        blurb: 'textured forward fringe',
        variants: [
          m('wavyfringe', 'wavyfringe_black', 'black', 'Black'),
          m('wavyfringe', 'wavyfringe_brown', 'brown', 'Brown'),
          m('wavyfringe', 'wavyfringe_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'topshort',
        name: 'Short Crop',
        blurb: 'tidy short top',
        variants: [
          m('topshort', 'topshort_black', 'black', 'Black'),
          m('topshort', 'topshort_brown', 'brown', 'Brown'),
          m('topshort', 'topshort_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'topcurl',
        name: 'Curly Top',
        blurb: 'volume on top',
        variants: [
          m('topcurl', 'topcurl_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'dreads',
        hidden: true,
        name: 'Dreads',
        blurb: 'rope locs',
        variants: [
          m('dreads', 'dreads_black', 'black', 'Black'),
        ],
      },
    ],
  },
  {
    id: 'woman',
    label: "Women's",
    tagline: 'Layers, lobs & waves',
    cuts: [
      {
        id: 'layeredbob',
        hidden: true,
        name: 'Layered Bob',
        blurb: 'soft layered lob',
        variants: [
          w('layeredbob', 'layeredbob_brown', 'brown', 'Brown'),
          w('layeredbob', 'layeredbob_lightbrown', 'brown', 'Light Brown'),
          w('layeredbob', 'layeredbob_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'onesidedbob',
        hidden: true,
        name: 'Side-Swept Bob',
        blurb: 'asymmetric sweep',
        variants: [
          w('onesidedbob', 'onesidedbob', 'black', 'Black'),
          w('onesidedbob', 'onesidedbob_brownblondehighlights', 'brown', 'Brown + Highlights'),
        ],
      },
      {
        id: 'curtains',
        hidden: true,
        name: 'Curtains',
        blurb: 'centre-parted sweep',
        variants: [
          w('curtains', 'curtains_black', 'black', 'Black'),
          w('curtains', 'curtains_brown', 'brown', 'Brown'),
          w('curtains', 'curtains_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'mediumcurtains',
        hidden: true,
        name: 'Medium Curtains',
        blurb: 'longer curtain layers',
        variants: [
          // No "Black": mediumcurtains.splat is identical to mediumcurtains_blonde.
          w('mediumcurtains', 'mediumcurtains_brown', 'brown', 'Brown'),
          w('mediumcurtains', 'mediumcurtains_brown-blondestreaks', 'brown', 'Brown + Streaks'),
          w('mediumcurtains', 'mediumcurtains_blonde', 'blonde', 'Blonde'),
        ],
      },
    ],
  },
];

// ── The catalog (scripts/prebake-pipeline → prebakeCatalog.json) ─────────────
type CatalogSection = (typeof catalog.genders)['men'][number];
const CATALOG_DIR: Record<PresetGender, 'men' | 'women'> = { man: 'men', woman: 'women' };

/** Placement for catalog prebakes: FaceLift-native, so no per-cut fit (see lib/splatMerge). */
export const CATALOG_PREBAKE_TRANSFORM = catalog.transform;

/** Catalog cuts pulled from the picker (files stay published): judged not good enough on real heads. */
const HIDDEN_CATALOG_CUTS = new Set<string>(['f-halfup']); // Half Up (women), 2026-11-04

function catalogSections(gender: PresetGender): Array<{ section: PresetSection; cuts: HairCut[] }> {
  const dir = CATALOG_DIR[gender];
  return (catalog.genders[dir] as CatalogSection[]).map((s) => ({
    section: { id: s.id, label: s.label, cutIds: s.cuts.filter((c) => !HIDDEN_CATALOG_CUTS.has(c.id)).map((c) => c.id) },
    cuts: s.cuts.filter((c) => !HIDDEN_CATALOG_CUTS.has(c.id)).map((c) => ({
      id: c.id,
      name: c.name,
      blurb: c.blurb,
      variants: c.variants.map((v) => ({
        id: `${c.id}_${v.color}`,
        color: v.color,
        label: v.label,
        swatch: v.swatch,
        splatUrl: `/prebake/${dir}/${v.file}.splat`,
      })),
    })),
  }));
}

/** Ids of every catalog cut (they share CATALOG_PREBAKE_TRANSFORM). */
export const CATALOG_CUT_IDS: string[] = (['man', 'woman'] as const).flatMap((g) =>
  catalogSections(g).flatMap((s) => s.cuts.map((c) => c.id)),
);

/** Per-head vertical fit for a catalog cut (lib/splatFit): the eye-line anchor, the house crown it was built on, and the house hairline. */
export interface CatalogFit { anchorZ: number; crownZ: number; hairlineZ?: number; centerX?: number; widthX?: number }

/**
 * The head the hand-cut set (PREBAKE_CUT_TRANSFORMS) was fitted on: Ethan's buzz-cut base
 * (facelifts/b681e9c8), measured 2026-11-04 with lib/splatFit. The app fits those cuts to each
 * wearer relative to this head the same way catalog cuts are fitted relative to the house heads.
 */
// No centerX: the hand-cut assets are asymmetric (a crop's hair at the temple band sits all on one
// side), so a centre shift derived from the reference head moved them the wrong way (2026-11-04).
export const HAND_FIT_REF: CatalogFit = { anchorZ: 0, crownZ: 0.569, hairlineZ: 0.357, widthX: 0.762 };
const CATALOG_FIT_BY_CUT = new Map<string, CatalogFit>();
// centerX / widthX are measured on the house buzz heads (fit.py) and may not be in the manifest yet.
const CATALOG_FIT = catalog.fit as typeof catalog.fit & { centerX?: Record<string, number>; widthX?: Record<string, number> };
for (const g of ['man', 'woman'] as const) {
  for (const s of catalogSections(g)) {
    for (const c of s.cuts) {
      CATALOG_FIT_BY_CUT.set(c.id, {
        anchorZ: catalog.fit.anchorZ,
        crownZ: catalog.fit.crownZ[CATALOG_DIR[g]],
        hairlineZ: catalog.fit.hairlineZ?.[CATALOG_DIR[g]],
        centerX: CATALOG_FIT.centerX?.[CATALOG_DIR[g]],
        widthX: CATALOG_FIT.widthX?.[CATALOG_DIR[g]],
      });
    }
  }
}
/** The head a cut was fitted on: the house head for catalog cuts, Ethan's base for the hand-cut set. */
export function catalogFitFor(cutId: string | undefined): CatalogFit | null {
  if (!cutId) return null;
  return CATALOG_FIT_BY_CUT.get(cutId) ?? HAND_FIT_REF;
}

export const PRESET_CATEGORIES: PresetCategory[] = HAND_CUT.map((hand) => {
  const fromCatalog = catalogSections(hand.id);
  const listedHandCuts = hand.cuts.filter((c) => !c.hidden);
  const sections: PresetSection[] = [
    ...(listedHandCuts.length ? [{ id: 'short', label: 'Short', cutIds: listedHandCuts.map((c) => c.id) }] : []),
    ...fromCatalog.map((s) => s.section),
  ];
  return {
    ...hand,
    tagline: hand.id === 'man' ? 'Medium, long, curls & tied back' : 'Bobs, long, curls & tied up',
    sections,
    cuts: [...listedHandCuts, ...fromCatalog.flatMap((s) => s.cuts), ...hand.cuts.filter((c) => c.hidden)],
  };
});

export function getCategory(id: PresetGender): PresetCategory | undefined {
  return PRESET_CATEGORIES.find((c) => c.id === id);
}

// Pick the variant to feature for a cut given the user's hair color: prefer a
// matching color, otherwise fall back to the cut's first variant.
export function primaryVariant(cut: HairCut, userColor: HairColor): PresetVariant {
  return cut.variants.find((v) => v.color === userColor) ?? cut.variants[0];
}

// ── Hair-color classification ──────────────────────────────
// Map a hex hair color (profile.currentStyle.colorRGB) to one of our three
// preset buckets by luminance: very dark → black, very light/warm → blonde,
// everything in between → brown.
export function classifyHairColor(hex: string | undefined | null): HairColor {
  if (!hex) return 'brown';
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 'brown';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  // Perceived luminance (0–255).
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 70) return 'black';
  if (lum > 150) return 'blonde';
  return 'brown';
}
