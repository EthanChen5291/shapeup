import { describe, expect, test } from 'vitest';
import {
  FACE_LANDMARKS,
  REFERENCE_METRICS,
  agreement,
  medianMetrics,
  metricsFromLandmarks,
  shapeFrom,
  signalsFrom,
  type FaceMetrics,
  type FacePoint,
} from './faceShape';

/**
 * Build a synthetic landmark array with the given proportions. Only the eight
 * indices the measurement reads are populated — everything else is padding, the
 * same way a real mesh carries 460 points this module never looks at.
 */
function face({
  length = REFERENCE_METRICS.lengthRatio,
  jaw = REFERENCE_METRICS.jawRatio,
  forehead = REFERENCE_METRICS.foreheadRatio,
  cheekWidth = 1,
  roll = 0,
}: Partial<{
  length: number;
  jaw: number;
  forehead: number;
  cheekWidth: number;
  roll: number;
}> = {}): FacePoint[] {
  const points: FacePoint[] = Array.from({ length: 468 }, () => ({ x: 0, y: 0 }));
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const put = (index: number, x: number, y: number) => {
    points[index] = { x: x * cos - y * sin, y: x * sin + y * cos };
  };

  const half = cheekWidth / 2;
  put(FACE_LANDMARKS.cheekLeft, -half, 0);
  put(FACE_LANDMARKS.cheekRight, half, 0);
  put(FACE_LANDMARKS.top, 0, -(length * cheekWidth) / 2);
  put(FACE_LANDMARKS.chin, 0, (length * cheekWidth) / 2);
  put(FACE_LANDMARKS.jawLeft, -(jaw * cheekWidth) / 2, half);
  put(FACE_LANDMARKS.jawRight, (jaw * cheekWidth) / 2, half);
  put(FACE_LANDMARKS.browLeft, -(forehead * cheekWidth) / 2, -half);
  put(FACE_LANDMARKS.browRight, (forehead * cheekWidth) / 2, -half);
  return points;
}

describe('metricsFromLandmarks', () => {
  test('recovers the proportions it was built from', () => {
    const metrics = metricsFromLandmarks(face({ length: 1.6, jaw: 0.9, forehead: 0.7 }));
    expect(metrics).not.toBeNull();
    expect(metrics!.lengthRatio).toBeCloseTo(1.6, 5);
    expect(metrics!.jawRatio).toBeCloseTo(0.9, 5);
    expect(metrics!.foreheadRatio).toBeCloseTo(0.7, 5);
  });

  test('is scale-free — sitting closer to the camera changes nothing', () => {
    const near = metricsFromLandmarks(face({ length: 1.6, cheekWidth: 3 }));
    const far = metricsFromLandmarks(face({ length: 1.6, cheekWidth: 0.4 }));
    expect(near!.lengthRatio).toBeCloseTo(far!.lengthRatio, 5);
    expect(near!.jawRatio).toBeCloseTo(far!.jawRatio, 5);
  });

  test('survives head roll, which is why distances are euclidean', () => {
    const upright = metricsFromLandmarks(face({ length: 1.6, jaw: 0.9 }));
    const cocked = metricsFromLandmarks(face({ length: 1.6, jaw: 0.9, roll: 0.5 }));
    expect(cocked!.lengthRatio).toBeCloseTo(upright!.lengthRatio, 5);
    expect(cocked!.jawRatio).toBeCloseTo(upright!.jawRatio, 5);
  });

  test('rejects a mesh missing the points it needs', () => {
    expect(metricsFromLandmarks([])).toBeNull();
    const short = face();
    short[FACE_LANDMARKS.chin] = { x: NaN, y: 0 };
    expect(metricsFromLandmarks(short)).toBeNull();
  });

  test('rejects a degenerate zero-width face rather than dividing by it', () => {
    expect(metricsFromLandmarks(face({ cheekWidth: 0 }))).toBeNull();
  });
});

