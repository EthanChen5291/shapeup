import { describe, expect, it } from 'vitest';
import {
  DOCK_BOTTOM_INSET, DOCK_HYSTERESIS, DOCK_INSET, DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, DOCK_NUDGE, DOCK_STORAGE_KEY,
  PANEL_CARD_GAP, PANEL_MIN_PAD_TOP, PANEL_VIEWPORT_MARGIN,
  decideDock, dockRect, dockWidth, freeHeightForCard, normalizeDockOffset, nudgeDockOffset, readDockOffset, writeDockOffset,
} from './videoDock';

const frame = { left: 100, top: 80, width: 900, height: 700 };

describe('freeHeightForCard', () => {
  it('is the viewport minus the panel chrome and everything that is not the card', () => {
    // Card at rest: the slot holds the card, so it is excluded from "everything else".
    expect(freeHeightForCard({ viewportHeight: 800, contentHeight: 600, slotHeight: 150, padBottom: 16 }))
      .toBe(800 - PANEL_VIEWPORT_MARGIN - PANEL_MIN_PAD_TOP - 16 - 450);
    // Docked: the slot is 0 and the content is 450 — same answer, so docking can't change the verdict by itself.
    expect(freeHeightForCard({ viewportHeight: 800, contentHeight: 450, slotHeight: 0, padBottom: 16 }))
      .toBe(800 - PANEL_VIEWPORT_MARGIN - PANEL_MIN_PAD_TOP - 16 - 450);
  });
});

describe('decideDock', () => {
  const card = 150;
  it('docks only once the card would overflow', () => {
    expect(decideDock(false, card + PANEL_CARD_GAP, card)).toBe(false);
    expect(decideDock(false, card + PANEL_CARD_GAP - 1, card)).toBe(true);
  });
  it('stays docked until there is clearly room (hysteresis), so it cannot flip-flop', () => {
    const justFits = card + PANEL_CARD_GAP;
    expect(decideDock(true, justFits, card)).toBe(true);
    expect(decideDock(true, justFits + DOCK_HYSTERESIS - 1, card)).toBe(true);
    expect(decideDock(true, justFits + DOCK_HYSTERESIS, card)).toBe(false);
  });
});

describe('dockWidth', () => {
  it('uses the panel width when the frame allows it', () => {
    expect(dockWidth(1200, 370)).toBe(370);
  });
  it('is capped by the frame fraction and the max', () => {
    expect(dockWidth(800, 600)).toBe(Math.floor(800 * 0.42));
    expect(dockWidth(2000, 640)).toBe(DOCK_MAX_WIDTH);
  });
  it('never drops under the minimum unless the frame itself is narrower', () => {
    expect(dockWidth(1000, 100)).toBe(DOCK_MIN_WIDTH);
    expect(dockWidth(200, 100)).toBe(200 - 2 * DOCK_INSET);
  });
});

describe('dockRect', () => {
  it('sits in the frame’s bottom-right corner by default, above the control bar', () => {
    const r = dockRect(frame, 300, 150, { dx: 0, dy: 0 });
    expect(r).toEqual({ left: 100 + 900 - DOCK_INSET - 300, top: 80 + 700 - DOCK_BOTTOM_INSET - 150, width: 300, height: 150 });
  });
  it('applies the user’s offset but never leaves the frame', () => {
    const dragged = dockRect(frame, 300, 150, { dx: -200, dy: -100 });
    expect(dragged.left).toBe(100 + 900 - DOCK_INSET - 300 - 200);
    expect(dragged.top).toBe(80 + 700 - DOCK_BOTTOM_INSET - 150 - 100);
    const tooFar = dockRect(frame, 300, 150, { dx: -5000, dy: -5000 });
    expect(tooFar.left).toBe(frame.left + DOCK_INSET);
    expect(tooFar.top).toBe(frame.top + DOCK_INSET);
    const pastCorner = dockRect(frame, 300, 150, { dx: 500, dy: 500 });
    expect(pastCorner).toEqual(dockRect(frame, 300, 150, { dx: 0, dy: 0 }));
  });
  it('pins to the top-left inset when the card is taller or wider than the frame (zoomed-in viewports)', () => {
    const tiny = { left: 0, top: 0, width: 200, height: 120 };
    const r = dockRect(tiny, 180, 300, { dx: 0, dy: 0 });
    expect(r.left).toBe(DOCK_INSET);
    expect(r.top).toBe(DOCK_INSET);
  });
});

