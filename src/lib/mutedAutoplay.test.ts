// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMutedAutoplay } from './mutedAutoplay';

function fakeVideo(results: Array<'ok' | 'blocked'>) {
  const video = document.createElement('video');
  const play = vi.fn(() => (results.shift() === 'ok'
    ? Promise.resolve()
    : Promise.reject(new DOMException('blocked', 'NotAllowedError'))));
  Object.defineProperty(video, 'play', { value: play });
  return { video, play };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startMutedAutoplay', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marks the video muted as both property and attribute, and plays at the given rate', async () => {
    const { video, play } = fakeVideo(['ok']);
    startMutedAutoplay(video, 1.3);
    await flush();
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.playbackRate).toBe(1.3);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('retries on the first page interaction when autoplay is blocked, then stops listening', async () => {
    const { video, play } = fakeVideo(['blocked', 'ok', 'ok']);
    startMutedAutoplay(video);
    await flush();
    expect(play).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(play).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('scroll'));
    await flush();
    expect(play).toHaveBeenCalledTimes(2); // already playing: no more retries
  });

  it('retries on touchend, where iOS Safari grants playback permission', async () => {
    const { video, play } = fakeVideo(['blocked', 'ok']);
    startMutedAutoplay(video);
    await flush();
    window.dispatchEvent(new Event('touchend'));
    await flush();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('retries once the video has loaded data', async () => {
    const { video, play } = fakeVideo(['blocked', 'ok']);
    startMutedAutoplay(video);
    await flush();
    video.dispatchEvent(new Event('loadeddata'));
    await flush();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('cancel() stops pending retries so a hidden video is not restarted', async () => {
    const { video, play } = fakeVideo(['blocked', 'ok']);
    const cancel = startMutedAutoplay(video);
    await flush();
    cancel();
    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(play).toHaveBeenCalledTimes(1);
  });
});
