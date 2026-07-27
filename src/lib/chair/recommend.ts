// ============================================================
// The face laws — ranking the catalog for the head that's actually in the chair.
//
// These are the rules barbers already work from, written as arithmetic instead
// of as a lookup table. Every law is one sentence of barbering:
//
//   a long face is lengthened further by height on top      → less topVolume
//   …and balanced by width at the sides                     → more sideVolume
//   …and visually shortened by a fringe                     → more fringe
//   a strong jaw is echoed by hard lines, softened by texture → less angularity
//   …and made heavier by hair sitting on it                 → less cheekCoverage
//   a narrow chin is filled out by hair at the cheeks       → more cheekCoverage
//   an unbalanced forehead is evened out by a fringe        → more fringe
//
// A ROUND face is not a separate set of rules — it is the same laws with the
// elongation signal negative, so every term flips on its own. That's the whole
// reason the signals are signed and continuous (faceShape.ts): six named shapes
// would need six tables and would snap at the boundaries between them.
//
// Two properties this design buys, both of which matter more than the ranking:
//
//  * NO SIGNAL, NO CHANGE. An oval face, a failed measurement, or a client who
//    never held still all produce zero signal, every law contributes zero, and
//    the order falls back exactly to HOUSE_ORDER — the six cuts the chair
//    already showed before this feature existed. The feature can only refine.
//
//  * BOUNDED INFLUENCE. Every law is a signal in −1…1 times a centred
//    attribute in −0.5…0.5, so the total is bounded (~±2.1) against a house
//    prior of 0.5. Recommendations reorder the menu; they can't replace it.
//
// Pure and browser-free — the laws are unit-tested on synthetic signals.
// ============================================================

import { HAIRSTYLES, type Gender, type Hairstyle } from '@/data/hairstyles';
import { geometryFor, type CutGeometry } from './cutGeometry';
import type { FaceSignals } from './faceShape';

/**
 * The house order — what the chair shows before it knows anything about the
 * face, and the tie-break underneath every recommendation. These are the
 * quick-pick cuts the style screen has always led with.
 */
export const HOUSE_ORDER: Record<Gender, readonly string[]> = {
  mens: [
    'low-taper-fade-textured-fringe',
    'textured-crop-skin-fade',
    'modern-mullet-faded-sides',
    'blowout-taper',
    'edgar-cut-high-fade',
    'afro-taper-sponge-curls',
  ],
  womens: [
    'long-layers-curtain-bangs',
    'collarbone-bob-soft-waves',
    'butterfly-layers-face-framing',
    'beachy-waves-long-layers',
    'blunt-lob-center-part',
    'shaggy-wolf-cut-wispy-ends',
  ],
};

/** How many suggestions the chair shows at once. Six fits a tablet row twice. */
export const SUGGESTION_COUNT = 6;

/**
 * How much the house order counts when no law has an opinion. Deliberately
 * smaller than a saturated law set: familiarity breaks ties, it doesn't
 * outrank a measured face.
 */
const HOUSE_WEIGHT = 0.5;

/** A contribution has to clear this to be worth explaining to the barber. */
const WHY_FLOOR = 0.08;

/** Centre an attribute so an average catalog cut contributes nothing. */
function centered(value: number): number {
  return value - 0.5;
}

interface Law {
  id: string;
  /** How hard this law pushes, and which way. Zero when the face is balanced. */
  weight(signals: FaceSignals): number;
  /** What the cut offers on this law's axis, centred. */
  fit(geometry: CutGeometry): number;
  /** Barber-facing reason, source-language (EN). Render through t(). */
  positive: string;
  negative: string;
}

/**
 * Each law reads ONE signal against ONE attribute, so the reason shown to the
 * barber is the same arithmetic that produced the rank — not a story told
 * afterwards about a blended score.
 */
