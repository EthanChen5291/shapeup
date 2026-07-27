// ============================================================
// What each cut DOES to a head, as five numbers.
//
// The recommendation laws (recommend.ts) reason about shape, not about cut
// names: "a long face wants width at the sides" is a statement about volume,
// and it can only be applied to a catalog entry that says how much width it
// puts there. This file is that translation, and it is the only editorial
// judgement in the feature.
//
// Why a separate file rather than fields on src/data/hairstyles.ts: the catalog
// is shared with the studio and the barber card, and its `desc` strings are
// pinned to generated preview art by hairstyles.test.ts. These five numbers are
// a chair-mode concern, so they live beside the chair's other rules and are
// keyed by slug. cutGeometry.test.ts pins this table to the catalog, so adding
// a cut without describing its shape fails the build rather than silently
// dropping it out of every recommendation.
//
// Each value is 0–1 against the catalog as a whole, NOT against all possible
// hair — 0.5 is an average cut in this catalog, which is what makes `centered`
// in recommend.ts meaningful. They were read off the same `desc` strings the
// preview art was generated from, so a cut's numbers describe the picture the
// barber is actually tapping.
// ============================================================

import { HAIRSTYLES } from '@/data/hairstyles';

export interface CutGeometry {
  /** Height and lift above the crown. Adds apparent LENGTH to a face. */
  topVolume: number;
  /** Fullness at the sides, above and around the ears. Adds apparent WIDTH. */
  sideVolume: number;
  /** How much forehead the hair covers. Visually SHORTENS a face. */
  fringe: number;
  /** Hair falling alongside the cheeks and jaw. Widens the LOWER face. */
  cheekCoverage: number;
  /** Blunt, hard, geometric lines vs soft texture. ECHOES an angular jaw. */
  angularity: number;
}

/**
 * Keyed by `Hairstyle['slug']`. Every catalog slug must appear — see the test.
 */
