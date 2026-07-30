import { describe, expect, test } from 'vitest';
import { pickAngleFrames, samplesAfterPrompt, type FrameSample } from './angleSelection';
import { SPIN_STARTS_AT_MS } from './angles';

/**
 * A synthetic take: five seconds held at the front, then a steady rotation
 * through a full turn. `backFrom`/`backTo` mark the window where the head is
 * turned far enough that no face is detectable.
 */
function spinTake({
  durationMs = 30_000,
  stepMs = 250,
  sharpness = 100,
  backFrom = 14_000,
  backTo = 20_000,
}: Partial<{
  durationMs: number;
  stepMs: number;
  sharpness: number;
  backFrom: number;
  backTo: number;
}> = {}): FrameSample[] {
  const samples: FrameSample[] = [];
  const spinSpan = durationMs - SPIN_STARTS_AT_MS;
  for (let tMs = 0; tMs < durationMs; tMs += stepMs) {
    const faceless = tMs >= backFrom && tMs < backTo;
    // 0° through +360° across the spin: right side first, then the back, then
    // the left side, back to the front.
    const raw = tMs < SPIN_STARTS_AT_MS ? 0 : ((tMs - SPIN_STARTS_AT_MS) / spinSpan) * 360;
    const yaw = raw > 180 ? raw - 360 : raw;
    samples.push({
      tMs,
      yawDeg: faceless ? null : yaw,
      faceFound: !faceless,
      sharpness,
    });
  }
  return samples;
}

