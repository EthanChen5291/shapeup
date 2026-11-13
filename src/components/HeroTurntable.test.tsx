// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import HeroTurntable, { HERO_TURNTABLE_POSTER, HERO_TURNTABLE_STILL, HERO_TURNTABLE_VIDEO } from './HeroTurntable';

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

beforeEach(() => {
  play.mockClear();
  pause.mockClear();
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = pause;
});
afterEach(() => cleanup());

describe('HeroTurntable', () => {
  it('is one looping, silent, labelled video that starts from the HTML', () => {
    setReducedMotion(false);
    render(<HeroTurntable />);
    const video = screen.getByRole('img', { name: /tries on different hairstyles/i }) as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src')).toBe(HERO_TURNTABLE_VIDEO);
    expect(video.getAttribute('poster')).toBe(HERO_TURNTABLE_POSTER);
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(play).toHaveBeenCalled();
  });

  it('for reduced motion: the video is stopped and the stylesheet shows the face-on still instead', () => {
    setReducedMotion(true);
    const { container } = render(<HeroTurntable />);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    expect(container.querySelector('img.hero-turntable-still')?.getAttribute('src')).toBe(HERO_TURNTABLE_STILL);
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const rules = css.slice(css.indexOf('.hero-turntable-still { display: none; }'));
    expect(rules).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hero-turntable video \{ display: none; \}\s*\.hero-turntable-still \{ display: block; \}/);
  });

  it('offers nothing to control: no buttons, arrows or pointer hit area', () => {
    setReducedMotion(false);
    const { container } = render(<HeroTurntable />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(1); // the still, not an arrow
    expect((container.firstElementChild as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('ships the files it points at', () => {
    for (const path of [HERO_TURNTABLE_VIDEO, HERO_TURNTABLE_POSTER, HERO_TURNTABLE_STILL]) {
      expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true);
    }
  });
});
