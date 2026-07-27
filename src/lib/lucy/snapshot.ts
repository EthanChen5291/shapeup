// ============================================================
// A low-res still of the camera, for the take debug panel.
//
// One frame, tiny, JPEG, as a data URL — enough to answer "what was the
// camera actually looking at when this instruction went out" next to the
// prompt text, without holding a full-resolution frame in React state for
// the length of a session.
//
// Debug-only, so every failure path returns null: a camera that can't be
// sampled must never cost a take.
// ============================================================

/** Wide enough to recognise a face, small enough to keep in state. */
export const SNAPSHOT_MAX_WIDTH = 160;
const SNAPSHOT_QUALITY = 0.6;
/** A camera that hasn't produced dimensions by now never will (for our purposes). */
const SNAPSHOT_TIMEOUT_MS = 2000;

/** Scale video dimensions down to snapshot size, preserving aspect. Pure, tested. */
export function snapshotSize(
  videoWidth: number,
  videoHeight: number,
): { width: number; height: number } {
  const width = Math.max(2, Math.min(SNAPSHOT_MAX_WIDTH, Math.round(videoWidth) || SNAPSHOT_MAX_WIDTH));
  const aspect = videoWidth > 0 && videoHeight > 0 ? videoHeight / videoWidth : 0.75;
  return { width, height: Math.max(2, Math.round(width * aspect)) };
}

/** Resolves once the video knows its dimensions, or gives up quietly. */
function waitForDimensions(video: HTMLVideoElement): Promise<boolean> {
  if (video.videoWidth > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), SNAPSHOT_TIMEOUT_MS);
    video.onloadeddata = () => {
      clearTimeout(timer);
      resolve(video.videoWidth > 0);
    };
    video.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}

/**
 * Grab one low-res frame off a live camera stream as a JPEG data URL.
 * Null on any failure — see the header.
 */
export async function captureDebugSnapshot(stream: MediaStream): Promise<string | null> {
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (!(await waitForDimensions(video))) return null;

    const { width, height } = snapshotSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', SNAPSHOT_QUALITY);
  } catch {
    return null;
  } finally {
    // Detach without touching the stream's tracks — the camera stays warm for
    // the take that this snapshot is documenting.
    video.srcObject = null;
  }
}