const LAWS: readonly Law[] = [
  {
    id: 'height',
    weight: (s) => -0.9 * s.elongation,
    fit: (g) => centered(g.topVolume),
    positive: 'Height on top lengthens a rounder face',
    negative: 'Keeps height down so the face doesn’t read longer',
  },
  {
    id: 'sides',
    weight: (s) => 0.7 * s.elongation,
    fit: (g) => centered(g.sideVolume),
    positive: 'Width at the sides balances a longer face',
    negative: 'Tight sides keep a rounder face from reading wider',
  },
  {
    id: 'fringe-length',
    weight: (s) => 0.6 * s.elongation,
    fit: (g) => centered(g.fringe),
    positive: 'A fringe shortens a longer face',
    negative: 'An open forehead adds length to a rounder face',
  },
  {
    id: 'jaw-softness',
    weight: (s) => -0.6 * s.jawStrength,
    fit: (g) => centered(g.angularity),
    positive: 'Blunt lines give a finer jaw definition',
    negative: 'Soft texture instead of hard lines, against a strong jaw',
  },
  {
    id: 'jaw-weight',
    weight: (s) => -0.4 * s.jawStrength,
    fit: (g) => centered(g.cheekCoverage),
    positive: 'Hair at the cheeks fills out a narrower chin',
    negative: 'Keeps hair off an already strong jaw',
  },
  {
    id: 'brow-balance',
    weight: (s) => 0.5 * s.foreheadWidth,
    fit: (g) => centered(g.cheekCoverage),
    positive: 'Width at the cheeks balances a wider forehead',
    negative: 'Keeps weight off the widest part of the face',
  },
  {
    id: 'fringe-brow',
    // Magnitude, not sign: a broad forehead wants a fringe to narrow it and a
    // narrow one wants a fringe to fill it. Both ends of this axis agree.
    weight: (s) => 0.5 * Math.abs(s.foreheadWidth),
    fit: (g) => centered(g.fringe),
    positive: 'A fringe evens out the forehead',
    negative: 'Leaves the forehead open',
  },
];

/**
 * Every sentence a suggestion can carry. These reach `t()` as variables rather
 * than literals, so the i18n source scan can't find them — this is what the
 * dictionary test checks against instead.
 */
export function suggestionReasons(): string[] {
  return LAWS.flatMap((law) => [law.positive, law.negative]);
}

export interface Recommendation {
  cut: Hairstyle;
  /** Total law score. Positive means the laws favour it over an average cut. */
  score: number;
  /**
   * The single strongest reason, barber-facing and source-language (EN). Empty
   * when nothing measured drove this cut — an unmeasured face, or a cut that
   * simply sits high in the house order.
   */
  why: string;
}

/** Every law's contribution to one cut, strongest first. */
function contributions(signals: FaceSignals, geometry: CutGeometry) {
  return LAWS.map((law) => ({ law, value: law.weight(signals) * law.fit(geometry) })).sort(
    (a, b) => b.value - a.value,
  );
}

export function scoreCut(signals: FaceSignals, cut: Hairstyle): { score: number; why: string } {
  const ranked = contributions(signals, geometryFor(cut.slug));
  const score = ranked.reduce((sum, c) => sum + c.value, 0);
  const best = ranked[0];
  if (!best || best.value < WHY_FLOOR) return { score, why: '' };
  // The law's sentence depends on which way the FACE pushed it, not on the
  // cut: "height lengthens a rounder face" and "keeps height down" are the two
  // halves of one law, and only one of them can be the reason.
  const why = best.law.weight(signals) >= 0 ? best.law.positive : best.law.negative;
  return { score, why };
}

export interface RecommendOptions {
  /** Null or all-zero signals fall back to the house order untouched. */
  signals: FaceSignals | null;
  gender: Gender;
  limit?: number;
  /** Injectable for tests. Defaults to the whole catalog. */
  catalog?: readonly Hairstyle[];
}

/**
 * Rank the catalog for this face. Always returns `limit` cuts — a chair with an
 * empty suggestion row would be worse than one showing the house favourites.
 */
export function recommendCuts({
  signals,
  gender,
  limit = SUGGESTION_COUNT,
  catalog = HAIRSTYLES,
}: RecommendOptions): Recommendation[] {
  const pool = catalog.filter((cut) => cut.gender === gender);
  const house = HOUSE_ORDER[gender];

  // House prior: the quick picks descending, then the rest of the catalog in
  // its own order. Only ever a tie-break — see HOUSE_WEIGHT.
  const priorRank = new Map<string, number>();
  house.forEach((slug, i) => priorRank.set(slug, i));
  pool.forEach((cut) => {
    if (!priorRank.has(cut.slug)) priorRank.set(cut.slug, house.length + priorRank.size);
  });
  const span = Math.max(1, pool.length);
  const prior = (slug: string) =>
    HOUSE_WEIGHT * (1 - Math.min(1, (priorRank.get(slug) ?? span) / span));

  return pool
    .map((cut) => {
      const { score, why } = signals ? scoreCut(signals, cut) : { score: 0, why: '' };
      return { cut, score, why, total: score + prior(cut.slug) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map(({ cut, score, why }) => ({ cut, score, why }));
}
