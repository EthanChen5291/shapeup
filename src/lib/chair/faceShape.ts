// ============================================================
// Face proportions, measured — the input to the recommendation laws.
//
// This is the pure half: landmarks in, three scale-free ratios out, then three
// signed signals a barber would recognise. No DOM, no model, no camera, so the
// geometry is testable on plain numbers. faceMeasure.ts feeds it from the live
// camera; recommend.ts consumes what it produces.
//
// Three decisions worth defending:
//
//  * RATIOS, NOT PIXELS. Every measurement is divided by the cheekbone width,
//    so nothing here depends on how close the client sits or what the tablet's
//    sensor is. A ratio is also what a barber is actually reasoning about —
//    "longer than it is wide" is the whole of the long-face rule.
//
//  * EUCLIDEAN DISTANCES BETWEEN SYMMETRIC PAIRS. Point-to-point distance is
//    invariant to head ROLL, so a client with their head cocked still measures
//    correctly and no de-rotation step is needed. Yaw and pitch are not
//    forgiving that way, which is why faceMeasure.ts gates on them instead.
//
//  * A DEADZONE, THEN SATURATION. `signalsFrom` returns 0 for anything inside a
//    band around the reference proportions and ramps to ±1 outside it. That is
//    what makes an oval face — the one every rule says "everything suits you"
//    about — produce no signal at all, and it means a mis-set reference shifts
//    where the deadzone sits without ever producing a wild recommendation.
//
// REFERENCE_METRICS below is a CALIBRATION CONSTANT, not a law of nature. It is
// the proportion set that reads as "balanced", and it is the one thing here
// that wants tuning against real faces on a real tablet. Everything downstream
// is expressed as deviation from it, so tuning is a one-object edit and the
// tests — which assert ordering, not absolute labels — stay valid.
// ============================================================

/** A normalized landmark. Only x/y are used; z is not reliable for ratios. */
export interface FacePoint {
  x: number;
  y: number;
}

/**
 * Landmark indices into MediaPipe's 468-point face mesh.
 *
 * Every one of these sits on the FACE OVAL contour, and the widths are read
 * from symmetric pairs, so the measurements survive roll and mild asymmetry.
 */
export const FACE_LANDMARKS = {
  /** Centre of the upper forehead. */
  top: 10,
  /** Bottom of the chin. */
  chin: 152,
  /** Widest points, level with the cheekbones and ears. */
  cheekLeft: 234,
  cheekRight: 454,
  /** The jaw corners — where a strong jaw reads as square. */
  jawLeft: 172,
  jawRight: 397,
  /** Temples, at the outer edge of the forehead. */
  browLeft: 54,
  browRight: 284,
} as const;

/** The scale-free proportions. Every one is relative to cheekbone width. */
export interface FaceMetrics {
  /** Chin-to-forehead over cheekbone width. Higher = longer face. */
  lengthRatio: number;
  /** Jaw width over cheekbone width. Higher = squarer jaw. */
  jawRatio: number;
  /** Temple width over cheekbone width. Higher = wider forehead. */
  foreheadRatio: number;
}

/**
 * The proportions that read as balanced — an oval face, the one shape every
 * barbering rule declines to correct.
 *
 * CALIBRATION CONSTANT. These were set from the canonical mesh's neutral
 * geometry. If recommendations skew consistently one way on real clients, this
 * is the object to move, and nothing else needs to change: `signalsFrom` is
 * defined purely as deviation from here.
 */
export const REFERENCE_METRICS: FaceMetrics = {
  lengthRatio: 1.45,
  jawRatio: 0.78,
  foreheadRatio: 0.9,
};

/**
 * How far a ratio may sit from the reference and still count as balanced. Wide
 * on purpose: the cost of calling an oval face "long" and steering the barber
 * off a cut the client wanted is much higher than the cost of staying neutral.
 */
const DEADZONE: FaceMetrics = {
  lengthRatio: 0.07,
  jawRatio: 0.05,
  foreheadRatio: 0.05,
};

/** How much further past the deadzone a ratio travels before it saturates. */
const SPAN: FaceMetrics = {
  lengthRatio: 0.22,
  jawRatio: 0.14,
  foreheadRatio: 0.14,
};

/**
 * What the laws in recommend.ts actually read. Each runs −1 … 0 … +1, where 0
 * means "balanced, this rule has nothing to say".
 */
export interface FaceSignals {
  /** −1 short and round … +1 long and narrow. */
  elongation: number;
  /** −1 tapered, pointed chin … +1 strong, square jaw. */
  jawStrength: number;
  /** −1 narrow forehead, wide cheekbones … +1 wide forehead, narrow chin. */
  foreheadWidth: number;
}

export const NEUTRAL_SIGNALS: FaceSignals = {
  elongation: 0,
  jawStrength: 0,
  foreheadWidth: 0,
};

/**
 * The six shapes barbers actually name. Used ONLY for the barber-facing "why" —
 * the ranking itself runs on the continuous signals, so there is no cliff at a
 * boundary and no client is ever shown a label about their own face.
 */
