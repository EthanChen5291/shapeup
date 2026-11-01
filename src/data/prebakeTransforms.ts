// Per-cut placement for the prebaked try-on hair.
//
// Every cut starts from PREBAKE_DEFAULT_TRANSFORM (lib/splatMerge). When a fit
// is off for a particular cut, an admin tunes it live in the studio's try-on
// panel (sliders + Submit) and the values land in the `prebakeCalibrations`
// Convex table. Read them with:
//
//   npx convex run prebakeCalibrations:list
//
// and bake the agreed values here so every user gets them without a lookup.
// Keys are cut ids (hairPresets.ts); a variant id key overrides its cut.

import { PREBAKE_DEFAULT_TRANSFORM, type PrebakeTransform } from '@/lib/splatMerge';

export const PREBAKE_CUT_TRANSFORMS: Record<string, Partial<PrebakeTransform>> = {
  // Baked 2026-10-31 from Ethan's submissions: the newest row per cut (dev
  // deployment, 39 rows over 10 cuts, 20:44–20:53Z). Fit only: every newest row
  // left density at the defaults (alpha 1.4 / headAlpha 1.5), so it's inherited
  // from PREBAKE_DEFAULT_TRANSFORM rather than pinned. Each cut's fit applies to
  // all its colours (they share one hair shape); a colour can still get its own
  // variant-id key later.
  // Men
  middlepart:     { scale: 2.38,  dx: 0.015, dy: -0.035, dz: -0.04 },  // 20:44Z, blonde (latest of 8)
  wavymiddlepart: { scale: 2.38,  dx: 0.02,  dy: -0.145, dz: -0.13 },  // 20:45Z, black + blonde streaks (3)
  wavyfringe:     { scale: 2.365, dx: 0.015, dy: -0.08,  dz: -0.125 }, // 20:47Z, brown (4)
  topshort:       { scale: 2.505, dx: 0,     dy: 0.07,   dz: -0.01 },  // 20:48Z, black (5)
  topcurl:        { scale: 2.455, dx: 0,     dy: 0,      dz: -0.05 },  // 20:49Z, blonde (2)
  dreads:         { scale: 2.355, dx: 0,     dy: 0.03,   dz: -0.03 },  // 20:50Z, black (1)
  // Women
  layeredbob:     { scale: 2.46,  dx: 0,     dy: 0,      dz: -0.05 },  // 20:51Z, blonde (3)
  onesidedbob:    { scale: 2.55,  dx: 0,     dy: 0,      dz: -0.05 },  // 20:51Z, brown + blonde highlights (2)
  curtains:       { scale: 2.72,  dx: 0.025, dy: 0,      dz: -0.085 }, // 20:52Z, black (7)
  mediumcurtains: { scale: 2.74,  dx: 0,     dy: 0,      dz: -0.11 },  // 20:53Z, blonde (4)

  // Per-colour overrides (variant-id keys win over the cut key above). Baked
  // from Ethan's submissions after the cut bake, 23:33–23:35Z; fit only, density
  // left at the defaults. Colours without a key keep their cut's fit.
  wavyfringe_wavyfringe_black:  { scale: 2.365, dx: 0.015, dy: 0.01,  dz: -0.1 },   // 23:33Z
  wavyfringe_wavyfringe_blonde: { scale: 2.38,  dx: 0.02,  dy: -0.02, dz: -0.065 }, // 23:35Z
  topshort_topshort_blonde:     { scale: 2.505, dx: 0,     dy: 0.07,  dz: -0.115 }, // 23:35Z (sits lower than black)
};

export function resolvePrebakeTransform(cutId: string, variantId?: string): PrebakeTransform {
  return {
    ...PREBAKE_DEFAULT_TRANSFORM,
    ...(PREBAKE_CUT_TRANSFORMS[cutId] ?? {}),
    ...((variantId && PREBAKE_CUT_TRANSFORMS[variantId]) || {}),
  };
}

/** Two transforms produce the same merge (used to skip no-op re-merges). */
export function samePrebakeTransform(a: PrebakeTransform, b: PrebakeTransform): boolean {
  return a.scale === b.scale && a.dx === b.dx && a.dy === b.dy && a.dz === b.dz && a.alpha === b.alpha;
}
