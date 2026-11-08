import { describe, expect, it } from 'vitest';
import { crownFitScale, crownZ } from './splatFit';
import { SPLAT_ROW } from './splatMerge';

function rows(specs: Array<{ pos: [number, number, number]; alpha: number }>) {
  const buf = new ArrayBuffer(specs.length * SPLAT_ROW);
  specs.forEach((s, i) => {
    new Float32Array(buf, i * SPLAT_ROW, 6).set([...s.pos, 0.01, 0.01, 0.01]);
    new Uint8Array(buf, i * SPLAT_ROW + 24, 8).set([200, 200, 200, Math.round(s.alpha * 255), 128, 128, 128, 255]);
  });
  return buf;
}

// Deterministic pseudo-random positions over one column cell.
function column(count: number, zLo: number, zHi: number, alpha: number, seed: number) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return Array.from({ length: count }, () => ({
    pos: [-0.05 + rnd() * 0.1, 0.1 + rnd() * 0.1, zLo + rnd() * (zHi - zLo)] as [number, number, number],
    alpha,
  }));
}

describe('crownZ', () => {
  it('finds the solid top and walks through a sheer halo above it', () => {
    const solid = column(200, 0, 0.6, 0.6, 1);
    const halo = column(15, 0.6, 0.75, 0.02, 2); // 15 × alpha 0.02 blocks ~26%: still see-through
    const z = crownZ(rows([...halo, ...solid]));
    expect(z).not.toBeNull();
    expect(Math.abs((z as number) - 0.6)).toBeLessThan(0.02);
  });

  it('ignores sparse cells and points outside the crown columns', () => {
    const outside = column(200, 0, 0.9, 0.9, 3).map((p) => ({ ...p, pos: [p.pos[0] + 0.5, p.pos[1], p.pos[2]] as [number, number, number] }));
    const sparse = column(10, 0, 0.9, 0.9, 4);
    expect(crownZ(rows([...outside, ...sparse]))).toBeNull();
    expect(crownZ(new ArrayBuffer(0))).toBeNull();
  });

  it('reads a Uint8Array view at any byte offset', () => {
    const solid = column(100, 0, 0.5, 0.9, 5);
    const buf = rows(solid);
    const padded = new Uint8Array(buf.byteLength + 3);
    padded.set(new Uint8Array(buf), 3);
    expect(crownZ(padded.subarray(3))).toEqual(crownZ(buf));
  });
});

describe('crownFitScale', () => {
  it('scales about the anchor so the house crown lands on the wearer', () => {
    expect(crownFitScale(0.569, 0.638, 0)).toBeCloseTo(0.569 / 0.638, 6);
    expect(crownFitScale(0.62, 0.6, 0.2)).toBe(1); // taller than the house: never stretch
  });

  it('clamps to a modest squash, never stretches, and falls back to 1', () => {
    expect(crownFitScale(0.1, 0.638, 0)).toBe(0.7);
    expect(crownFitScale(2, 0.638, 0)).toBe(1);
    expect(crownFitScale(0.5, 0, 0)).toBe(1);
  });
});

// ---- hairline ----
import { HAIRLINE_OVERLAP, axisFitScale, hairlineFit, hairlineZ, headCenterX, headDepthY, headWidthX } from './splatFit';

const LIGHT_SKIN = [220, 190, 170], DARK_STUBBLE = [40, 35, 30];

