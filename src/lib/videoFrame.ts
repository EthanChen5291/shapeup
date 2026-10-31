// Resolves once `video` has painted a frame near `targetTime` (after a seek +
// play). Revealing a just-seeked <video> any earlier can flash the frame it was
// parked on — usually frame 0 — because the seek and decode haven't landed yet,
// and even `seeked` can fire before the new frame reaches the screen.
//
// Uses requestVideoFrameCallback where available (it reports the presented
// frame's media time); otherwise waits for `seeked` plus two animation frames.
// `timeoutMs` is a safety net so a stalled video can't block the UI forever.

const TOLERANCE_S = 0.35;

export function whenFramePresented(video: HTMLVideoElement, targetTime: number, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const onSeeked = () => requestAnimationFrame(() => requestAnimationFrame(done));

    if (typeof video.requestVideoFrameCallback === 'function') {
      const check = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (settled) return;
        const off = Math.abs(meta.mediaTime - targetTime);
        // Close to the target, or already past it after a loop wrap.
        if (off < TOLERANCE_S || (video.duration && off > video.duration - TOLERANCE_S)) done();
        else video.requestVideoFrameCallback(check);
      };
      video.requestVideoFrameCallback(check);
    } else {
      video.addEventListener('seeked', onSeeked, { once: true });
    }
  });
}