describe('pickAngleFrames — measured takes', () => {
  test('a full rotation yields the whole reference sheet, in reading order', () => {
    const picks = pickAngleFrames(spinTake());
    expect(picks.map((p) => p.key)).toEqual([
      'leftProfile',
      'leftThreeQuarter',
      'front',
      'rightThreeQuarter',
      'rightProfile',
      'back',
    ]);
  });

  test('each pick actually sits at the angle it claims', () => {
    const picks = pickAngleFrames(spinTake());
    const byKey = Object.fromEntries(picks.map((p) => [p.key, p.yawDeg]));
    expect(Math.abs(byKey.front)).toBeLessThan(16);
    expect(byKey.rightThreeQuarter).toBeGreaterThan(15);
    expect(byKey.rightThreeQuarter).toBeLessThan(55);
    expect(byKey.rightProfile).toBeGreaterThan(52);
    expect(byKey.leftProfile).toBeLessThan(-52);
    expect(byKey.leftThreeQuarter).toBeGreaterThan(-55);
    expect(byKey.leftThreeQuarter).toBeLessThan(-15);
  });

  test('no two angles are served by the same frame', () => {
    const picks = pickAngleFrames(spinTake());
    const indices = picks.map((p) => p.sampleIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  test('an angle the client never reached is left out rather than approximated', () => {
    // The client only ever turned ~30° each way — no profile exists in this take.
    const samples: FrameSample[] = [];
    for (let tMs = 0; tMs < 20_000; tMs += 250) {
      samples.push({
        tMs,
        yawDeg: 30 * Math.sin((tMs / 20_000) * 2 * Math.PI),
        faceFound: true,
        sharpness: 100,
      });
    }
    const keys = pickAngleFrames(samples).map((p) => p.key);
    expect(keys).toContain('front');
    expect(keys).not.toContain('leftProfile');
    expect(keys).not.toContain('rightProfile');
  });

  test('among frames at the same angle, the sharpest one wins', () => {
    const samples: FrameSample[] = [
      { tMs: 0, yawDeg: 0, faceFound: true, sharpness: 10 },
      { tMs: 250, yawDeg: 0, faceFound: true, sharpness: 900 },
      { tMs: 500, yawDeg: 0, faceFound: true, sharpness: 40 },
    ];
    const front = pickAngleFrames(samples).find((p) => p.key === 'front');
    expect(front?.tMs).toBe(250);
  });

  test('a slight blur is preferred over a badly-off angle', () => {
    const samples: FrameSample[] = [
      // Dead-on but a little soft.
      { tMs: 0, yawDeg: 0, faceFound: true, sharpness: 300 },
      // Tack sharp, but 14° off — a misleading "front" reference.
      { tMs: 250, yawDeg: 14, faceFound: true, sharpness: 1000 },
    ];
    const front = pickAngleFrames(samples).find((p) => p.key === 'front');
    expect(front?.yawDeg).toBe(0);
  });

  test('the back comes from the longest faceless run, not a stray dropped frame', () => {
    const samples = spinTake({ backFrom: 14_000, backTo: 20_000 });
    // A single blink early in the take must not be mistaken for the back.
    samples[8] = { ...samples[8], yawDeg: null, faceFound: false };

    const back = pickAngleFrames(samples).find((p) => p.key === 'back');
    expect(back).toBeDefined();
    expect(back!.tMs).toBeGreaterThanOrEqual(14_000);
    expect(back!.tMs).toBeLessThan(20_000);
  });

  test('a take with no faceless stretch simply has no back angle', () => {
    const picks = pickAngleFrames(spinTake({ backFrom: -1, backTo: -1 }));
    expect(picks.map((p) => p.key)).not.toContain('back');
  });

  test('confidence stays inside 0–1', () => {
    for (const pick of pickAngleFrames(spinTake())) {
      expect(pick.confidence).toBeGreaterThanOrEqual(0);
      expect(pick.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('pickAngleFrames — the fallback when nothing could be measured', () => {
  const unmeasured = (): FrameSample[] =>
    Array.from({ length: 120 }, (_, i) => ({
      tMs: i * 250,
      yawDeg: null,
      faceFound: false,
      sharpness: 50,
    }));

  test('still produces a full sheet from the coach script alone', () => {
    const picks = pickAngleFrames(unmeasured());
    expect(picks).toHaveLength(6);
  });

  test('marks every pick as unverified so the UI can flag them', () => {
    for (const pick of pickAngleFrames(unmeasured())) {
      expect(pick.confidence).toBe(0);
    }
  });

  test('places the front inside the hold and the back mid-rotation', () => {
    const picks = pickAngleFrames(unmeasured());
    const front = picks.find((p) => p.key === 'front');
    const back = picks.find((p) => p.key === 'back');
    expect(front!.tMs).toBeLessThan(SPIN_STARTS_AT_MS);
    expect(back!.tMs).toBeGreaterThan(SPIN_STARTS_AT_MS);
  });

  test('still never reuses a frame', () => {
    const indices = pickAngleFrames(unmeasured()).map((p) => p.sampleIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

describe('pickAngleFrames — degenerate input', () => {
  test('an empty take yields nothing rather than throwing', () => {
    expect(pickAngleFrames([])).toEqual([]);
  });

  test('a zero-length take yields nothing', () => {
    expect(pickAngleFrames([{ tMs: 0, yawDeg: null, faceFound: false, sharpness: 0 }])).toEqual([]);
  });

  test('uniform zero sharpness does not let the focus score decide anything', () => {
    const flat = spinTake({ sharpness: 0 });
    expect(pickAngleFrames(flat).map((p) => p.key)).toContain('front');
  });
});

describe('samplesAfterPrompt — only the final look is a reference', () => {
  const at = (tMs: number, faceFound = true): FrameSample => ({
    tMs,
    yawDeg: faceFound ? 0 : null,
    faceFound,
    sharpness: 100,
  });

  test('a take that was never re-steered keeps every frame', () => {
    const samples = [at(0), at(1000), at(2000)];
    expect(samplesAfterPrompt(samples, 0)).toBe(samples);
  });

  test('frames before the last ask (plus the settle window) are dropped', () => {
    const samples = [at(0), at(5000), at(10_000), at(15_000), at(20_000)];
    const kept = samplesAfterPrompt(samples, 8000, 1000);
    expect(kept.map((s) => s.tMs)).toEqual([10_000, 15_000, 20_000]);
  });

  test('a re-steer near the end falls back to the whole take rather than an empty sheet', () => {
    const samples = [at(0), at(5000), at(10_000), at(28_000)];
    // Only one frame survives the cutoff — not enough to build from.
    expect(samplesAfterPrompt(samples, 27_000, 500)).toBe(samples);
  });

  test('faceless frames after the cutoff do not count toward "enough to build from"', () => {
    const samples = [at(0), at(5000), at(10_000, false), at(11_000, false), at(12_000, false)];
    expect(samplesAfterPrompt(samples, 9000, 500)).toBe(samples);
  });
});