/** A buzz-cut front: skin-coloured rows on the face plane below `hairline`, stubble-coloured above it. */
function buzzFront(hairline: number, opts: { columns?: number[]; bald?: boolean; perColumnHairline?: Record<string, number>; skin?: number[]; stubble?: number[] } = {}) {
  const specs: Array<{ pos: [number, number, number]; alpha: number; rgb: number[] }> = [];
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const skin = opts.skin ?? LIGHT_SKIN, stubble = opts.stubble ?? DARK_STUBBLE;
  for (const xc of opts.columns ?? [-0.1, 0, 0.1]) {
    const hl = opts.perColumnHairline?.[String(xc)] ?? hairline;
    for (let z = 0; z < 0.62; z += 0.01) {
      for (let i = 0; i < 6; i++) {
        const hair = !opts.bald && z >= hl;
        specs.push({ pos: [xc - 0.04 + rnd() * 0.08, -0.5 + z * 0.1 + rnd() * 0.02, z], alpha: 0.8, rgb: hair ? stubble : skin });
        // the back of the head is dark but faces away (y > 0): must be ignored
        specs.push({ pos: [xc - 0.04 + rnd() * 0.08, 0.2 + rnd() * 0.1, z], alpha: 0.8, rgb: [40, 35, 30] });
      }
    }
  }
  const buf = new ArrayBuffer(specs.length * SPLAT_ROW);
  specs.forEach((sp, i) => {
    new Float32Array(buf, i * SPLAT_ROW, 6).set([...sp.pos, 0.01, 0.01, 0.01]);
    new Uint8Array(buf, i * SPLAT_ROW + 24, 8).set([...sp.rgb, Math.round(sp.alpha * 255), 128, 128, 128, 255]);
  });
  return buf;
}

describe('hairlineZ', () => {
  it('finds where the front turns from light skin to dark stubble, within 0.01', () => {
    const z = hairlineZ(buzzFront(0.3), 0.55);
    expect(z).not.toBeNull();
    expect(Math.abs((z as number) - 0.3)).toBeLessThan(0.01);
  });

  it('finds it on dark skin under black stubble (no brightness floor)', () => {
    // skin RGB (0.25, 0.17, 0.12), stubble (0.06, 0.05, 0.04): never bright enough for a luma rule
    const z = hairlineZ(buzzFront(0.3, { skin: [64, 43, 31], stubble: [15, 12, 10] }), 0.55);
    expect(z).not.toBeNull();
    expect(Math.abs((z as number) - 0.3)).toBeLessThan(0.01);
  });

  it('finds it under platinum stubble that is brighter than the skin', () => {
    // skin (0.75, 0.6, 0.5), stubble (0.85, 0.8, 0.7): brightness never drops, only the colour shifts
    const z = hairlineZ(buzzFront(0.3, { skin: [191, 153, 128], stubble: [217, 204, 179] }), 0.55);
    expect(z).not.toBeNull();
    expect(Math.abs((z as number) - 0.3)).toBeLessThan(0.01);
  });

  it('is null when the colour never changes (bald, or stubble the colour of the skin)', () => {
    expect(hairlineZ(buzzFront(0.3, { bald: true }), 0.55)).toBeNull();
    expect(hairlineZ(buzzFront(0.3, { skin: [64, 43, 31], stubble: [64, 43, 31] }), 0.55)).toBeNull();
  });

  it('is null when the three columns disagree, when a column is missing, or when it is implausible', () => {
    expect(hairlineZ(buzzFront(0.3, { perColumnHairline: { '0.1': 0.45 } }), 0.55)).toBeNull();
    expect(hairlineZ(buzzFront(0.3, { columns: [-0.1, 0] }), 0.55)).toBeNull();
    expect(hairlineZ(buzzFront(0.3), 0.33)).toBeNull(); // too close to the crown
    expect(hairlineZ(buzzFront(0.06), 0.55)).toBeNull(); // on the brows
    expect(hairlineZ(new ArrayBuffer(0))).toBeNull();
  });
});

