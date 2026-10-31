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
