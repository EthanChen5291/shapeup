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
  // Placement / float size are remembered per browser. Fresh in-memory storage per
  // test (Node's own global localStorage is undefined here and shadows jsdom's).
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
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
  it('stays in the panel while there is room (grip available to drag it out; no resize corner)', async () => {
    setup(300);
    await settle();
    expect(screen.getByTestId('content').querySelector('.rounded-2xl')).not.toBeNull();
    expect(screen.getByRole('button', { name: /move the card/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resize the card/i })).toBeNull();
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
    expect(screen.getByTestId('content').querySelector('.rounded-2xl')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /resize the card/i })).toBeNull();
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

    it("makes room at once while hovering over the panel: a plain gap of the card's size, no outline", async () => {
      const { grip, previewReturn } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, OVER_PANEL); });
      expect(previewReturn).toHaveBeenCalledWith(100);
      const slot = document.querySelector('[data-slot-end]') as HTMLElement;
      expect(slot.style.height).toBe('120px');
      expect(slot.style.transition).toBe('none'); // no delay
      expect(slot.className).not.toMatch(/landing/);
    });

    it('drops back into the panel, keeps the room, and stays there — even if the panel overflows again', async () => {
      const { grip, commitReturn } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, OVER_PANEL); });
      await act(async () => { fireEvent.pointerUp(grip, OVER_PANEL); });
      expect(commitReturn).toHaveBeenCalledTimes(1);
      heights.set(screen.getByTestId('content'), 600); // the list gave up its 100 px
      await settle();
      expect(screen.getByTestId('content').querySelector('.rounded-2xl')).not.toBeNull();
      heights.set(screen.getByTestId('content'), 700); // overflowing again: the user's placement holds
      await settle();
      expect(screen.getByTestId('content').querySelector('.rounded-2xl')).not.toBeNull();
    });

    it("the panel's top half puts the card first (order -1); the bottom half puts it last", async () => {
      const { grip } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, { clientX: 500, clientY: 600 }); });
      expect((document.querySelector('[data-slot-end]') as HTMLElement).dataset.slotEnd).toBe('bottom');
      await act(async () => { fireEvent.pointerMove(grip, { clientX: 500, clientY: 100 }); });
      const slot = document.querySelector('[data-slot-end]') as HTMLElement;
      expect(slot.dataset.slotEnd).toBe('top');
      expect(slot.style.order).toBe('-1');
      await act(async () => { fireEvent.pointerUp(grip, { clientX: 500, clientY: 100 }); });
      expect(localStorage.getItem('studio.videoDockPlacement')).toBe('top');
    });

    it('gives the room back if the card is dragged away again', async () => {
      const { grip, previewReturn, commitReturn } = await dockedWithReturn();
      await act(async () => { fireEvent.pointerMove(grip, OVER_PANEL); });
      await act(async () => { fireEvent.pointerMove(grip, FAR_AWAY); });
      expect(previewReturn).toHaveBeenLastCalledWith(null);
      expect((document.querySelector('[data-slot-end]') as HTMLElement).style.height).toBe('0px');
      await act(async () => { fireEvent.pointerUp(grip, FAR_AWAY); });
      expect(commitReturn).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /move the card/i })).toBeInTheDocument(); // still docked
    });
  });

  describe('floating it from the panel, and resizing', () => {
    // Distinct boxes: the render frame on the left, the panel on the right.
    const box = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    beforeEach(() => {
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.tagName === 'ASIDE') return box(660, 0, 340, 700);
        if ((this as HTMLElement).dataset?.testid === 'frame') return box(0, 0, 640, 700);
        return box(700, 400, 300, 120);
      };
    });

    async function floatFromPanel() {
      setup(300); // plenty of room: the card starts in the panel
      await settle();
      const grip = screen.getByRole('button', { name: /move the card/i });
      fireEvent.pointerDown(grip, { button: 0, clientX: 720, clientY: 420 });
      await act(async () => { fireEvent.pointerMove(grip, { clientX: 300, clientY: 300 }); });
      await act(async () => { fireEvent.pointerUp(grip, { clientX: 300, clientY: 300 }); });
      await settle();
    }

    it('dropping it on the 3D view floats it there, and it stays floating', async () => {
      await floatFromPanel();
      expect(screen.getByTestId('content').querySelector('.rounded-2xl')).toBeNull();
      expect(screen.getByRole('button', { name: /resize the card/i })).toBeInTheDocument();
      expect(localStorage.getItem('studio.videoDockPlacement')).toBe('float');
    });

    it('a drop outside both the panel and the frame puts a panel card back in the panel', async () => {
      setup(300);
      await settle();
      const grip = screen.getByRole('button', { name: /move the card/i });
      fireEvent.pointerDown(grip, { button: 0, clientX: 720, clientY: 420 });
      await act(async () => { fireEvent.pointerMove(grip, { clientX: 300, clientY: 1200 }); });
      await act(async () => { fireEvent.pointerUp(grip, { clientX: 300, clientY: 1200 }); });
      await settle();
      expect(screen.getByTestId('content').querySelector('.rounded-2xl')).not.toBeNull();
      expect(localStorage.getItem('studio.videoDockPlacement')).toBeNull();
    });

    it('the corner grip sets a size that is used while floating, dropped in the panel, and restored when it floats again', async () => {
      await floatFromPanel();
      const corner = screen.getByRole('button', { name: /resize the card/i });
      fireEvent.pointerDown(corner, { button: 0, clientX: 600, clientY: 500 });
      await act(async () => { fireEvent.pointerMove(corner, { clientX: 700, clientY: 640 }); });
      await act(async () => { fireEvent.pointerUp(corner, { clientX: 700, clientY: 640 }); });
      const saved = JSON.parse(localStorage.getItem('studio.videoDockSize') ?? 'null');
      expect(saved).not.toBeNull();
      const card = () => document.querySelector('[data-barber-card]') as HTMLElement;
      expect(card().style.height).toBe(`${saved.h}px`);

      // Back into the panel (bottom half): natural size there.
      const grip = screen.getByRole('button', { name: /move the card/i });
      fireEvent.pointerDown(grip, { button: 0, clientX: 300, clientY: 300 });
      await act(async () => { fireEvent.pointerMove(grip, { clientX: 800, clientY: 600 }); });
      await act(async () => { fireEvent.pointerUp(grip, { clientX: 800, clientY: 600 }); });
      await settle();
      expect(screen.getByTestId('content').querySelector('[data-barber-card]')).not.toBeNull();
      expect(card().style.height).toBe('');

      // Out again: the manual size comes back.
      const grip2 = screen.getByRole('button', { name: /move the card/i });
      fireEvent.pointerDown(grip2, { button: 0, clientX: 720, clientY: 420 });
      await act(async () => { fireEvent.pointerMove(grip2, { clientX: 300, clientY: 300 }); });
      await act(async () => { fireEvent.pointerUp(grip2, { clientX: 300, clientY: 300 }); });
      await settle();
      expect(card().style.height).toBe(`${saved.h}px`);
    });
  });
});
