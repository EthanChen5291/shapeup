// ============================================================
// Recording the take.
//
// The transformed video arrives as a live WebRTC track — nothing about it is
// persistent. If it isn't captured while it plays, it's gone, and the whole
// point of chair mode is that the take survives the haircut.
//
// Two things this has to get right:
//
//  * CODEC. The chair device is as likely to be an iPad as a laptop, and Safari
//    has never supported the webm container. So the mime type is negotiated
//    against MediaRecorder.isTypeSupported rather than assumed — a hard-coded
//    'video/webm' throws on iOS and takes the take with it.
//
//  * THE 30-SECOND CEILING. The stop timer is owned here, armed off the same
//    clock as the recorder, and independent of any React state. A stall in the
//    UI must not be able to let a take run long: the model bills by the second,
//    and convex/chair.ts already debited exactly 30.
// ============================================================

import { MAX_TAKE_SECONDS } from '@convex/lib/chair';

/**
 * Ordered by preference. VP9 is the best quality-per-bit of the three; the mp4
 * entries exist for Safari, which supports only the mp4 container.
 */
const CANDIDATE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4',
] as const;

export interface TakeRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface TakeRecorder {
  /** Resolves when the take ends — whether by `stop()` or the MAX_TAKE_SECONDS ceiling. */
  readonly result: Promise<TakeRecording>;
  /** Milliseconds elapsed, for the countdown ring. */
  elapsedMs(): number;
  /** End early ("that's the one"). Idempotent. */
  stop(): void;
  /** Tear down without producing a file (unmount, error). */
  cancel(): void;
}

/** The best container this browser will actually record, or null if none. */
export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of CANDIDATE_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // isTypeSupported is allowed to throw on malformed input in some engines.
    }
  }
  return null;
}

export interface StartRecordingOptions {
  stream: MediaStream;
  maxSeconds?: number;
  /** Fired when the ceiling stops the take, so the UI can say why. */
  onAutoStop?: () => void;
}

/**
 * Begin recording `stream`, stopping automatically at the ceiling.
 *
 * Throws if the browser can't record at all — the caller surfaces that as "your
 * browser can't save takes" rather than letting a take run and vanish.
 */
export function startTakeRecording({
  stream,
  maxSeconds = MAX_TAKE_SECONDS,
  onAutoStop,
}: StartRecordingOptions): TakeRecorder {
  const mimeType = pickRecordingMimeType();
  if (!mimeType) {
    throw new Error('This browser can’t record video. Try Chrome or Safari.');
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let stoppedAt: number | null = null;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const result = new Promise<TakeRecording>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      clearTimer();
      reject(new Error('Recording stopped unexpectedly.'));
    };
    recorder.onstop = () => {
      clearTimer();
      if (cancelled) {
        reject(new Error('cancelled'));
        return;
      }
      resolve({
        blob: new Blob(chunks, { type: mimeType }),
        mimeType,
        durationMs: (stoppedAt ?? Date.now()) - startedAt,
      });
    };
  });

  // Timeslice so a crash mid-take still leaves usable chunks behind.
  recorder.start(1000);

  timer = setTimeout(() => {
    if (recorder.state === 'inactive') return;
    stoppedAt = Date.now();
    onAutoStop?.();
    recorder.stop();
  }, maxSeconds * 1000);

  return {
    result,
    elapsedMs: () => (stoppedAt ?? Date.now()) - startedAt,
    stop() {
      if (recorder.state === 'inactive') return;
      clearTimer();
      stoppedAt = Date.now();
      recorder.stop();
    },
    cancel() {
      cancelled = true;
      clearTimer();
      if (recorder.state !== 'inactive') recorder.stop();
      // Nothing consumes `result` after a cancel, but an unhandled rejection
      // would still surface in the console.
      result.catch(() => {});
    },
  };
}