describe('normalizeDockOffset', () => {
  it('keeps an in-range offset and trims one that was clamped', () => {
    expect(normalizeDockOffset(frame, 300, 150, { dx: -40, dy: -60 })).toEqual({ dx: -40, dy: -60 });
    const n = normalizeDockOffset(frame, 300, 150, { dx: -9999, dy: 50 });
    const home = dockRect(frame, 300, 150, { dx: 0, dy: 0 });
    expect(n).toEqual({ dx: frame.left + DOCK_INSET - home.left, dy: 0 });
  });
});

describe('nudgeDockOffset', () => {
  it('moves by the nudge step per arrow and ignores other keys', () => {
    expect(nudgeDockOffset({ dx: 0, dy: 0 }, 'ArrowLeft')).toEqual({ dx: -DOCK_NUDGE, dy: 0 });
    expect(nudgeDockOffset({ dx: 0, dy: 0 }, 'ArrowUp')).toEqual({ dx: 0, dy: -DOCK_NUDGE });
    expect(nudgeDockOffset({ dx: -10, dy: -10 }, 'ArrowRight')).toEqual({ dx: -10 + DOCK_NUDGE, dy: -10 });
    expect(nudgeDockOffset({ dx: -10, dy: -10 }, 'ArrowDown')).toEqual({ dx: -10, dy: -10 + DOCK_NUDGE });
    expect(nudgeDockOffset({ dx: 0, dy: 0 }, 'Enter')).toBeNull();
  });
});

describe('dock offset storage', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const m = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      map: m,
    };
  }
  it('round-trips, and clears the key when the card is back home', () => {
    const s = fakeStorage();
    writeDockOffset({ dx: -30, dy: -12 }, s);
    expect(readDockOffset(s)).toEqual({ dx: -30, dy: -12 });
    writeDockOffset({ dx: 0, dy: 0 }, s);
    expect(s.map.has(DOCK_STORAGE_KEY)).toBe(false);
    expect(readDockOffset(s)).toEqual({ dx: 0, dy: 0 });
  });
  it('falls back to home on missing, corrupt, or non-numeric values', () => {
    expect(readDockOffset(undefined)).toEqual({ dx: 0, dy: 0 });
    expect(readDockOffset(fakeStorage({ [DOCK_STORAGE_KEY]: '{nope' }))).toEqual({ dx: 0, dy: 0 });
    expect(readDockOffset(fakeStorage({ [DOCK_STORAGE_KEY]: '{"dx":"a","dy":1}' }))).toEqual({ dx: 0, dy: 0 });
  });
});

describe('drag back to the panel', () => {
  it('nearBox counts the panel plus a margin around it', async () => {
    const { nearBox, DOCK_RETURN_MARGIN } = await import('./videoDock');
    const panel = { left: 1000, top: 0, width: 400, height: 800 };
    expect(nearBox(1100, 300, panel)).toBe(true);
    expect(nearBox(1000 - DOCK_RETURN_MARGIN + 1, 300, panel)).toBe(true);
    expect(nearBox(900, 300, panel)).toBe(false);
  });
  it('returnRoom is what the card still needs, hysteresis included, never negative', async () => {
    const { returnRoom, PANEL_CARD_GAP, DOCK_HYSTERESIS } = await import('./videoDock');
    expect(returnRoom(56, 120)).toBe(120 + PANEL_CARD_GAP + DOCK_HYSTERESIS - 56);
    expect(returnRoom(1000, 120)).toBe(0);
  });
});

