// @vitest-environment jsdom

// The consent screen's diagram. What matters is that it keeps telling the
// truth while it moves: it draws the real chips from the catalog, it never
// claims to be a preview of the client's own result, and it plays the loop —
// a chip tapped, a line typed, the right pane catching up — rather than
// sitting there as a still wireframe. Reduced motion gets the same drawing
// without the loop, not an empty box.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { hairstyleBySlug } from '@/data/hairstyles';
import LiveTryOnPreview from './LiveTryOnPreview';

let reduceMotion = false;

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') ? reduceMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** Let the scripted loop run for `ms` of its own time. */
async function play(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('the diagram', () => {
  test('names the parts of the screen it is drawing', () => {
    render(<LiveTryOnPreview />);
    const figure = screen.getByRole('img');
    expect(figure).toHaveAccessibleName(/camera on the left.*haircut on the right.*prompt box/is);
    expect(figure.querySelectorAll('.ltp-pane')).toHaveLength(2);
    expect(figure.querySelector('.ltp-prompt')).not.toBeNull();
    expect(figure.querySelectorAll('.ltp-chip')).toHaveLength(3);
  });

  test('says it is a drawing, not the client’s result', () => {
    render(<LiveTryOnPreview />);
    expect(screen.getByText(/not a preview of your result/i)).toBeInTheDocument();
  });

  test('the chips are real cuts, with the art the live screen uses', () => {
    const { container } = render(<LiveTryOnPreview />);
    const cut = hairstyleBySlug('broccoli-perm-taper-fade');
    expect(cut).toBeDefined();
    const art = container.querySelector(`img[src="/hair-previews/${cut!.slug}.png"]`);
    expect(art).not.toBeNull();
    expect(container.textContent).toContain(cut!.label.split(',')[0]);
  });
});

describe('the loop', () => {
  test('taps a suggestion, then types a line into the prompt box', async () => {
    vi.useFakeTimers();
    // Pin the keystroke jitter so the assertions land mid-sentence every run.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { container } = render(<LiveTryOnPreview />);

    // Nothing is typed before the loop reaches its first prompt beat.
    expect(container.querySelector('.ltp-line')!.textContent).toBe('');

    // Beat one taps a chip — and it opens on the last one, so tapping the
    // first is a visible change rather than a no-op.
    const chips = container.querySelectorAll('.ltp-chip');
    expect(chips[2].className).toContain('is-on');
    await play(1000);
    expect(chips[0].className).toContain('is-on');
    expect(chips[2].className).not.toContain('is-on');

    // Beat two types, one character at a time.
    await play(2600);
    const line = container.querySelector('.ltp-line')!.textContent ?? '';
    expect(line.length).toBeGreaterThan(0);
    expect('tighter on the sides').toContain(line);
  });

  test('the cut on the right changes only after the ask lands', async () => {
    vi.useFakeTimers();
    const { container } = render(<LiveTryOnPreview />);
    const result = () => container.querySelector('.ltp-pane.is-result')!;
    const shownHair = () => result().querySelector('.ltp-hair.is-on');

    await play(120);
    // Mid-tap: the pane has not swapped the drawing yet.
    expect(result().className).not.toContain('is-thinking');

    await play(400);
    expect(result().className).toContain('is-thinking');

    await play(2000);
    expect(result().className).not.toContain('is-thinking');
    expect(shownHair()).not.toBeNull();
  });

  test('stops cleanly on unmount — no timer outlives the panel', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<LiveTryOnPreview />);
    await play(1200);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('prefers-reduced-motion', () => {
  test('draws the settled state instead of playing the loop', async () => {
    reduceMotion = true;
    vi.useFakeTimers();
    const { container } = render(<LiveTryOnPreview />);

    // The diagram still explains the screen: a line in the box, a cut on the
    // right, a chip lit — it just never moves.
    expect(container.querySelector('.ltp-line')!.textContent).toBe('more volume on top');
    expect(container.querySelectorAll('.ltp-chip')[1].className).toContain('is-on');
    expect(container.querySelector('.ltp-hair.is-on')).not.toBeNull();

    await play(5000);
    expect(container.querySelector('.ltp-line')!.textContent).toBe('more volume on top');
    expect(vi.getTimerCount()).toBe(0);
  });
});
