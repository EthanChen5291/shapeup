// ============================================================
// Turning a 30-second take into the six frames a barber cuts from.
//
// This is the pure half — no DOM, no model, no canvas — so the selection rules
// are testable on plain numbers. The browser-side half (decoding frames and
// measuring head pose) lives in frames.ts and feeds this.
//
// The rules, in the order they matter:
//
//  1. ANGLE FIRST. A frame is a reference only if the head is actually at the
//     angle claimed. Everything outside a per-angle tolerance is rejected
//     outright — an empty tile the barber can fill by scrubbing is honest; a
//     mislabelled one sends them cutting the wrong line.
//  2. SHARPNESS BREAKS TIES. A spin produces motion blur, and several frames
//     will sit at ±3° of the target. Blur is the difference between "I can see
//     the weight line" and a smear, so it decides between them.
//  3. NO FRAME TWICE. If the client barely turned, front and three-quarter
//     would both land on the same sample and the sheet would lie about having
//     six views. Used samples are consumed.
//  4. THE BACK ISN'T AN ANGLE. There is no face to measure at 180°, so it's
//     found structurally instead: the longest unbroken run of frames where the
//     detector saw no face is the far side of the rotation.
//
// When no frame carries a measurement at all — landmarker failed to load, bad
// lighting, a mask — selection falls back to the coach script's timing alone
// (see angles.ts) and marks every pick with zero confidence, so the chair can
// tell the barber to check them rather than passing guesses off as data.
// ============================================================

import { ANGLE_SPECS, SPIN_STARTS_AT_MS, type AngleKey } from './angles';

export interface FrameSample {
  tMs: number;
  /**
   * Measured head yaw in degrees, or null when nothing could be measured.
   * Positive = the head turned toward the camera's right, presenting the
   * client's RIGHT side to the lens (see convex/lib/chair.ts).
   */
  yawDeg: number | null;
  /** Whether a face was detected at all. `back` is inferred from runs of false. */
  faceFound: boolean;
  /** Focus measure (Laplacian variance). Arbitrary scale; normalized here. */
  sharpness: number;
}

export interface AnglePick {
  key: AngleKey;
  /** Index into the sample array the frame came from. */
  sampleIndex: number;
  tMs: number;
  yawDeg: number;
  /** 0–1. Zero means "picked by timing alone — check this one". */
  confidence: number;
}

/**
 * How long the model needs after a re-steer before the mirror actually shows
 * the new ask. Frames inside this window are the OLD look mid-morph — worse
 * than either style as a reference.
 */
export const PROMPT_SETTLE_MS = 1200;

/**
 * Only the frames filmed after the client's LAST ask (plus the settle window)
 * are honest references for what they approved — everything earlier shows a
 * style they steered away from. Falls back to the full take when the re-steer
 * came so late there's nothing usable after it: a thin tail should cost the
 * sheet its accuracy note, not the sheet.
 */
export function samplesAfterPrompt(
  samples: FrameSample[],
  lastPromptTMs: number,
  settleMs: number = PROMPT_SETTLE_MS,
): FrameSample[] {
  if (lastPromptTMs <= 0) return samples;
  const cutoff = lastPromptTMs + settleMs;
  const after = samples.filter((s) => s.tMs >= cutoff);
  const facesAfter = after.filter((s) => s.faceFound).length;
  return facesAfter >= 2 ? after : samples;
}

/**
 * How far off-target a frame may sit and still count. Profiles get the widest
 * band: nobody stops exactly at 80°, and the detector's yaw gets noisier as the
 * face turns away. Front is tightest — a front reference that's 20° off is
 * exactly the frame a barber would misread.
 */
const TOLERANCE_DEG: Record<AngleKey, number> = {
  front: 16,
  leftThreeQuarter: 20,
  rightThreeQuarter: 20,
  leftProfile: 28,
  rightProfile: 28,
  back: 0, // unused — `back` is found structurally
};

/** Angle accuracy outweighs sharpness, but sharpness still has to matter. */
const ANGLE_WEIGHT = 0.65;
const SHARPNESS_WEIGHT = 0.35;

/** A faceless stretch shorter than this is a blink or a dropped frame, not the back. */
const MIN_BACK_RUN = 2;

function normalizeSharpness(samples: FrameSample[]): number[] {
  const max = samples.reduce((m, s) => Math.max(m, s.sharpness), 0);
  if (!(max > 0)) return samples.map(() => 0.5); // no signal — don't let it decide
  return samples.map((s) => Math.min(1, Math.max(0, s.sharpness / max)));
}

/**
 * The longest unbroken run of face-less frames — the far side of the spin.
 * Returns the sharpest frame in that run, or null when no run is long enough.
 */
function findBackFrame(
  samples: FrameSample[],
  sharpNorm: number[],
  used: Set<number>,
): { index: number; runLength: number } | null {
  let best: { start: number; length: number } | null = null;
  let runStart = -1;

  for (let i = 0; i <= samples.length; i += 1) {
    const faceless = i < samples.length && !samples[i].faceFound;
    if (faceless) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0) {
      const length = i - runStart;
      if (!best || length > best.length) best = { start: runStart, length };
      runStart = -1;
    }
  }

  if (!best || best.length < MIN_BACK_RUN) return null;

  let pick = -1;
  let pickScore = -1;
  for (let i = best.start; i < best.start + best.length; i += 1) {
    if (used.has(i)) continue;
    if (sharpNorm[i] > pickScore) {
      pickScore = sharpNorm[i];
      pick = i;
    }
  }
  return pick < 0 ? null : { index: pick, runLength: best.length };
}

