// Where the "Show your barber" card goes when the edit panel is too tall for the
// viewport: it leaves the panel and floats over the render frame's bottom-right
// corner (the "dock"), where its buttons stay on screen. Pure geometry + the
// dock/undock decision live here so they can be unit-tested; BarberVideoCard
// does the measuring and the DOM moves.

export interface DockOffset { dx: number; dy: number }
export interface Box { left: number; top: number; width: number; height: number }

/** Inset from the frame's side edges — matches the polaroid in the top-right corner. */
export const DOCK_INSET = 14;
/** Inset from the frame's bottom edge — clears the scene's bottom control bar. */
export const DOCK_BOTTOM_INSET = 52;
export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 480;
/** The dock never takes more than this share of the frame's width. */
export const DOCK_MAX_FRAME_FRACTION = 0.42;
/** Extra room required before a docked card returns to the panel, so it can't flip-flop. */
export const DOCK_HYSTERESIS = 24;
/** Arrow keys move a docked card by this many px. */
export const DOCK_NUDGE = 16;
/** Pointer must travel this far before a press on the grip becomes a drag. */
export const DOCK_DRAG_THRESHOLD = 4;
export const DOCK_STORAGE_KEY = 'studio.videoDock';

/** The toolbox's smallest top padding once it is auto-fitting (TOOLBOX_MIN_PAD on the studio page). */
export const PANEL_MIN_PAD_TOP = 16;
/** Flex gap between the card and the toolbox above it. */
export const PANEL_CARD_GAP = 12;
/** The panel's max-height is calc(100vh - 0.75rem). */
export const PANEL_VIEWPORT_MARGIN = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Vertical room the panel has for the card once everything else in it is laid
 * out at the panel's tightest fit. `slotHeight` is whatever the card's slot
 * currently occupies (the card, a spacer, or 0 while docked) so the answer is
 * the same whether or not the card is in the panel right now.
 */
export function freeHeightForCard({ viewportHeight, contentHeight, slotHeight, padBottom }: {
  viewportHeight: number; contentHeight: number; slotHeight: number; padBottom: number;
}): number {
  const available = viewportHeight - PANEL_VIEWPORT_MARGIN;
  return available - PANEL_MIN_PAD_TOP - padBottom - (contentHeight - slotHeight);
}

/** Dock when the card would overflow the panel; return only once there is clearly room. */
export function decideDock(docked: boolean, freeHeight: number, cardHeight: number): boolean {
  const needed = cardHeight + PANEL_CARD_GAP;
  if (!docked) return needed > freeHeight;
  return needed + DOCK_HYSTERESIS > freeHeight;
}

/** Docked width: the panel's width, capped by the frame; never narrower than the minimum that fits. */
export function dockWidth(frameWidth: number, panelWidth: number): number {
  const fits = Math.max(0, frameWidth - 2 * DOCK_INSET);
  const w = Math.min(panelWidth, Math.floor(frameWidth * DOCK_MAX_FRAME_FRACTION), DOCK_MAX_WIDTH);
  return Math.round(clamp(w, Math.min(DOCK_MIN_WIDTH, fits), fits));
}

/** The card's box in viewport px: the frame's bottom-right corner plus the user's offset, kept inside the frame. */
export function dockRect(frame: Box, width: number, cardHeight: number, offset: DockOffset): Box {
  const minLeft = frame.left + DOCK_INSET;
  const maxLeft = Math.max(minLeft, frame.left + frame.width - DOCK_INSET - width);
  const minTop = frame.top + DOCK_INSET;
  const maxTop = Math.max(minTop, frame.top + frame.height - DOCK_BOTTOM_INSET - cardHeight);
  return {
    left: Math.round(clamp(maxLeft + offset.dx, minLeft, maxLeft)),
    top: Math.round(clamp(maxTop + offset.dy, minTop, maxTop)),
    width,
    height: cardHeight,
  };
}

/** The offset that reproduces where the card actually landed, so a stored offset never points off-frame. */
export function normalizeDockOffset(frame: Box, width: number, cardHeight: number, offset: DockOffset): DockOffset {
  const r = dockRect(frame, width, cardHeight, offset);
  const anchor = dockRect(frame, width, cardHeight, { dx: 0, dy: 0 });
  return { dx: r.left - anchor.left, dy: r.top - anchor.top };
}

/** Arrow-key nudge; null for any other key. */
export function nudgeDockOffset(offset: DockOffset, key: string): DockOffset | null {
  switch (key) {
    case 'ArrowLeft': return { dx: offset.dx - DOCK_NUDGE, dy: offset.dy };
    case 'ArrowRight': return { dx: offset.dx + DOCK_NUDGE, dy: offset.dy };
    case 'ArrowUp': return { dx: offset.dx, dy: offset.dy - DOCK_NUDGE };
    case 'ArrowDown': return { dx: offset.dx, dy: offset.dy + DOCK_NUDGE };
    default: return null;
  }
}

/** How close (px) a dragged card's pointer must come to the panel to start offering the way back. */
export const DOCK_RETURN_MARGIN = 40;

/** Whether the pointer is over the panel, or within `margin` px of it. */
export function nearBox(x: number, y: number, box: Box, margin = DOCK_RETURN_MARGIN): boolean {
  return x >= box.left - margin && x <= box.left + box.width + margin
    && y >= box.top - margin && y <= box.top + box.height + margin;
}

/**
 * Extra room (px) the panel must give up to take a docked card back, so that
 * once it's in, decideDock keeps it there (hysteresis included). 0 = it fits as is.
 */
export function returnRoom(freeHeight: number, cardHeight: number): number {
  return Math.max(0, Math.ceil(cardHeight + PANEL_CARD_GAP + DOCK_HYSTERESIS - freeHeight));
}

