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


describe('user placement + floating size', () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

  it('dropTargetFor: panel top half / bottom half, then the frame, else nowhere', async () => {
    const { dropTargetFor } = await import('./videoDock');
    const frame = { left: 0, top: 0, width: 640, height: 700 };
    const panel = { left: 660, top: 0, width: 340, height: 700 };
    expect(dropTargetFor(800, 100, panel, frame)).toBe('top');
    expect(dropTargetFor(800, 600, panel, frame)).toBe('bottom');
    expect(dropTargetFor(300, 300, panel, frame)).toBe('float');
    expect(dropTargetFor(650, 650, panel, frame)).toBe('bottom'); // within the panel's 16px margin (644+), the panel wins
    expect(dropTargetFor(300, 900, panel, frame)).toBe('none');
  });

  it('placement round-trips; auto clears the key; junk falls back to auto', async () => {
    const { readDockPlacement, writeDockPlacement, DOCK_PLACEMENT_KEY } = await import('./videoDock');
    const s = memory();
    writeDockPlacement('top', s);
    expect(readDockPlacement(s)).toBe('top');
    writeDockPlacement('auto', s);
    expect(s.m.has(DOCK_PLACEMENT_KEY)).toBe(false);
    s.setItem(DOCK_PLACEMENT_KEY, 'sideways');
    expect(readDockPlacement(s)).toBe('auto');
  });

  it('clampFloatSize keeps the card inside the frame insets and above the minimums', async () => {
    const { clampFloatSize, DOCK_MIN_WIDTH, DOCK_MIN_HEIGHT, DOCK_INSET, DOCK_BOTTOM_INSET } = await import('./videoDock');
    const frame = { left: 0, top: 0, width: 640, height: 700 };
    expect(clampFloatSize({ w: 9999, h: 9999 }, frame)).toEqual({ w: 640 - 2 * DOCK_INSET, h: 700 - DOCK_INSET - DOCK_BOTTOM_INSET });
    expect(clampFloatSize({ w: 10, h: 10 }, frame)).toEqual({ w: DOCK_MIN_WIDTH, h: DOCK_MIN_HEIGHT });
    expect(clampFloatSize({ w: 400, h: 300 }, frame)).toEqual({ w: 400, h: 300 });
  });

  it('float size round-trips and rejects junk', async () => {
    const { readFloatSize, writeFloatSize, DOCK_SIZE_KEY } = await import('./videoDock');
    const s = memory();
    writeFloatSize({ w: 420, h: 360 }, s);
    expect(readFloatSize(s)).toEqual({ w: 420, h: 360 });
    s.setItem(DOCK_SIZE_KEY, '{"w":-1,"h":2}');
    expect(readFloatSize(s)).toBeNull();
    writeFloatSize(null, s);
    expect(s.m.has(DOCK_SIZE_KEY)).toBe(false);
  });
});

describe('floatWidthForDrag', () => {
  const frame = { left: 0, top: 0, width: 900, height: 700 };
  it('only the horizontal component resizes: a straight-down drag changes nothing', async () => {
    const { floatWidthForDrag } = await import('./videoDock');
    expect(floatWidthForDrag(340, 140, 0, frame)).toBe(340);
    expect(floatWidthForDrag(340, 140, 60, frame)).toBe(400);
  });
  it('never narrower than the minimum (buttons stay comfortable)', async () => {
    const { floatWidthForDrag, FLOAT_MIN_WIDTH } = await import('./videoDock');
    expect(floatWidthForDrag(340, 140, -500, frame)).toBe(FLOAT_MIN_WIDTH);
  });
  it('a card that starts below the minimum is not forced wider just by grabbing the corner', async () => {
    const { floatWidthForDrag } = await import('./videoDock');
    expect(floatWidthForDrag(268, 120, 0, frame)).toBe(268);
    expect(floatWidthForDrag(268, 120, -40, frame)).toBe(268);
    expect(floatWidthForDrag(268, 120, 30, frame)).toBe(298);
  });
  it('caps the width so the proportionally growing height still fits the frame', async () => {
    const { floatWidthForDrag, DOCK_INSET, DOCK_BOTTOM_INSET } = await import('./videoDock');
    // A tall card (340 wide × 420 high): the frame allows 700 − 14 − 52 = 634 high → width ≤ 340 × 634 / 420 = 513.
    expect(floatWidthForDrag(340, 420, 1000, frame)).toBe(Math.floor((340 * (700 - DOCK_INSET - DOCK_BOTTOM_INSET)) / 420));
  });
});

