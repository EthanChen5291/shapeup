import { describe, expect, it } from 'vitest';

import {
  END_BOX_AT, START_NOTE_AT, TIP_DEG, arrivedAt, chargeAt, fallPose, planSpill, poseAt, pullPose, spillScroll, tipAngle, trembleAt,
  type SpillGeometry,
} from './letterSpill';

const N = 36;
const rad = (d: number) => (d * Math.PI) / 180;

/** A layout like the desktop landing: a note at the top, a card under its low end, a step card far below. */
function fixture(over: Partial<SpillGeometry> = {}): SpillGeometry {
  return {
    pivot: { x: 756, y: 1130 },
    restAngle: -1.2,
    lip: 400,
    size: 36,
    letters: Array.from({ length: N }, (_, i) => ({
      s: -360 + (720 * i) / (N - 1),
      n: Math.sin(i * 1.7) * 2,
      tilt: Math.sin(i * 2.3) * 3,
    })),
    table: { left: 765, right: 1360, top: 1397 },
    target: { x: 756, y: 2185 },
    edge: 1512,
    ...over,
  };
}

const geo = fixture();
const plan = planSpill(geo);
const samples = (i: number) => plan.tracks[i].length / 3;
const at = (i: number, j: number) => ({
  x: plan.tracks[i][j * 3], y: plan.tracks[i][j * 3 + 1],
});
/** Letter indices from first to last off the paper. */
const byExit = [...Array(N).keys()].sort((a, b) => plan.exits[a] - plan.exits[b]);