export type FaceShape = 'oval' | 'round' | 'oblong' | 'square' | 'heart' | 'diamond';

function distance(a: FacePoint, b: FacePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Measure one frame. Returns null when the landmarks are missing or degenerate
 * — a zero-width face would divide every ratio by nothing.
 */
export function metricsFromLandmarks(points: readonly FacePoint[]): FaceMetrics | null {
  const need = Object.values(FACE_LANDMARKS);
  for (const index of need) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  }

  const cheekWidth = distance(points[FACE_LANDMARKS.cheekLeft], points[FACE_LANDMARKS.cheekRight]);
  if (cheekWidth <= 1e-6) return null;

  return {
    lengthRatio: distance(points[FACE_LANDMARKS.top], points[FACE_LANDMARKS.chin]) / cheekWidth,
    jawRatio: distance(points[FACE_LANDMARKS.jawLeft], points[FACE_LANDMARKS.jawRight]) / cheekWidth,
    foreheadRatio:
      distance(points[FACE_LANDMARKS.browLeft], points[FACE_LANDMARKS.browRight]) / cheekWidth,
  };
}

/**
 * Signed, saturating deviation from a reference: exactly 0 inside the deadzone,
 * then a straight ramp to ±1. The flat centre is the important part — it's what
 * keeps a near-average face from being "corrected".
 */
function deviation(value: number, reference: number, deadzone: number, span: number): number {
  const delta = value - reference;
  const past = Math.abs(delta) - deadzone;
  if (past <= 0) return 0;
  return Math.sign(delta) * Math.min(1, past / span);
}

export function signalsFrom(metrics: FaceMetrics): FaceSignals {
  return {
    elongation: deviation(
      metrics.lengthRatio,
      REFERENCE_METRICS.lengthRatio,
      DEADZONE.lengthRatio,
      SPAN.lengthRatio,
    ),
    jawStrength: deviation(
      metrics.jawRatio,
      REFERENCE_METRICS.jawRatio,
      DEADZONE.jawRatio,
      SPAN.jawRatio,
    ),
    foreheadWidth: deviation(
      metrics.foreheadRatio,
      REFERENCE_METRICS.foreheadRatio,
      DEADZONE.foreheadRatio,
      SPAN.foreheadRatio,
    ),
  };
}

/** Per-axis median. Robust to the one frame where the client blinked or moved. */
export function medianMetrics(samples: readonly FaceMetrics[]): FaceMetrics | null {
  if (samples.length === 0) return null;
  const pick = (read: (m: FaceMetrics) => number): number => {
    const sorted = samples.map(read).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    lengthRatio: pick((m) => m.lengthRatio),
    jawRatio: pick((m) => m.jawRatio),
    foreheadRatio: pick((m) => m.foreheadRatio),
  };
}

/**
 * How much the samples agree, 0–1. Frames that disagree mean the client was
 * moving, half-lit, or partly out of frame — and a measurement taken under
 * those conditions is one the chair should not act confidently on.
 */
export function agreement(samples: readonly FaceMetrics[]): number {
  if (samples.length < 2) return 0;
  const spread = (read: (m: FaceMetrics) => number): number => {
    const values = samples.map(read);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    if (Math.abs(mean) < 1e-6) return 1;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
    // Coefficient of variation: spread as a fraction of the value itself, so
    // the three ratios are comparable despite their different scales.
    return Math.sqrt(variance) / Math.abs(mean);
  };
  const worst = Math.max(
    spread((m) => m.lengthRatio),
    spread((m) => m.jawRatio),
    spread((m) => m.foreheadRatio),
  );
  // 4% coefficient of variation or better is a still, well-lit face; 12% is
  // someone talking and turning, and carries no confidence at all.
  return Math.min(1, Math.max(0, (0.12 - worst) / 0.08));
}

/**
 * The dominant departure from balanced, named. Ties and near-balance both
 * resolve to `oval`, which is the honest answer for most faces.
 */
export function shapeFrom(signals: FaceSignals): FaceShape {
  const ranked: { shape: FaceShape; strength: number }[] = [
    { shape: signals.elongation >= 0 ? 'oblong' : 'round', strength: Math.abs(signals.elongation) },
    { shape: 'square', strength: signals.jawStrength > 0 ? signals.jawStrength : 0 },
    {
      shape: signals.foreheadWidth >= 0 ? 'heart' : 'diamond',
      strength: Math.abs(signals.foreheadWidth),
    },
  ];
  ranked.sort((a, b) => b.strength - a.strength);
  // Below a third of full scale nothing is pronounced enough to name.
  return ranked[0].strength >= 0.34 ? ranked[0].shape : 'oval';
}

/** Barber-facing only — never rendered where the client can read it. */
export const SHAPE_LABELS: Record<FaceShape, string> = {
  // "Balanced##face": the bare word is the render-quality setting elsewhere,
  // which translates differently from the shape of someone's face.
  oval: 'Balanced##face',
  round: 'Rounder',
  oblong: 'Longer',
  square: 'Strong jaw',
  heart: 'Wider forehead',
  diamond: 'Wide cheekbones',
};
