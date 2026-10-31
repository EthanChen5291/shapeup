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