describe('hairlineFit', () => {
  const house = { anchorZ: 0, crownZ: 0.638, hairlineZ: 0.35 };

  it('maps house hairline → wearer hairline (minus the overlap) and house crown → wearer crown, continuous', () => {
    const fit = hairlineFit({ crown: 0.51, hairline: 0.33 }, house);
    const target = 0.33 - HAIRLINE_OVERLAP;
    expect(fit.hairline).toBeDefined();
    expect(fit.hairline!.house).toBe(0.35);
    expect(fit.hairline!.wearer).toBeCloseTo(target, 6);
    expect(fit.hairline!.scaleBelow).toBeCloseTo(target / 0.35, 6);
    // above: (0.51 - 0.305) / (0.638 - 0.35) = 0.71
    expect(fit.scale).toBeCloseTo((0.51 - target) / (0.638 - 0.35), 6);
    const fit2 = hairlineFit({ crown: 0.6, hairline: 0.33 }, house);
    expect(fit2.scale).toBeCloseTo((0.6 - target) / (0.638 - 0.35), 6);
  });

  it('may stretch the crown band a little (taller skull), never past 1.25, and squashes down to 0.7', () => {
    expect(hairlineFit({ crown: 0.9, hairline: 0.33 }, house).scale).toBe(1.25);
    expect(hairlineFit({ crown: 0.35, hairline: 0.33 }, house).scale).toBe(0.7);
  });

  it('falls back to the one-point crown fit without a usable hairline', () => {
    const noWearer = hairlineFit({ crown: 0.569, hairline: null }, house);
    expect(noWearer.hairline).toBeUndefined();
    expect(noWearer.scale).toBeCloseTo(0.569 / 0.638, 6);
    const noHouse = hairlineFit({ crown: 0.569, hairline: 0.33 }, { anchorZ: 0, crownZ: 0.638 });
    expect(noHouse.hairline).toBeUndefined();
  });

  it('keeps the segments continuous when the fringe band is clamped', () => {
    const fit = hairlineFit({ crown: 0.6, hairline: 0.6 }, house); // absurdly high wearer hairline → scaleBelow clamps at 1.4
    expect(fit.hairline!.scaleBelow).toBe(1.4);
    expect(fit.hairline!.wearer).toBeCloseTo(0.35 * 1.4, 6);
  });
});

describe('head width and centre', () => {
  // A temple band: rows across x in [-0.4, 0.4] shifted by `center`, at z 0.2–0.3 on the front half.
  function temple(center: number, halfWidth: number, count = 600) {
    const specs: Array<{ pos: [number, number, number]; alpha: number; rgb: number[] }> = [];
    let s = 3;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let i = 0; i < count; i++) {
      specs.push({ pos: [center - halfWidth + rnd() * 2 * halfWidth, -0.3 + rnd() * 0.3, 0.2 + rnd() * 0.1], alpha: 0.8, rgb: [200, 180, 160] });
      specs.push({ pos: [rnd() * 2 - 1, 0.3, 0.25], alpha: 0.8, rgb: [40, 40, 40] }); // back of the head: ignored (y ≥ 0.15)
      specs.push({ pos: [rnd() * 2 - 1, -0.3, 0.05], alpha: 0.8, rgb: [40, 40, 40] }); // eye line: outside the band
    }
    const buf = new ArrayBuffer(specs.length * SPLAT_ROW);
    specs.forEach((sp, i) => {
      new Float32Array(buf, i * SPLAT_ROW, 6).set([...sp.pos, 0.01, 0.01, 0.01]);
      new Uint8Array(buf, i * SPLAT_ROW + 24, 8).set([...sp.rgb, Math.round(sp.alpha * 255), 128, 128, 128, 255]);
    });
    return buf;
  }

  it('measures width and centre at the temple band only', () => {
    const w = headWidthX(temple(0.05, 0.38));
    expect(w).not.toBeNull();
    expect(Math.abs((w as number) - 0.76)).toBeLessThan(0.04);
    expect(Math.abs((headCenterX(temple(0.05, 0.38)) as number) - 0.05)).toBeLessThan(0.02);
    expect(headWidthX(temple(0, 0.38, 20))).toBeNull(); // too thin to trust
    expect(headWidthX(new ArrayBuffer(0))).toBeNull();
  });

  it('measures depth over the whole band, forehead to the back of the head', () => {
    // Front rows span y −0.3…0 and the back-of-head rows sit at y 0.3: depth ≈ 0.6, and the
    // back rows count here although width ignores them.
    const d = headDepthY(temple(0.05, 0.38));
    expect(d).not.toBeNull();
    expect(Math.abs((d as number) - 0.6)).toBeLessThan(0.04);
    expect(headDepthY(temple(0, 0.38, 20))).toBeNull();
    expect(headDepthY(new ArrayBuffer(0))).toBeNull();
  });

  it('turns them into a clamped size factor and a centring shift, no-ops when unknown', () => {
    expect(axisFitScale(0.8, 0.76)).toBeCloseTo(0.8 / 0.76, 6);
    expect(axisFitScale(2, 0.76)).toBe(1.2);
    expect(axisFitScale(0.1, 0.76)).toBe(0.85);
    expect(axisFitScale(null, 0.76)).toBe(1);
    expect(axisFitScale(0.8, undefined)).toBe(1);
  });
});