export const CUT_GEOMETRY: Record<string, CutGeometry> = {
  // ── mens ──
  'low-taper-fade-textured-fringe': { topVolume: 0.35, sideVolume: 0.15, fringe: 0.6, cheekCoverage: 0.05, angularity: 0.3 },
  'textured-crop-skin-fade': { topVolume: 0.3, sideVolume: 0.02, fringe: 0.7, cheekCoverage: 0.02, angularity: 0.5 },
  'modern-mullet-faded-sides': { topVolume: 0.45, sideVolume: 0.12, fringe: 0.2, cheekCoverage: 0.15, angularity: 0.55 },
  'blowout-taper': { topVolume: 0.85, sideVolume: 0.3, fringe: 0.05, cheekCoverage: 0.02, angularity: 0.15 },
  'edgar-cut-high-fade': { topVolume: 0.2, sideVolume: 0.02, fringe: 0.95, cheekCoverage: 0.02, angularity: 0.9 },
  'wolf-cut-light-layers': { topVolume: 0.6, sideVolume: 0.45, fringe: 0.4, cheekCoverage: 0.35, angularity: 0.3 },
  'curtain-fringe-mid-fade': { topVolume: 0.45, sideVolume: 0.15, fringe: 0.75, cheekCoverage: 0.15, angularity: 0.2 },
  'comma-hair-low-taper': { topVolume: 0.45, sideVolume: 0.2, fringe: 0.6, cheekCoverage: 0.1, angularity: 0.2 },
  'afro-taper-sponge-curls': { topVolume: 0.8, sideVolume: 0.25, fringe: 0.05, cheekCoverage: 0.02, angularity: 0.15 },
  'two-block-soft-layers': { topVolume: 0.5, sideVolume: 0.5, fringe: 0.45, cheekCoverage: 0.4, angularity: 0.25 },
  'slick-back-undercut': { topVolume: 0.6, sideVolume: 0.05, fringe: 0.02, cheekCoverage: 0.02, angularity: 0.5 },
  'side-part-pompadour': { topVolume: 0.95, sideVolume: 0.15, fringe: 0.02, cheekCoverage: 0.02, angularity: 0.6 },
  'french-crop-hard-part': { topVolume: 0.3, sideVolume: 0.05, fringe: 0.7, cheekCoverage: 0.02, angularity: 0.75 },
  'mid-taper-with-waves': { topVolume: 0.15, sideVolume: 0.1, fringe: 0.02, cheekCoverage: 0.02, angularity: 0.4 },
  'buzz-cut-clean-line-up': { topVolume: 0.05, sideVolume: 0.02, fringe: 0.02, cheekCoverage: 0.02, angularity: 0.85 },
  'fluffy-crop-low-fade': { topVolume: 0.55, sideVolume: 0.2, fringe: 0.5, cheekCoverage: 0.05, angularity: 0.1 },
  'wavy-perm-middle-part': { topVolume: 0.5, sideVolume: 0.45, fringe: 0.5, cheekCoverage: 0.35, angularity: 0.1 },
  'broccoli-perm-taper-fade': { topVolume: 0.75, sideVolume: 0.2, fringe: 0.15, cheekCoverage: 0.02, angularity: 0.1 },
  'textured-mod-fringe': { topVolume: 0.4, sideVolume: 0.45, fringe: 0.8, cheekCoverage: 0.4, angularity: 0.3 },
  'k-pop-perm-curtain-bangs': { topVolume: 0.5, sideVolume: 0.4, fringe: 0.7, cheekCoverage: 0.3, angularity: 0.1 },
  'burst-fade-textured-fringe': { topVolume: 0.4, sideVolume: 0.1, fringe: 0.65, cheekCoverage: 0.05, angularity: 0.35 },
  'bro-flow-swept-back': { topVolume: 0.6, sideVolume: 0.5, fringe: 0.05, cheekCoverage: 0.35, angularity: 0.1 },
  'twist-out-taper': { topVolume: 0.65, sideVolume: 0.15, fringe: 0.05, cheekCoverage: 0.02, angularity: 0.35 },
  'caesar-cut-textured-fringe': { topVolume: 0.2, sideVolume: 0.05, fringe: 0.85, cheekCoverage: 0.02, angularity: 0.7 },
  'spiky-eboy-mid-fade': { topVolume: 0.6, sideVolume: 0.05, fringe: 0.45, cheekCoverage: 0.02, angularity: 0.45 },
  'perm-mullet-taper-fade': { topVolume: 0.6, sideVolume: 0.2, fringe: 0.15, cheekCoverage: 0.15, angularity: 0.25 },

  // ── womens ──
  'long-layers-curtain-bangs': { topVolume: 0.3, sideVolume: 0.55, fringe: 0.7, cheekCoverage: 0.6, angularity: 0.1 },
  'collarbone-bob-soft-waves': { topVolume: 0.3, sideVolume: 0.6, fringe: 0.05, cheekCoverage: 0.65, angularity: 0.3 },
  'shaggy-wolf-cut-wispy-ends': { topVolume: 0.65, sideVolume: 0.5, fringe: 0.45, cheekCoverage: 0.5, angularity: 0.15 },
  'blunt-lob-center-part': { topVolume: 0.15, sideVolume: 0.5, fringe: 0.02, cheekCoverage: 0.7, angularity: 0.85 },
  'butterfly-layers-face-framing': { topVolume: 0.5, sideVolume: 0.6, fringe: 0.35, cheekCoverage: 0.7, angularity: 0.1 },
  'french-bob-micro-fringe': { topVolume: 0.25, sideVolume: 0.55, fringe: 0.9, cheekCoverage: 0.75, angularity: 0.75 },
  'beachy-waves-long-layers': { topVolume: 0.3, sideVolume: 0.55, fringe: 0.1, cheekCoverage: 0.5, angularity: 0.1 },
  'pixie-cut-textured-crop': { topVolume: 0.5, sideVolume: 0.1, fringe: 0.5, cheekCoverage: 0.05, angularity: 0.4 },
  'money-piece-balayage-layers': { topVolume: 0.25, sideVolume: 0.5, fringe: 0.3, cheekCoverage: 0.65, angularity: 0.15 },
  'curly-shag-volume-on-top': { topVolume: 0.85, sideVolume: 0.6, fringe: 0.3, cheekCoverage: 0.5, angularity: 0.1 },
  'sleek-straight-middle-part': { topVolume: 0.05, sideVolume: 0.35, fringe: 0.02, cheekCoverage: 0.6, angularity: 0.6 },
  'choppy-bixie-cut': { topVolume: 0.55, sideVolume: 0.35, fringe: 0.35, cheekCoverage: 0.4, angularity: 0.3 },
  'feathered-layers-side-bangs': { topVolume: 0.45, sideVolume: 0.55, fringe: 0.55, cheekCoverage: 0.55, angularity: 0.1 },
  'voluminous-blowout-soft-curls': { topVolume: 0.7, sideVolume: 0.7, fringe: 0.15, cheekCoverage: 0.4, angularity: 0.05 },
  'half-up-bun-loose-waves': { topVolume: 0.6, sideVolume: 0.4, fringe: 0.1, cheekCoverage: 0.45, angularity: 0.15 },
  'jellyfish-cut-blunt-crown': { topVolume: 0.35, sideVolume: 0.6, fringe: 0.2, cheekCoverage: 0.55, angularity: 0.8 },
  'butterfly-blowout-curtain-bangs': { topVolume: 0.6, sideVolume: 0.65, fringe: 0.65, cheekCoverage: 0.6, angularity: 0.05 },
  'birkin-layers-wispy-bangs': { topVolume: 0.3, sideVolume: 0.5, fringe: 0.6, cheekCoverage: 0.55, angularity: 0.05 },
  'italian-bob-blunt-ends': { topVolume: 0.4, sideVolume: 0.65, fringe: 0.05, cheekCoverage: 0.8, angularity: 0.8 },
  'octopus-cut-choppy-layers': { topVolume: 0.5, sideVolume: 0.4, fringe: 0.25, cheekCoverage: 0.4, angularity: 0.35 },
  'hush-cut-curtain-bangs': { topVolume: 0.3, sideVolume: 0.5, fringe: 0.7, cheekCoverage: 0.6, angularity: 0.05 },
  'c-curl-perm-shoulder-length': { topVolume: 0.35, sideVolume: 0.55, fringe: 0.1, cheekCoverage: 0.6, angularity: 0.15 },
  'spiral-perm-voluminous-curls': { topVolume: 0.8, sideVolume: 0.85, fringe: 0.15, cheekCoverage: 0.55, angularity: 0.05 },
  'soft-body-perm-long-layers': { topVolume: 0.4, sideVolume: 0.55, fringe: 0.1, cheekCoverage: 0.5, angularity: 0.05 },
  'modern-shag-micro-bangs': { topVolume: 0.7, sideVolume: 0.5, fringe: 0.85, cheekCoverage: 0.45, angularity: 0.5 },
  'mixie-cut-textured-pixie': { topVolume: 0.5, sideVolume: 0.15, fringe: 0.4, cheekCoverage: 0.1, angularity: 0.4 },
};

/**
 * The shape of an average catalog cut. A slug with no entry falls back to this
 * and therefore scores exactly 0 under every law — it keeps its place in the
 * house order rather than being pushed to the bottom for missing data.
 */
export const NEUTRAL_GEOMETRY: CutGeometry = {
  topVolume: 0.5,
  sideVolume: 0.5,
  fringe: 0.5,
  cheekCoverage: 0.5,
  angularity: 0.5,
};

export function geometryFor(slug: string): CutGeometry {
  return CUT_GEOMETRY[slug] ?? NEUTRAL_GEOMETRY;
}

/** Slugs in the catalog with no geometry described. Empty in a healthy build. */
export function missingGeometrySlugs(): string[] {
  return HAIRSTYLES.filter((cut) => !CUT_GEOMETRY[cut.slug]).map((cut) => cut.slug);
}
