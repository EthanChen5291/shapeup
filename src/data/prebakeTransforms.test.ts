import { describe, expect, it } from 'vitest';
import { PREBAKE_DEFAULT_TRANSFORM } from '@/lib/splatMerge';
import { PRESET_CATEGORIES } from '@/data/hairPresets';
import { PREBAKE_CUT_TRANSFORMS, resolvePrebakeTransform, samePrebakeTransform } from './prebakeTransforms';

describe('resolvePrebakeTransform', () => {
  it('falls back to the default for an unknown cut', () => {
    expect(resolvePrebakeTransform('nope')).toEqual(PREBAKE_DEFAULT_TRANSFORM);
  });

  it('layers cut and variant overrides over the default', () => {
    PREBAKE_CUT_TRANSFORMS.testcut = { scale: 2.5, alpha: 1.4 };
    PREBAKE_CUT_TRANSFORMS.testcut_blonde = { dz: -0.1 };
    try {
      expect(resolvePrebakeTransform('testcut')).toEqual({ ...PREBAKE_DEFAULT_TRANSFORM, scale: 2.5, alpha: 1.4 });
      expect(resolvePrebakeTransform('testcut', 'testcut_blonde')).toEqual({ ...PREBAKE_DEFAULT_TRANSFORM, scale: 2.5, alpha: 1.4, dz: -0.1 });
    } finally {
      delete PREBAKE_CUT_TRANSFORMS.testcut;
      delete PREBAKE_CUT_TRANSFORMS.testcut_blonde;
    }
  });

  it('compares transforms field by field', () => {
    expect(samePrebakeTransform(PREBAKE_DEFAULT_TRANSFORM, { ...PREBAKE_DEFAULT_TRANSFORM })).toBe(true);
    expect(samePrebakeTransform(PREBAKE_DEFAULT_TRANSFORM, { ...PREBAKE_DEFAULT_TRANSFORM, dx: 0.01 })).toBe(false);
  });

  it('has a baked fit for every preset cut, and every key names a real cut or variant', () => {
    const cuts = PRESET_CATEGORIES.flatMap((c) => c.cuts);
    const ids = new Set(cuts.flatMap((c) => [c.id, ...c.variants.map((v) => v.id)]));
    for (const cut of cuts) expect(PREBAKE_CUT_TRANSFORMS[cut.id], cut.id).toBeDefined();
    for (const key of Object.keys(PREBAKE_CUT_TRANSFORMS)) expect(ids.has(key), key).toBe(true);
  });
});

describe('catalog cuts', () => {
  it('place FaceLift-native hair at k = 1 with no offsets or alpha boost', async () => {
    const { CATALOG_CUT_IDS } = await import('@/data/hairPresets');
    expect(CATALOG_CUT_IDS).toHaveLength(50);
    for (const id of CATALOG_CUT_IDS) {
      expect(resolvePrebakeTransform(id, `${id}_x`)).toEqual({ ...PREBAKE_DEFAULT_TRANSFORM, scale: 2.772, dx: 0, dy: 0, dz: 0, alpha: 1 });
    }
  });
});
