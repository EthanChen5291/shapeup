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
// ============================================================

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
  color: HairColor;
  /** Display label, e.g. "Blonde" or "Blonde 2". */
  label: string;
  splatUrl: string;
}

export interface HairCut {
  id: string;
  name: string;
  blurb?: string;
  variants: PresetVariant[];
}

export interface PresetCategory {
  id: PresetGender;
  label: string;
  tagline: string;
  cuts: HairCut[];
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
    splatUrl: `${dir}/${file}.splat`,
  });
}

const m = variantMaker(MEN_DIR);
const w = variantMaker(WOMEN_DIR);

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: 'man',
    label: "Men's",
    tagline: 'Fades, crops & classic cuts',
    cuts: [
      {
        id: 'middlepart',
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
        name: 'Side-Swept Bob',
        blurb: 'asymmetric sweep',
        variants: [
          w('onesidedbob', 'onesidedbob', 'black', 'Black'),
          w('onesidedbob', 'onesidedbob_brownblondehighlights', 'brown', 'Brown + Highlights'),
        ],
      },
      {
        id: 'curtains',
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