describe('planSpill: the fall', () => {
  it('is deterministic: the same geometry gives the same plan', () => {
    expect(planSpill(fixture())).toEqual(plan);
  });

  it('starts every letter at its resting place on the untipped paper', () => {
    const a = rad(geo.restAngle);
    geo.letters.forEach((L, i) => {
      const p = poseAt(plan, i, 0, 0);
      expect(p.x).toBeCloseTo(geo.pivot.x + L.s * Math.cos(a) - L.n * Math.sin(a), 2);
      expect(p.y).toBeCloseTo(geo.pivot.y + L.s * Math.sin(a) + L.n * Math.cos(a), 2);
      expect(p.rot).toBeCloseTo(geo.restAngle + L.tilt, 2);
      expect(p.scale).toBe(1);
      expect(p.opacity).toBe(1);
    });
  });

  it('lets the letter at the lip end leave first, and spillEnd is the last exit', () => {
    // Each letter has its own grip and drag, so neighbours may swap by a frame or two; letters a
    // few places apart never do.
    const order = [...Array(N).keys()].sort((a, b) => geo.letters[b].s - geo.letters[a].s);
    expect(plan.exits[order[0]]).toBe(Math.min(...plan.exits));
    for (const a of order) {
      for (const b of order) {
        if (geo.letters[a].s - geo.letters[b].s >= 100) expect(plan.exits[a], `${a} before ${b}`).toBeLessThan(plan.exits[b]);
      }
    }
    expect(plan.spillEnd).toBe(Math.max(...plan.exits));
    expect(plan.spillEnd).toBeGreaterThan(plan.exits[order[N - 1]] - 0.2);
    expect(plan.fallTime).toBeGreaterThan(plan.spillEnd);
  });

  it('bounces only on the card surface, at least once per letter, and never sinks into it', () => {
    const { table, size } = geo;
    const surface = table!.top - 0.3 * size;
    for (let i = 0; i < N; i++) {
      expect(plan.bounces[i].length, `letter ${i} bounces`).toBeGreaterThanOrEqual(1);
      for (const b of plan.bounces[i]) {
        expect(b.y).toBeCloseTo(surface, 1);
        expect(b.x).toBeGreaterThanOrEqual(table!.left - size);
        expect(b.x).toBeLessThanOrEqual(table!.right + size);
      }
      for (let j = 0; j < samples(i); j++) {
        const p = at(i, j);
        if (p.x > geo.edge) break;
        if (p.x >= table!.left && p.x <= table!.right) expect(p.y, `letter ${i} sample ${j}`).toBeLessThanOrEqual(surface + 0.5);
      }
    }
  });

  it('flies between the lip and the first bounce on a true ballistic arc', () => {
    const g = 2400, step = plan.step;
    let checked = 0;
    for (let i = 0; i < N; i++) {
      const from = Math.ceil(plan.exits[i] / step) + 2;
      const to = Math.floor(plan.bounces[i][0].t / step) - 2;
      for (let j = from + 1; j <= to - 1; j++) {
        const a = at(i, j - 1), b = at(i, j), c = at(i, j + 1);
        expect(c.y - 2 * b.y + a.y, `letter ${i} y at ${j}`).toBeCloseTo(g * step * step, 1);
        expect(Math.abs(c.x - 2 * b.x + a.x), `letter ${i} x at ${j}`).toBeLessThan(0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(N);
  });

  it('sends every letter past the screen edge and parks it there, still, once the fall is over', () => {
    for (let i = 0; i < N; i++) {
      let maxX = -Infinity;
      for (let j = 0; j < samples(i); j++) maxX = Math.max(maxX, at(i, j).x);
      expect(maxX, `letter ${i}`).toBeGreaterThan(geo.edge);
      const end = fallPose(plan, i, plan.fallTime);
      expect(end.x, `letter ${i} parked`).toBeGreaterThan(geo.edge);
      const later = fallPose(plan, i, plan.fallTime + 5);
      expect(later.x).toBeCloseTo(end.x, 1);
      expect(later.y).toBeCloseTo(end.y, 1);
      // A letter is still turning a little as the fall ends: allow one sample's worth of turn.
      expect(Math.abs(later.rot - end.rot)).toBeLessThan(1);
      // And the letters show as whole while the fall plays, then as the pull takes over.
      expect(poseAt(plan, i, plan.fallTime / 2, 0).opacity).toBe(1);
    }
  });

  it('trembles the card a little at each landing and is still before and long after', () => {
    const hits = plan.bounces.flat().map((b) => b.t).sort((a, b) => a - b);
    expect(trembleAt(plan, hits[0] - 0.01)).toBe(0);
    let peak = 0;
    for (let t = hits[0]; t <= hits[hits.length - 1] + 1; t += 0.002) {
      const v = trembleAt(plan, t);
      expect(Math.abs(v)).toBeLessThanOrEqual(0.2);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.01);
    expect(trembleAt(plan, hits[hits.length - 1] + 1)).toBe(0);
  });
});

describe('planSpill: the pull', () => {
  const byExit = [...Array(N).keys()].sort((a, b) => plan.exits[a] - plan.exits[b]);

  it('begins exactly where the fall ended', () => {
    for (let i = 0; i < N; i++) {
      const a = fallPose(plan, i, plan.fallTime), b = pullPose(plan, i, 0);
      expect(b.x, `letter ${i} x`).toBeCloseTo(a.x, 0);
      expect(b.y, `letter ${i} y`).toBeCloseTo(a.y, 0);
      expect(Math.abs(b.rot - a.rot), `letter ${i} rot`).toBeLessThan(1); // within one sample's turn
      expect(b.scale).toBe(1);
      expect(b.opacity).toBe(1);
    }
  });

  it('ends at the target, invisible', () => {
    for (let i = 0; i < N; i++) {
      for (const t of [plan.pullTime, 0.998 * plan.pullTime]) {
        const end = poseAt(plan, i, plan.fallTime, t);
        expect(Math.abs(end.x - geo.target.x)).toBeLessThan(geo.size);
        expect(Math.abs(end.y - geo.target.y)).toBeLessThan(geo.size);
        expect(end.opacity, `letter ${i} at ${t}`).toBe(0);
      }
    }
  });

  it('delivers the letters one after another in exit order, spread over a good second and a half', () => {
    for (let k = 1; k < N; k++) expect(plan.arrivals[byExit[k]]).toBeGreaterThan(plan.arrivals[byExit[k - 1]]);
    expect(plan.arrivals[byExit[N - 1]]).toBeLessThan(plan.pullTime);
    expect(plan.pullTime - plan.arrivals[byExit[N - 1]]).toBeLessThan(0.2);
    expect(plan.arrivals[byExit[N - 1]] - plan.arrivals[byExit[0]]).toBeCloseTo(1.6, 2);
  });

  it('pulls each letter in faster and faster', () => {
    for (let i = 0; i < N; i++) {
      const end = plan.arrivals[i], span = 1;
      const dist = (a: number, b: number) => {
        const p = pullPose(plan, i, a), q = pullPose(plan, i, b);
        return Math.hypot(q.x - p.x, q.y - p.y);
      };
      const third = span / 3;
      expect(dist(end - third, end), `letter ${i}`).toBeGreaterThan(dist(end - span, end - span + third));
    }
  });

  it('fills the box a share with every letter, smoothly, and it is full when the last one is in', () => {
    const first = Math.min(...plan.arrivals), last = Math.max(...plan.arrivals);
    let prev = 0;
    for (let k = 0; k <= 2000; k++) {
      const c = chargeAt(plan, (plan.pullTime * k) / 2000);
      expect(c).toBeGreaterThanOrEqual(prev);
      // No jumps: a letter's share comes in gradually as it enters.
      expect(c - prev).toBeLessThan(0.02);
      prev = c;
    }
    expect(chargeAt(plan, 0)).toBe(0);
    expect(chargeAt(plan, first - 0.2)).toBe(0);
    // Exactly full at the last arrival, not some time after it.
    expect(chargeAt(plan, last)).toBe(1);
    expect(chargeAt(plan, plan.pullTime)).toBe(1);
    // The level tracks the letters that are in: never behind them, at most a few letters ahead.
    for (const a of plan.arrivals) {
      const share = arrivedAt(plan, a) / N;
      expect(chargeAt(plan, a)).toBeGreaterThanOrEqual(share - 1e-9);
      expect(chargeAt(plan, a)).toBeLessThan(share + 0.15);
    }
  });

  it('counts the letters that have gone in', () => {
    const first = Math.min(...plan.arrivals);
    expect(arrivedAt(plan, 0)).toBe(0);
    expect(arrivedAt(plan, first - 1e-6)).toBe(0);
    expect(arrivedAt(plan, first)).toBe(1);
    expect(arrivedAt(plan, plan.pullTime)).toBe(N);
  });

  it('copes with no card under the lip and with no letters', () => {
    const bare = planSpill(fixture({ table: null }));
    expect(bare.fallTime).toBeGreaterThan(0);
    expect(bare.tracks).toHaveLength(N);
    expect(bare.bounces.every((b) => b.length === 0)).toBe(true);
    expect(poseAt(bare, 0, bare.fallTime, bare.pullTime).opacity).toBe(0);

    const empty = planSpill(fixture({ letters: [] }));
    expect(empty.tracks).toEqual([]);
    expect(empty.pullTime).toBeGreaterThan(0);
    expect(chargeAt(empty, 1)).toBe(0);
    expect(arrivedAt(empty, 1)).toBe(0);
    expect(trembleAt(empty, 1)).toBe(0);
  });
});

describe('tipAngle', () => {
  it('is 0 before the release and comes to rest at TIP_DEG, never past it', () => {
    expect(tipAngle(0)).toBe(0);
    expect(tipAngle(-1)).toBe(0);
    expect(tipAngle(10)).toBe(TIP_DEG);
    for (let t = 0; t <= 5; t += 0.005) expect(tipAngle(t)).toBeLessThanOrEqual(TIP_DEG + 1e-9);
  });

  it('falls like a dropped thing: slowly at first, then faster and faster, not at a steady rate', () => {
    const samples = Array.from({ length: 400 }, (_, k) => tipAngle(k * 0.005));
    const landed = samples.findIndex((a) => a >= TIP_DEG - 0.05);
    expect(landed).toBeGreaterThan(40); // it takes a moment (over 0.2 s)
    // Half way through the fall it has covered only about a quarter of the way.
    expect(samples[Math.round(landed / 2)]).toBeLessThan(TIP_DEG * 0.32);
    // Every step of the fall is bigger than the one before.
    for (let k = 2; k < landed - 1; k++) expect(samples[k] - samples[k - 1]).toBeGreaterThan(samples[k - 1] - samples[k - 2] - 1e-9);
  });

  it('bounces when it lands: lifts back a little, each time less, and is still within two seconds', () => {
    const at = (t: number) => tipAngle(t);
    let t = 0;
    while (at(t) < TIP_DEG - 1e-6) t += 0.001;
    // The first rebound lifts the end back by more than a degree, but nowhere near all the way.
    let dip = TIP_DEG, end = t;
    for (let u = t; u < t + 0.6; u += 0.001) { if (at(u) < dip) { dip = at(u); end = u; } }
    expect(TIP_DEG - dip).toBeGreaterThan(1);
    expect(TIP_DEG - dip).toBeLessThan(3);
    // A later rebound is smaller.
    let second = TIP_DEG;
    for (let u = end + 0.25; u < end + 0.6; u += 0.001) second = Math.min(second, at(u));
    expect(TIP_DEG - second).toBeLessThan(TIP_DEG - dip);
    for (let u = 2; u < 3; u += 0.01) expect(at(u)).toBe(TIP_DEG);
  });
});

describe('spillScroll', () => {
  it('tips the note high on the screen and ends the pull with the box near its top', () => {
    const s = spillScroll({ noteY: 1130, boxTop: 2185, viewport: 897 });
    expect(END_BOX_AT).toBe(0.76);
    expect(s.start).toBeCloseTo(1130 - START_NOTE_AT * 897, 6);
    expect(s.pullEnd).toBeCloseTo(2185 - 0.76 * 897, 6);
    // As much of the stretch between the tip and the end as there is, up to 55% of the screen.
    expect(s.pullEnd - s.pullStart).toBeCloseTo(Math.min(Math.min(560, Math.max(300, 0.55 * 897)), s.pullEnd - s.start - 60), 6);
    expect(spillScroll({ noteY: 1130, boxTop: 4000, viewport: 897 }).pullEnd - spillScroll({ noteY: 1130, boxTop: 4000, viewport: 897 }).pullStart).toBeCloseTo(0.55 * 897, 6);
    expect(s.pullStart).toBeGreaterThan(s.start);
  });

  it('keeps a usable range when the box sits close to the note', () => {
    const s = spillScroll({ noteY: 300, boxTop: 700, viewport: 897 });
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.pullStart).toBeGreaterThanOrEqual(s.start + 60);
    expect(s.pullEnd).toBeGreaterThan(s.pullStart);
    expect(spillScroll({ noteY: 50, boxTop: 5000, viewport: 897 }).start).toBe(0);
  });
});
