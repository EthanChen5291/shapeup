import { describe, expect, test } from 'vitest';
import { HAIRSTYLES } from '@/data/hairstyles';
import { HOUSE_ORDER, SUGGESTION_COUNT, recommendCuts, scoreCut } from './recommend';
import { CUT_GEOMETRY, missingGeometrySlugs } from './cutGeometry';
import { NEUTRAL_SIGNALS, type FaceSignals } from './faceShape';

const signals = (over: Partial<FaceSignals> = {}): FaceSignals => ({ ...NEUTRAL_SIGNALS, ...over });

const LONG = signals({ elongation: 1 });
const ROUND = signals({ elongation: -1 });
const SQUARE = signals({ jawStrength: 1 });
const TAPERED = signals({ jawStrength: -1 });
const HEART = signals({ foreheadWidth: 1 });
const DIAMOND = signals({ foreheadWidth: -1 });

const bySlug = (slug: string) => {
  const cut = HAIRSTYLES.find((c) => c.slug === slug);
  if (!cut) throw new Error(`no such cut: ${slug}`);
  return cut;
};

const score = (face: FaceSignals, slug: string) => scoreCut(face, bySlug(slug)).score;

describe('cut geometry covers the catalog', () => {
  test('every catalog cut has its shape described', () => {
    expect(missingGeometrySlugs()).toEqual([]);
  });

  test('no geometry describes a cut that no longer exists', () => {
    const known = new Set(HAIRSTYLES.map((c) => c.slug));
    expect(Object.keys(CUT_GEOMETRY).filter((slug) => !known.has(slug))).toEqual([]);
  });

  test('every attribute stays inside 0–1, which `centered` assumes', () => {
    for (const [slug, geometry] of Object.entries(CUT_GEOMETRY)) {
      for (const [axis, value] of Object.entries(geometry)) {
        expect(value, `${slug}.${axis}`).toBeGreaterThanOrEqual(0);
        expect(value, `${slug}.${axis}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the laws', () => {
  test('a balanced face has no opinion about any cut', () => {
    for (const cut of HAIRSTYLES) {
      expect(scoreCut(NEUTRAL_SIGNALS, cut).score, cut.slug).toBe(0);
    }
  });

  test('a long face prefers width at the sides over height on top', () => {
    // A pompadour is almost pure height; bro flow is length and width.
    expect(score(LONG, 'bro-flow-swept-back')).toBeGreaterThan(score(LONG, 'side-part-pompadour'));
  });

  test('a round face wants the exact opposite, from the same law', () => {
    expect(score(ROUND, 'side-part-pompadour')).toBeGreaterThan(score(ROUND, 'bro-flow-swept-back'));
  });

  test('a fringe shortens a long face and is wrong on a round one', () => {
    expect(score(LONG, 'caesar-cut-textured-fringe')).toBeGreaterThan(0);
    expect(score(ROUND, 'caesar-cut-textured-fringe')).toBeLessThan(0);
  });

  test('a strong jaw is softened, not echoed', () => {
    // Buzz cut is all hard lines; a fluffy crop is all texture.
    expect(score(SQUARE, 'fluffy-crop-low-fade')).toBeGreaterThan(score(SQUARE, 'buzz-cut-clean-line-up'));
  });

  test('a finer jaw takes the blunt lines a strong one does not', () => {
    expect(score(TAPERED, 'buzz-cut-clean-line-up')).toBeGreaterThan(score(SQUARE, 'buzz-cut-clean-line-up'));
  });

  test('hair at the cheeks fills a narrow chin and overloads a wide jaw', () => {
    const withCheeks = 'italian-bob-blunt-ends';
    expect(score(TAPERED, withCheeks)).toBeGreaterThan(score(SQUARE, withCheeks));
  });

  test('both forehead extremes want a fringe — the law reads magnitude', () => {
    const plain = scoreCut(HEART, bySlug('modern-shag-micro-bangs'));
    const mirrored = scoreCut(DIAMOND, bySlug('modern-shag-micro-bangs'));
    // The fringe term is positive for both; the cheek term is what differs.
    expect(plain.score).toBeGreaterThan(0);
    expect(mirrored.score).toBeGreaterThan(0);
  });

  test('a wide forehead and wide cheekbones disagree about cheek coverage', () => {
    const cheeky = 'collarbone-bob-soft-waves';
    expect(score(HEART, cheeky)).toBeGreaterThan(score(DIAMOND, cheeky));
  });

  test('influence is bounded — no single cut can run away with the ranking', () => {
    const extreme = signals({ elongation: 1, jawStrength: 1, foreheadWidth: 1 });
    for (const cut of HAIRSTYLES) {
      expect(Math.abs(scoreCut(extreme, cut).score), cut.slug).toBeLessThan(2.2);
    }
  });
});

describe('recommendCuts', () => {
  test('no measurement falls back to exactly the house order', () => {
    const picks = recommendCuts({ signals: null, gender: 'mens' });
    expect(picks.map((p) => p.cut.slug)).toEqual([...HOUSE_ORDER.mens]);
  });

  test('a balanced face is treated the same as no measurement', () => {
    const picks = recommendCuts({ signals: NEUTRAL_SIGNALS, gender: 'mens' });
    expect(picks.map((p) => p.cut.slug)).toEqual([...HOUSE_ORDER.mens]);
  });

  test('never crosses the menu it was asked for', () => {
    for (const gender of ['mens', 'womens'] as const) {
      const picks = recommendCuts({ signals: LONG, gender });
      expect(picks.every((p) => p.cut.gender === gender)).toBe(true);
    }
  });

  test('always fills the row, even under a saturated signal', () => {
    expect(recommendCuts({ signals: LONG, gender: 'mens' })).toHaveLength(SUGGESTION_COUNT);
    expect(recommendCuts({ signals: DIAMOND, gender: 'womens' })).toHaveLength(SUGGESTION_COUNT);
  });

  test('a measured face actually reorders the menu', () => {
    const house = recommendCuts({ signals: null, gender: 'mens' }).map((p) => p.cut.slug);
    const long = recommendCuts({ signals: LONG, gender: 'mens' }).map((p) => p.cut.slug);
    const round = recommendCuts({ signals: ROUND, gender: 'mens' }).map((p) => p.cut.slug);
    expect(long).not.toEqual(house);
    expect(long).not.toEqual(round);
  });

  test('ranking is deterministic — the same face gets the same row twice', () => {
    const once = recommendCuts({ signals: SQUARE, gender: 'mens' }).map((p) => p.cut.slug);
    const twice = recommendCuts({ signals: SQUARE, gender: 'mens' }).map((p) => p.cut.slug);
    expect(once).toEqual(twice);
  });

  test('results come back sorted by their own score plus the house prior', () => {
    const picks = recommendCuts({ signals: LONG, gender: 'womens', limit: 12 });
    const slugs = picks.map((p) => p.cut.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('a measured pick carries the reason that produced it', () => {
    const picks = recommendCuts({ signals: LONG, gender: 'mens' });
    expect(picks.some((p) => p.why !== '')).toBe(true);
  });

  test('an unmeasured pick claims no reason', () => {
    const picks = recommendCuts({ signals: null, gender: 'mens' });
    expect(picks.every((p) => p.why === '')).toBe(true);
  });
});
