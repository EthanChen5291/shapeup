// ============================================================
// Reading head pose out of a recorded take, in the browser.
//
// Two passes on purpose:
//
//   Pass 1 (measure)  — seek the clip at ~4fps into a SMALL canvas and, for
//                       each frame, record head yaw and a focus score. Sixty
//                       full-resolution frames held in memory would be ~75MB
//                       on a mid-range tablet; at 256px it's under 5.
//   Pass 2 (extract)  — re-seek only the six timestamps that actually won
//                       (see angleSelection.ts) and encode those at full size.
//
// Head pose comes from MediaPipe's facial transformation matrix rather than
// from 2D landmark ratios, because a ratio-based estimate degrades exactly
// where this feature needs to be accurate — near profile, where the far side of
// the face stops being visible.
//
// The landmarker is optional. When it can't load — the model file is missing,
// WebGL is unavailable, the shop's tablet is ancient — every sample simply
// carries a null yaw, and angleSelection.ts falls back to the coach script's
// timing. A missing detector must degrade the sheet, never block the take.
// ============================================================

import type { FrameSample } from './angleSelection';

/** Self-hosted so the chair loads no external origin (see scripts/fetch-face-landmarker.mjs). */
const WASM_BASE = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/face_landmarker.task';

/** Measurement resolution. Big enough for landmarks, small enough to hold 100+. */
const MEASURE_WIDTH = 256;
/** Sampling rate across the take. 4fps over 30s ≈ 120 candidate frames. */
const MEASURE_FPS = 4;
/** What the saved reference stills are encoded at. */
const EXTRACT_MAX_WIDTH = 1080;
const EXTRACT_QUALITY = 0.92;

interface Matrix {
  rows: number;
  columns: number;
  data: number[];
}

export interface FaceLandmarkerLike {
  detect(image: CanvasImageSource): {
    facialTransformationMatrixes?: Matrix[];
    /** The 468-point mesh, normalized to the image. Used by faceMeasure.ts. */
    faceLandmarks?: { x: number; y: number }[][];
  };
  close(): void;
}

/**
 * Loaded once per page and shared: creating a landmarker compiles WASM and
 * uploads a model, which is far too slow to redo per take. Cached as the
 * in-flight promise so two quick approvals can't race two loads.
 */
let landmarkerPromise: Promise<FaceLandmarkerLike | null> | null = null;

export async function getLandmarker(): Promise<FaceLandmarkerLike | null> {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
      return (await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      })) as unknown as FaceLandmarkerLike;
    } catch (err) {
      console.warn('[chair] face landmarker unavailable — falling back to coach timing', err);
      return null;
    }
  })();
  return landmarkerPromise;
}

/** Column-major element access, the layout MediaPipe's Matrix uses. */
function at(m: Matrix, row: number, col: number): number {
  return m.data[col * m.rows + row];
}

/**
 * Head yaw in degrees from the facial transformation matrix.
 *
 * The matrix's third column is the face's forward vector in camera space (x
 * right, y up, z toward the viewer), so for a rotation about the vertical axis
 * it reads (sinθ, 0, cosθ) and θ falls straight out of atan2.
 *
 * Sign therefore follows the camera: positive means the nose has swung toward
 * the image's right, i.e. the client turned to their own left and is presenting
 * their RIGHT side to the lens — the convention convex/lib/chair.ts documents.
 */
export function yawFromMatrix(m: Matrix): number {
  return (Math.atan2(at(m, 0, 2), at(m, 2, 2)) * 180) / Math.PI;
}

/**
 * Head pitch in degrees from the same forward vector — positive is chin up.
 *
 * The reference sheet doesn't care about pitch (a spin is a yaw), but face
 * MEASUREMENT does: nodding foreshortens chin-to-forehead and would read a
 * balanced face as short and round. faceMeasure.ts gates on this.
 */
export function pitchFromMatrix(m: Matrix): number {
  const forwardY = at(m, 1, 2);
  const horizontal = Math.hypot(at(m, 0, 2), at(m, 2, 2));
  return (Math.atan2(-forwardY, horizontal) * 180) / Math.PI;
}

/**
 * Variance of the Laplacian over the green channel — the standard cheap focus
 * measure. A spinning head produces motion blur, and blur is what separates a
 * frame a barber can read a weight line off from one they can't.
 */