/**
 * Pick one representative frame per angle.
 *
 * Angles that nothing in the take satisfies are simply absent from the result —
 * the caller renders them as empty tiles with a scrubber rather than filling
 * them with the nearest wrong frame.
 */
export function pickAngleFrames(samples: FrameSample[]): AnglePick[] {
  if (samples.length === 0) return [];

  const measured = samples.some((s) => s.yawDeg !== null && s.faceFound);
  if (!measured) return pickByCoachTiming(samples);

  const sharpNorm = normalizeSharpness(samples);
  const used = new Set<number>();
  const picks: AnglePick[] = [];

  // Profiles first, then three-quarters, then front: the hardest angles to hit
  // get first claim on the frames that satisfy them, instead of losing a
  // borderline frame to an easier angle that had plenty of alternatives.
  const order: AngleKey[] = [
    'leftProfile',
    'rightProfile',
    'leftThreeQuarter',
    'rightThreeQuarter',
    'front',
  ];

  for (const key of order) {
    const spec = ANGLE_SPECS.find((s) => s.key === key);
    if (!spec) continue;
    const tolerance = TOLERANCE_DEG[key];

    let bestIndex = -1;
    let bestScore = -1;
    let bestAngleScore = 0;

    samples.forEach((sample, index) => {
      if (used.has(index) || sample.yawDeg === null || !sample.faceFound) return;
      const delta = Math.abs(sample.yawDeg - spec.targetYawDeg);
      if (delta > tolerance) return;
      const angleScore = 1 - delta / tolerance;
      const score = ANGLE_WEIGHT * angleScore + SHARPNESS_WEIGHT * sharpNorm[index];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
        bestAngleScore = angleScore;
      }
    });

    if (bestIndex < 0) continue;
    used.add(bestIndex);
    picks.push({
      key,
      sampleIndex: bestIndex,
      tMs: samples[bestIndex].tMs,
      yawDeg: samples[bestIndex].yawDeg as number,
      confidence: clamp01(ANGLE_WEIGHT * bestAngleScore + SHARPNESS_WEIGHT * sharpNorm[bestIndex]),
    });
  }

  const back = findBackFrame(samples, sharpNorm, used);
  if (back) {
    used.add(back.index);
    // A long faceless run is a real rotation past the back of the head; a
    // barely-qualifying one might be a dropped detection, so it scores lower.
    const runScore = clamp01(back.runLength / (MIN_BACK_RUN * 3));
    picks.push({
      key: 'back',
      sampleIndex: back.index,
      tMs: samples[back.index].tMs,
      yawDeg: 180,
      confidence: clamp01(ANGLE_WEIGHT * runScore + SHARPNESS_WEIGHT * sharpNorm[back.index]),
    });
  }

  return sortBySheetOrder(picks);
}

/**
 * No usable measurements anywhere in the take. Fall back to the coach script:
 * the front hold, then five evenly spaced points across the rotation.
 *
 * Rotation DIRECTION is unknowable without measurements, so this assumes the
 * client turned toward their own left (presenting their right side first) —
 * which is why every pick here carries confidence 0. These are placements for
 * the barber to confirm or scrub, and the UI must say so.
 */
function pickByCoachTiming(samples: FrameSample[]): AnglePick[] {
  const lastMs = samples[samples.length - 1].tMs;
  if (lastMs <= 0) return [];

  const spinStart = Math.min(SPIN_STARTS_AT_MS, lastMs);
  const spinSpan = Math.max(0, lastMs - spinStart);

  // Assumed order around one rotation, starting from the front hold.
  const sequence: { key: AngleKey; atMs: number; yawDeg: number }[] = [
    { key: 'front', atMs: spinStart / 2, yawDeg: 0 },
    { key: 'rightThreeQuarter', atMs: spinStart + spinSpan * 0.12, yawDeg: 35 },
    { key: 'rightProfile', atMs: spinStart + spinSpan * 0.26, yawDeg: 80 },
    { key: 'back', atMs: spinStart + spinSpan * 0.5, yawDeg: 180 },
    { key: 'leftProfile', atMs: spinStart + spinSpan * 0.74, yawDeg: -80 },
    { key: 'leftThreeQuarter', atMs: spinStart + spinSpan * 0.88, yawDeg: -35 },
  ];

  const used = new Set<number>();
  const picks: AnglePick[] = [];
  for (const step of sequence) {
    const index = nearestUnusedSample(samples, step.atMs, used);
    if (index < 0) continue;
    used.add(index);
    picks.push({
      key: step.key,
      sampleIndex: index,
      tMs: samples[index].tMs,
      yawDeg: step.yawDeg,
      confidence: 0,
    });
  }
  return sortBySheetOrder(picks);
}

function nearestUnusedSample(samples: FrameSample[], atMs: number, used: Set<number>): number {
  let best = -1;
  let bestDelta = Infinity;
  samples.forEach((sample, index) => {
    if (used.has(index)) return;
    const delta = Math.abs(sample.tMs - atMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  return best;
}

/** Left side → front → right side → back, the way the contact sheet reads. */
function sortBySheetOrder(picks: AnglePick[]): AnglePick[] {
  const order = ANGLE_SPECS.map((s) => s.key);
  return [...picks].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
