// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';

vi.mock('@/components/BarberVideoResult', () => ({ default: () => <div data-testid="preview" /> }));

import BarberVideoCard from './BarberVideoCard';

// jsdom has no layout: fake the few measurements the dock reads.
const heights = new Map<Element, number>();
const CARD_H = 120;

function setup(contentHeight: number, viewportHeight = 800, ret: { previewReturn?: (px: number | null) => boolean; commitReturn?: () => void } = {}) {
  const frameRef = createRef<HTMLDivElement>();
  const ui = (
    <div>
      <div ref={frameRef} data-testid="frame" />
      <aside style={{ paddingBottom: '16px' }}>
        <div data-testid="content">
          <BarberVideoCard videoState="idle" dock={{ frameRef, enabled: true, ...ret }} />
        </div>
      </aside>
    </div>
  );
  const r = render(ui);
  heights.set(screen.getByTestId('content'), contentHeight);
  (window as unknown as { innerHeight: number }).innerHeight = viewportHeight;
  return r;
}

/** Fire a resize and let the rAF-scheduled measurement (and the dock's second frame) run. */
async function settle() {
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  heights.clear();
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (heights.has(this)) return heights.get(this)!;
      // The card box is the first div with the card's padding class.
      if (this.className.includes('rounded-2xl')) return CARD_H;
      return 0;
    },
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  // Async like the real thing, so the scheduler's "one frame pending" guard clears.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0, toJSON() {} }) as DOMRect;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('BarberVideoCard dock', () => {
  it('stays in the panel while there is room', async () => {
    setup(300);
    await settle();
    expect(screen.queryByRole('button', { name: /move the card/i })).toBeNull();
  });

  it('floats over the frame (with a move grip) once the panel would overflow', async () => {
    // 800 viewport − 12 − 16 top − 16 bottom = 756 available; content without the card is 700 → no room for 120.
    setup(700);
    await settle();
    expect(screen.getByRole('button', { name: /move the card/i })).toBeInTheDocument();
    // The card now lives in the body-level overlay, not inside the panel.
    expect(screen.getByTestId('content').querySelector('.rounded-2xl')).toBeNull();
  });

  it('comes back to the panel when room returns', async () => {
    setup(700);
    await settle();
    expect(screen.getByRole('button', { name: /move the card/i })).toBeInTheDocument();
    heights.set(screen.getByTestId('content'), 300);
    await settle();
    expect(screen.queryByRole('button', { name: /move the card/i })).toBeNull();
  });

  describe('dragging it back to the panel', () => {
    // Docked at content 700: free = 800 − 12 − 16 − 16 − 700 = 56; the card needs
    // 120 + 12 gap + 24 hysteresis = 156, so the panel must give up 100 px.
    async function dockedWithReturn() {
      const previewReturn = vi.fn(() => true);
      const commitReturn = vi.fn();
      setup(700, 800, { previewReturn, commitReturn });
      await settle();
      const grip = screen.getByRole('button', { name: /move the card/i });
      fireEvent.pointerDown(grip, { button: 0, clientX: 2000, clientY: 2000 });
      return { grip, previewReturn, commitReturn };
    }
    // Every element (the aside included) measures as the box 0..1000 × 0..700.
    const OVER_PANEL = { clientX: 500, clientY: 300 };
    const FAR_AWAY = { clientX: 3000, clientY: 3000 };

    it('makes room while hovering over the panel and shows where the card will land', async () => {
      const { grip, previewReturn } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, OVER_PANEL); });
      expect(previewReturn).toHaveBeenCalledWith(100);
      expect(document.querySelector('.dock-landing')).not.toBeNull();
    });

    it('drops back into the panel, keeps the room, and stays there', async () => {
      const { grip, commitReturn } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, OVER_PANEL); });
      await act(async () => { fireEvent.pointerUp(grip, OVER_PANEL); });
      expect(commitReturn).toHaveBeenCalledTimes(1);
      heights.set(screen.getByTestId('content'), 600); // the list gave up its 100 px
      await settle();
      expect(screen.queryByRole('button', { name: /move the card/i })).toBeNull();
      expect(screen.getByTestId('content').querySelector('.rounded-2xl')).not.toBeNull();
    });

    it('gives the room back if the card is dragged away again', async () => {
      const { grip, previewReturn, commitReturn } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, OVER_PANEL); });
      await act(async () => { fireEvent.pointerMove(grip, FAR_AWAY); });
      expect(previewReturn).toHaveBeenLastCalledWith(null);
      expect(document.querySelector('.dock-landing')).toBeNull();
      await act(async () => { fireEvent.pointerUp(grip, FAR_AWAY); });
      expect(commitReturn).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /move the card/i })).toBeInTheDocument(); // still docked
    });
  });
});