export const DOCK_HOME: DockOffset = { dx: 0, dy: 0 };

export function readDockOffset(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DockOffset {
  try {
    const raw = storage?.getItem(DOCK_STORAGE_KEY);
    if (!raw) return DOCK_HOME;
    const v = JSON.parse(raw) as Partial<DockOffset>;
    if (typeof v?.dx !== 'number' || typeof v?.dy !== 'number' || !Number.isFinite(v.dx) || !Number.isFinite(v.dy)) return DOCK_HOME;
    return { dx: v.dx, dy: v.dy };
  } catch {
    return DOCK_HOME;
  }
}

export function writeDockOffset(offset: DockOffset, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (offset.dx === 0 && offset.dy === 0) storage?.removeItem(DOCK_STORAGE_KEY);
    else storage?.setItem(DOCK_STORAGE_KEY, JSON.stringify(offset));
  } catch { /* storage unavailable */ }
}

// ── User placement (drag the card where you want it) ─────────────────────────
// 'auto' = the original behaviour (float only when the panel would overflow).
// Once the user drops the card somewhere it stays there: at the top or bottom of
// the panel (the panel scrolls / the trending list shortens instead), or floating
// over the render frame.
export type DockPlacement = 'auto' | 'top' | 'bottom' | 'float';
export const DOCK_PLACEMENT_KEY = 'studio.videoDockPlacement';
const PLACEMENTS: readonly DockPlacement[] = ['auto', 'top', 'bottom', 'float'];

export function readDockPlacement(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DockPlacement {
  try {
    const v = storage?.getItem(DOCK_PLACEMENT_KEY);
    return (PLACEMENTS as readonly string[]).includes(v ?? '') ? (v as DockPlacement) : 'auto';
  } catch { return 'auto'; }
}
export function writeDockPlacement(p: DockPlacement, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (p === 'auto') storage?.removeItem(DOCK_PLACEMENT_KEY);
    else storage?.setItem(DOCK_PLACEMENT_KEY, p);
  } catch { /* storage unavailable */ }
}

/** Where a drop at (x, y) lands: the panel's top or bottom half, the render frame, or nowhere valid. */
export type DropTarget = 'top' | 'bottom' | 'float' | 'none';
/** Forgiveness around the panel edge for drops (small, so it can't steal frame drops). */
export const DROP_PANEL_MARGIN = 16;
export function dropTargetFor(x: number, y: number, panel: Box, frame: Box): DropTarget {
  if (nearBox(x, y, panel, DROP_PANEL_MARGIN)) return y < panel.top + panel.height / 2 ? 'top' : 'bottom';
  if (nearBox(x, y, frame, 0)) return 'float';
  return 'none';
}

// ── Floating size (bottom-right resize grip) ─────────────────────────────────
// Only applies while floating; the card goes back to its natural size in the
// panel, and the last manual size comes back the next time it floats.
export interface FloatSize { w: number; h: number }
export const DOCK_SIZE_KEY = 'studio.videoDockSize';
/** Smallest floating height; the card's own content height is the real floor (CSS min-height). */
export const DOCK_MIN_HEIGHT = 120;

/** Keep a floating size inside the frame (within its insets) and above the minimums. */
export function clampFloatSize(size: FloatSize, frame: Box): FloatSize {
  const maxW = Math.max(DOCK_MIN_WIDTH, frame.width - 2 * DOCK_INSET);
  const maxH = Math.max(DOCK_MIN_HEIGHT, frame.height - DOCK_INSET - DOCK_BOTTOM_INSET);
  return {
    w: Math.round(clamp(size.w, Math.min(DOCK_MIN_WIDTH, maxW), maxW)),
    h: Math.round(clamp(size.h, Math.min(DOCK_MIN_HEIGHT, maxH), maxH)),
  };
}

export function readFloatSize(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): FloatSize | null {
  try {
    const raw = storage?.getItem(DOCK_SIZE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<FloatSize>;
    if (typeof v?.w !== 'number' || typeof v?.h !== 'number' || !(v.w > 0) || !(v.h > 0)) return null;
    return { w: v.w, h: v.h };
  } catch { return null; }
}
export function writeFloatSize(size: FloatSize | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (!size) storage?.removeItem(DOCK_SIZE_KEY);
    else storage?.setItem(DOCK_SIZE_KEY, JSON.stringify(size));
  } catch { /* storage unavailable */ }
}

/** Floating card's narrowest manual width: the three action buttons never squeeze. */
export const FLOAT_MIN_WIDTH = 280;

/**
 * Width for a corner-grip drag. Only the horizontal component resizes — so a
 * horizontal or diagonal drag works and a straight-down drag does nothing — and
 * the height follows the content (the preview keeps its proportions). The width
 * is capped so the card's height, which grows ~proportionally, stays inside the
 * frame: `startH` is the card's height at `startW`.
 */
export function floatWidthForDrag(startW: number, startH: number, dx: number, frame: Box): number {
  const maxW = Math.max(FLOAT_MIN_WIDTH, frame.width - 2 * DOCK_INSET);
  const maxH = Math.max(DOCK_MIN_HEIGHT, frame.height - DOCK_INSET - DOCK_BOTTOM_INSET);
  const byHeight = startH > 0 ? Math.floor((startW * maxH) / startH) : maxW;
  const hi = Math.max(FLOAT_MIN_WIDTH, Math.min(maxW, byHeight));
  // The floor never forces growth: a card that starts narrower than the minimum
  // (its default width in a small frame) only gets wider when dragged wider.
  const lo = Math.min(FLOAT_MIN_WIDTH, startW, hi);
  return Math.round(clamp(startW + dx, lo, Math.max(lo, hi)));
}
