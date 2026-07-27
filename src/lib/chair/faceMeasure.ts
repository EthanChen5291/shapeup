'use client';

// ============================================================
// Reading the client's face off the live camera, once.
//
// Timing is the whole design here. This runs on the STYLE screen — the camera
// is already open and the landmarker already warm (ChairStation preloads both),
// the client is sitting still, and the barber is reading the menu. By the time
// a finger moves toward a suggestion the ranking has been settled for seconds.
//
// Why not measure during the take:
//
//  * The take's output has a DIFFERENT HAIRCUT ON IT. Face shape has to be read
//    from the real camera, not from the model's output.
//  * The take is a rotation. Almost every frame in it is at an angle where
//    chin-to-forehead is foreshortened and unusable.
//  * Re-ranking while the barber is reaching for a chip moves the chip. A
//    measurement that lands once and never moves is worth more than a
//    measurement that keeps improving.
//
// Face shape doesn't change during a haircut, so once is also simply correct.
//
// Everything about this is optional. No landmarker, bad light, a client in a
// mask, someone who won't look up — all produce a null reading, and the chair
// falls back to the house order (see recommend.ts). A measurement this feature
// can't take must never block the barber from starting a take.
// ============================================================

import { getLandmarker, pitchFromMatrix, yawFromMatrix } from './frames';
import {
  agreement,
  medianMetrics,
  metricsFromLandmarks,
  shapeFrom,
  signalsFrom,
  type FaceMetrics,
  type FaceShape,
  type FaceSignals,
} from './faceShape';

/** Working resolution. Same reasoning as frames.ts: enough for landmarks, cheap. */
const MEASURE_WIDTH = 256;
/** How many usable frames to gather before settling. */
const TARGET_SAMPLES = 8;
/** Gap between attempts. Slow enough that the client can settle between them. */
const SAMPLE_INTERVAL_MS = 140;
/** Give up rather than hold the style screen hostage to a face that won't sit still. */
const MEASURE_TIMEOUT_MS = 6_000;

/**
 * How far off dead-on the head may be and still be measured.
 *
 * Both matter and for the same reason: yaw foreshortens the WIDTHS, pitch
 * foreshortens the LENGTH, and every ratio here is one over the other. A face
 * measured at 25° of yaw reads narrower than it is, which is exactly the error
 * that would recommend width-adding cuts to someone who doesn't need them.
 */
const MAX_YAW_DEG = 12;
const MAX_PITCH_DEG = 12;

/** Below this the chair shows the house order instead and says nothing. */
export const MIN_CONFIDENCE = 0.35;

export interface FaceReading {
  metrics: FaceMetrics;
  signals: FaceSignals;
  shape: FaceShape;
  /** 0–1, from how many frames agreed. Below MIN_CONFIDENCE, don't act on it. */
  confidence: number;
  sampleCount: number;
}

/** Play a stream into an offscreen video element we can draw from. */
async function attach(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {
    // Autoplay refusal on a muted, srcObject video is rare; if it happens the
    // readyState check below simply never passes and we return null.
  });
  return video;
}

function ready(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sample the camera until enough frontal frames agree, then settle.
 *
 * Resolves null whenever a trustworthy measurement wasn't available — that is a
 * normal outcome, not an error, and the caller treats it as "no signal".
 */
export async function measureFaceShape(
  stream: MediaStream,
  signal?: AbortSignal,
): Promise<FaceReading | null> {
  const landmarker = await getLandmarker();
  if (!landmarker || signal?.aborted) return null;

  const video = await attach(stream);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const samples: FaceMetrics[] = [];
  const startedAt = Date.now();

  try {
    while (samples.length < TARGET_SAMPLES && Date.now() - startedAt < MEASURE_TIMEOUT_MS) {
      if (signal?.aborted) return null;
      await wait(SAMPLE_INTERVAL_MS);
      if (!ready(video)) continue;

      if (canvas.width === 0) {
        canvas.width = MEASURE_WIDTH;
        canvas.height = Math.max(
          2,
          Math.round((MEASURE_WIDTH * video.videoHeight) / video.videoWidth),
        );
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        const result = landmarker.detect(canvas);
        const matrix = result.facialTransformationMatrixes?.[0];
        const points = result.faceLandmarks?.[0];
        if (!matrix || !points) continue;

        // Only near-frontal frames carry usable proportions.
        if (Math.abs(yawFromMatrix(matrix)) > MAX_YAW_DEG) continue;
        if (Math.abs(pitchFromMatrix(matrix)) > MAX_PITCH_DEG) continue;

        // Landmarks are normalized to the canvas, which is not square — undo
        // that before measuring or every vertical distance is scaled wrong.
        const aspect = canvas.height / canvas.width;
        const metrics = metricsFromLandmarks(points.map((p) => ({ x: p.x, y: p.y * aspect })));
        if (metrics) samples.push(metrics);
      } catch {
        // One bad frame is not a failed measurement.
      }
    }

    const metrics = medianMetrics(samples);
    if (!metrics) return null;

    const confidence = agreement(samples) * Math.min(1, samples.length / TARGET_SAMPLES);
    const signals = signalsFrom(metrics);
    return {
      metrics,
      signals,
      shape: shapeFrom(signals),
      confidence,
      sampleCount: samples.length,
    };
  } finally {
    // Detach without touching the tracks: the camera belongs to useChairTake
    // and the take that follows this measurement needs it still open.
    video.srcObject = null;
  }
}
