// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SWITCH_IN_MS, SWITCH_MAX_RATE, SWITCH_OUT_MS } from '@/lib/heroSwitch';
import HeroTurntable, { HERO_CLIPS } from './HeroTurntable';

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** requestAnimationFrame under test control: `advance(ms)` runs the pending frame at that time. */
function fakeFrames() {
  let pending: FrameRequestCallback | null = null;
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pending = null; });
  return {
    advance(ms: number) {
      now += ms;
      const cb = pending;
      pending = null;
      act(() => { cb?.(now); });
    },
  };
}

const wrapper = (id: string) => document.querySelector(`[data-clip="${id}"]`) as HTMLElement;
const videoOf = (id: string) => wrapper(id).querySelector('video') as HTMLVideoElement;
/** jsdom never loads media; say whether a video has a frame to show. */
const setReady = (video: HTMLVideoElement, ready: boolean) => Object.defineProperty(video, 'readyState', { value: ready ? 4 : 0, configurable: true });
const circleScale = () => Number(/scale\(([\d.]+)\)/.exec((wrapper('women').parentElement as HTMLElement).style.transform)?.[1]);

beforeEach(() => {
  play.mockClear();
  pause.mockClear();
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = pause;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('HeroTurntable', () => {
  it('opens on the women\'s render: one looping, silent, labelled video that starts from the HTML', () => {
    setReducedMotion(false);
    render(<HeroTurntable />);
    const video = videoOf('women');
    expect(wrapper('women').dataset.shown).toBe('true');
    expect(screen.getAllByRole('img', { name: /tries on different hairstyles/i })).toContain(video);
    expect(video.getAttribute('src')).toBe(HERO_CLIPS[0].video);
    expect(video.getAttribute('poster')).toBe(HERO_CLIPS[0].poster);
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(play).toHaveBeenCalled();
  });

  it('does not fetch the second render with the page, only once an arrow is about to be used', () => {
    setReducedMotion(false);
    render(<HeroTurntable />);
    expect(videoOf('men').hasAttribute('src')).toBe(false);
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Next model' }));
    expect(videoOf('men').getAttribute('src')).toBe(HERO_CLIPS[1].video);
  });

  it('an arrow shrinks and speeds the head up, swaps renders at the fastest point, then settles', () => {
    setReducedMotion(false);
    const frames = fakeFrames();
    render(<HeroTurntable />);
    const women = videoOf('women');
    const men = videoOf('men');
    women.currentTime = 2.5;
    setReady(men, true);
    fireEvent.click(screen.getByRole('button', { name: 'Next model' }));

    // The incoming loop starts alongside, from the same moment of the turn.
    expect(men.getAttribute('src')).toBe(HERO_CLIPS[1].video);
    expect(men.currentTime).toBe(2.5);

    frames.advance(SWITCH_OUT_MS * 0.8);
    expect(wrapper('women').dataset.shown).toBe('true');
    expect(circleScale()).toBeLessThan(1);
    expect(women.playbackRate).toBeGreaterThan(1.5);
    expect(men.playbackRate).toBe(women.playbackRate);

    frames.advance(SWITCH_OUT_MS * 0.2 + 1);
    expect(wrapper('men').dataset.shown).toBe('true');
    expect(wrapper('women').dataset.shown).toBe('false');
    expect(men.playbackRate).toBeGreaterThan(SWITCH_MAX_RATE * 0.9);
    expect(circleScale()).toBeLessThan(0.9);

    frames.advance(SWITCH_IN_MS + 50);
    expect(circleScale()).toBe(1);
    expect(men.playbackRate).toBe(1);
    expect(pause).toHaveBeenCalled(); // the outgoing loop stops once it is off screen

    // And back again with the other arrow.
    setReady(women, true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous model' }));
    frames.advance(SWITCH_OUT_MS + 1);
    expect(wrapper('women').dataset.shown).toBe('true');
  });

  it('keeps the outgoing render up until the incoming one has a frame, at the latest until the switch ends', () => {
    setReducedMotion(false);
    const frames = fakeFrames();
    render(<HeroTurntable />);
    setReady(videoOf('men'), false); // still downloading or seeking: it would paint nothing
    fireEvent.click(screen.getByRole('button', { name: 'Next model' }));
    frames.advance(SWITCH_OUT_MS + 40);
    expect(wrapper('women').dataset.shown).toBe('true');
    frames.advance(SWITCH_IN_MS);
    expect(wrapper('men').dataset.shown).toBe('true');
  });

  it('ignores a second press while a switch is running', () => {
    setReducedMotion(false);
    const frames = fakeFrames();
    render(<HeroTurntable />);
    const next = screen.getByRole('button', { name: 'Next model' });
    fireEvent.click(next);
    frames.advance(SWITCH_OUT_MS / 2);
    fireEvent.click(next);
    frames.advance(SWITCH_OUT_MS / 2 + 1);
    frames.advance(SWITCH_IN_MS + 50);
    expect(wrapper('men').dataset.shown).toBe('true');
  });

  it('for reduced motion: nothing plays, and an arrow swaps the stills at once', () => {
    setReducedMotion(true);
    render(<HeroTurntable />);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next model' }));
    expect(wrapper('men').dataset.shown).toBe('true');
    expect(play).not.toHaveBeenCalled();
    // The stylesheet is what shows the still and hides the video.
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const reduce = css.slice(css.indexOf('.hero-turntable-still { display: none; }'));
    expect(reduce).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hero-turntable video \{ display: none; \}\s*\.hero-turntable-still \{ display: block; \}/);
  });

  it('has exactly two controls, the arrows, each a labelled button', () => {
    setReducedMotion(false);
    render(<HeroTurntable />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Previous model', 'Next model']);
  });

  it('ships every file it points at', () => {
    for (const clip of HERO_CLIPS) {
      for (const path of [clip.video, clip.poster, clip.still]) {
        expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true);
      }
    }
  });
});
