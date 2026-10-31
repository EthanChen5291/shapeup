// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenFramePresented } from './videoFrame';

type FrameCb = (now: number, meta: VideoFrameCallbackMetadata) => void;

function videoWithFrames() {
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: 12.5 });
  const pending: FrameCb[] = [];
  Object.defineProperty(video, 'requestVideoFrameCallback', { value: (cb: FrameCb) => { pending.push(cb); return pending.length; } });
  const present = (mediaTime: number) => {
    const cbs = pending.splice(0);
    for (const cb of cbs) cb(0, { mediaTime } as VideoFrameCallbackMetadata);
  };
  return { video, present };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('whenFramePresented', () => {
  afterEach(() => vi.useRealTimers());

  it('ignores the stale parked frame (frame 0) and resolves on the frame at the target time', async () => {
    const { video, present } = videoWithFrames();
    let resolved = false;
    void whenFramePresented(video, 6.2).then(() => { resolved = true; });

    present(0); // the old parked frame — revealing now is the flash
    await flush();
    expect(resolved).toBe(false);

    present(6.25);
    await flush();
    expect(resolved).toBe(true);
  });

  it('accepts a frame just after the loop wraps when the target is near the end', async () => {
    const { video, present } = videoWithFrames();
    let resolved = false;
    void whenFramePresented(video, 12.4).then(() => { resolved = true; });
    present(0.05);
    await flush();
    expect(resolved).toBe(true);
  });

  it('falls back to resolving after the timeout if no frame ever arrives', async () => {
    vi.useFakeTimers();
    const { video } = videoWithFrames();
    let resolved = false;
    void whenFramePresented(video, 3, 500).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
  });

  it('without requestVideoFrameCallback, waits for seeked plus two animation frames', async () => {
    const video = document.createElement('video');
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
    let resolved = false;
    void whenFramePresented(video, 3).then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    video.dispatchEvent(new Event('seeked'));
    await flush();
    expect(resolved).toBe(true);
    expect(raf).toHaveBeenCalledTimes(2);
    raf.mockRestore();
  });
});