export function laplacianVariance(image: ImageData): number {
  const { data, width, height } = image;
  if (width < 3 || height < 3) return 0;
  const green = (x: number, y: number) => data[(y * width + x) * 4 + 1];

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const value =
        4 * green(x, y) - green(x - 1, y) - green(x + 1, y) - green(x, y - 1) - green(x, y + 1);
      sum += value;
      sumSq += value * value;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Load a blob into a seekable, decoded <video>. */
async function loadVideo(blob: Blob): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(blob);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('That recording didn’t load.'));
  });
  return video;
}

/** Seek and wait for the frame to actually be painted, not just requested. */
function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = timeSec;
  });
}

/**
 * A recorded MediaStream often reports `duration: Infinity` until it's been
 * seeked past its end — a long-standing MediaRecorder quirk. Without this,
 * sampling either covers one frame or runs forever.
 */
async function resolveDuration(video: HTMLVideoElement, fallbackMs: number): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  await seekTo(video, 1e6);
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  return fallbackMs;
}

export interface MeasuredTake {
  samples: FrameSample[];
  /** False when the landmarker didn't load — the UI warns the barber to check. */
  measured: boolean;
  durationMs: number;
}

/**
 * Pass 1: walk the take and measure every sampled frame.
 *
 * `fallbackDurationMs` is the recorder's own elapsed time, used when the
 * container doesn't carry a usable duration.
 */
export async function measureTake(
  blob: Blob,
  fallbackDurationMs: number,
  onProgress?: (fraction: number) => void,
): Promise<MeasuredTake> {
  const video = await loadVideo(blob);
  try {
    const durationMs = await resolveDuration(video, fallbackDurationMs);
    const landmarker = await getLandmarker();

    const canvas = document.createElement('canvas');
    const aspect = video.videoHeight / (video.videoWidth || 1) || 0.75;
    canvas.width = MEASURE_WIDTH;
    canvas.height = Math.max(2, Math.round(MEASURE_WIDTH * aspect));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Couldn’t read that recording.');

    const step = 1000 / MEASURE_FPS;
    const samples: FrameSample[] = [];
    let anyFace = false;

    for (let tMs = 0; tMs < durationMs; tMs += step) {
      await seekTo(video, tMs / 1000);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const sharpness = laplacianVariance(ctx.getImageData(0, 0, canvas.width, canvas.height));

      let yawDeg: number | null = null;
      let faceFound = false;
      if (landmarker) {
        try {
          const matrix = landmarker.detect(canvas).facialTransformationMatrixes?.[0];
          if (matrix) {
            yawDeg = yawFromMatrix(matrix);
            faceFound = true;
            anyFace = true;
          }
        } catch {
          // One bad frame must not abandon the take.
        }
      }

      samples.push({ tMs, yawDeg, faceFound, sharpness });
      onProgress?.(Math.min(1, tMs / durationMs));
    }

    return { samples, measured: Boolean(landmarker) && anyFace, durationMs };
  } finally {
    URL.revokeObjectURL(video.src);
    video.src = '';
  }
}

/**
 * Pass 2: encode the frames that won, at full resolution.
 *
 * Returns one blob per requested timestamp, in the same order — so a caller can
 * zip them straight back onto their picks.
 */
export async function extractFrames(
  blob: Blob,
  timestampsMs: number[],
): Promise<(Blob | null)[]> {
  if (timestampsMs.length === 0) return [];
  const video = await loadVideo(blob);
  try {
    const scale = Math.min(1, EXTRACT_MAX_WIDTH / (video.videoWidth || EXTRACT_MAX_WIDTH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round((video.videoWidth || EXTRACT_MAX_WIDTH) * scale));
    canvas.height = Math.max(2, Math.round((video.videoHeight || 720) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t read that recording.');

    const out: (Blob | null)[] = [];
    for (const tMs of timestampsMs) {
      await seekTo(video, tMs / 1000);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      out.push(
        await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', EXTRACT_QUALITY),
        ),
      );
    }
    return out;
  } finally {
    URL.revokeObjectURL(video.src);
    video.src = '';
  }
}

/** Warm the landmarker while the barber is still choosing a cut. */
export function preloadLandmarker(): void {
  void getLandmarker();
}