describe('signalsFrom', () => {
  test('a balanced face produces no signal at all', () => {
    const signals = signalsFrom(REFERENCE_METRICS);
    expect(signals.elongation).toBe(0);
    expect(signals.jawStrength).toBe(0);
    expect(signals.foreheadWidth).toBe(0);
  });

  test('small departures stay inside the deadzone', () => {
    const signals = signalsFrom({ ...REFERENCE_METRICS, lengthRatio: REFERENCE_METRICS.lengthRatio + 0.05 });
    expect(signals.elongation).toBe(0);
  });

  test('a longer face reads positive, a rounder one negative', () => {
    expect(signalsFrom({ ...REFERENCE_METRICS, lengthRatio: 1.85 }).elongation).toBeGreaterThan(0);
    expect(signalsFrom({ ...REFERENCE_METRICS, lengthRatio: 1.05 }).elongation).toBeLessThan(0);
  });

  test('signals are monotonic in the ratio', () => {
    const at = (lengthRatio: number) => signalsFrom({ ...REFERENCE_METRICS, lengthRatio }).elongation;
    expect(at(1.6)).toBeLessThan(at(1.7));
    expect(at(1.7)).toBeLessThan(at(1.8));
  });

  test('saturates at ±1 so one extreme measurement cannot dominate', () => {
    expect(signalsFrom({ ...REFERENCE_METRICS, lengthRatio: 99 }).elongation).toBe(1);
    expect(signalsFrom({ ...REFERENCE_METRICS, jawRatio: -99 }).jawStrength).toBe(-1);
  });
});

describe('shapeFrom', () => {
  test('names nothing when nothing is pronounced', () => {
    expect(shapeFrom({ elongation: 0, jawStrength: 0, foreheadWidth: 0 })).toBe('oval');
    expect(shapeFrom({ elongation: 0.2, jawStrength: 0.1, foreheadWidth: 0.2 })).toBe('oval');
  });

  test('names the dominant departure', () => {
    expect(shapeFrom({ elongation: 0.8, jawStrength: 0.1, foreheadWidth: 0 })).toBe('oblong');
    expect(shapeFrom({ elongation: -0.8, jawStrength: 0, foreheadWidth: 0 })).toBe('round');
    expect(shapeFrom({ elongation: 0.1, jawStrength: 0.9, foreheadWidth: 0 })).toBe('square');
    expect(shapeFrom({ elongation: 0, jawStrength: 0, foreheadWidth: 0.9 })).toBe('heart');
    expect(shapeFrom({ elongation: 0, jawStrength: 0, foreheadWidth: -0.9 })).toBe('diamond');
  });

  test('a weak jaw never reads as square', () => {
    expect(shapeFrom({ elongation: 0, jawStrength: -0.9, foreheadWidth: 0 })).toBe('oval');
  });
});

describe('medianMetrics and agreement', () => {
  const sample = (lengthRatio: number): FaceMetrics => ({ ...REFERENCE_METRICS, lengthRatio });

  test('the median ignores a single wild frame', () => {
    const median = medianMetrics([sample(1.4), sample(1.42), sample(9), sample(1.41), sample(1.43)]);
    expect(median!.lengthRatio).toBeCloseTo(1.42, 5);
  });

  test('no samples means no measurement', () => {
    expect(medianMetrics([])).toBeNull();
    expect(agreement([])).toBe(0);
  });

  test('a still face agrees with itself; a moving one does not', () => {
    const still = [sample(1.5), sample(1.505), sample(1.495), sample(1.5)];
    const moving = [sample(1.1), sample(1.9), sample(1.3), sample(1.75)];
    expect(agreement(still)).toBeGreaterThan(0.8);
    expect(agreement(moving)).toBe(0);
  });

  test('one frame is never enough to be confident', () => {
    expect(agreement([sample(1.5)])).toBe(0);
  });
});
