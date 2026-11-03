import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_CATEGORIES } from './hairPresets';

const variants = PRESET_CATEGORIES.flatMap((c) => c.cuts.flatMap((cut) => cut.variants));
const PUBLIC = join(__dirname, '..', '..', 'public');
// .splat files are gitignored, so they only exist on machines that have the assets.
const haveAssets = variants.every((v) => existsSync(join(PUBLIC, v.splatUrl)));

describe('hair presets', () => {
  it('has unique variant ids and splat files', () => {
    expect(new Set(variants.map((v) => v.id)).size).toBe(variants.length);
    expect(new Set(variants.map((v) => v.splatUrl)).size).toBe(variants.length);
  });

  it.skipIf(!haveAssets)('never offers the same splat twice under different names', () => {
    const byHash = new Map<string, string>();
    for (const v of variants) {
      const hash = createHash('sha1').update(readFileSync(join(PUBLIC, v.splatUrl))).digest('hex');
      expect(byHash.get(hash), `${v.splatUrl} duplicates ${byHash.get(hash)}`).toBeUndefined();
      byHash.set(hash, v.splatUrl);
    }
  });
});

describe('catalog + sections', () => {
  for (const category of PRESET_CATEGORIES) {
    it(`${category.id}: every listed cut is in exactly one section, hidden cuts in none`, () => {
      const inSections = category.sections.flatMap((s) => s.cutIds);
      const listed = category.cuts.filter((c) => !c.hidden).map((c) => c.id);
      expect(new Set(inSections).size).toBe(inSections.length);
      expect([...inSections].sort()).toEqual([...listed].sort());
      for (const hidden of category.cuts.filter((c) => c.hidden)) expect(inSections).not.toContain(hidden.id);
    });

    it(`${category.id}: 25 catalog cuts x 6 colours, named <cut>-<color> under the gender folder`, () => {
      const prefix = category.id === 'man' ? 'm-' : 'f-';
      const dir = category.id === 'man' ? 'men' : 'women';
      const cuts = category.cuts.filter((c) => c.id.startsWith(prefix));
      expect(cuts).toHaveLength(25);
      for (const cut of cuts) {
        expect(cut.variants).toHaveLength(6);
        for (const v of cut.variants) {
          expect(v.splatUrl).toBe(`/prebake/${dir}/${cut.id.slice(2)}-${v.color}.splat`);
          expect(v.swatch).toBeTruthy();
        }
      }
    });
  }

  it('keeps the hand-cut styles the catalog redoes, hidden, and lists the rest', () => {
    const all = new Map(PRESET_CATEGORIES.flatMap((c) => c.cuts).map((c) => [c.id, c]));
    for (const id of ['middlepart', 'wavymiddlepart', 'wavyfringe', 'dreads', 'layeredbob', 'onesidedbob', 'curtains', 'mediumcurtains']) {
      expect(all.get(id)?.hidden, id).toBe(true);
    }
    expect(all.get('topshort')?.hidden).toBeFalsy();
    expect(all.get('topcurl')?.hidden).toBeFalsy();
  });
});
