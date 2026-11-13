// Desktop studio geometry shared by the studio page and the dashboard → studio
// ghost handoff (which has to draw the frame where the studio will, before the
// studio has mounted). Keep the JS and CSS forms of the top offset in sync.

/** Top offset shared by the render frame and the toolbox column (below the project title). */
export const studioTopPad = (viewportHeight: number) => Math.max(56, 118 - 0.04 * viewportHeight);
export const STUDIO_TOP_PAD_CSS = 'max(56px, calc(118px - 4vh))';

/** The resizable edit panel on the right; its width is cached per browser under `key`. */
export const STUDIO_SIDEBAR = { key: 'studio.sidebarWidth', initial: 370, min: 280, max: 640 } as const;
/** `.panel-resizer` between the render column and the edit panel. */
export const STUDIO_RESIZER_W = 10;

/** The edit-panel width this browser last used (what the studio will open with). */
export function readStoredSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(STUDIO_SIDEBAR.key));
    if (v) return Math.min(STUDIO_SIDEBAR.max, Math.max(STUDIO_SIDEBAR.min, Math.round(v)));
  } catch { /* storage unavailable */ }
  return STUDIO_SIDEBAR.initial;
}

// ── Short screens in the stacked (phone) layout ─────────────────────────────
// A desktop zoomed far in is narrow AND short in CSS px (e.g. ~430×257 at 350%).
// The studio then scrolls instead of squeezing everything into one screen.
export const SHORT_SCREEN_QUERY = '(max-height: 540px)';
export const SHORT_SCREEN_MAX_H = 540;
/** Render region height there (below the header): at least 300px (46vh would leave a sliver). */
export const MOBILE_SHORT_REGION_CSS = 'max(46vh, 300px)';
export const MOBILE_SHORT_REGION_MIN = 300;
/** Where the render frame starts there: below the in-flow header row (~52px) plus the region's 8px padding. */
export const MOBILE_SHORT_TOP = 60;
/** The polaroid scales with the screen height instead of a fixed 156px. */
export const MOBILE_SHORT_POLAROID_CSS = 'min(156px, 34vh)';

// ── Phones: the render fills the top; home, tools and the title sit in cutouts ──
/** The wrench menu's circles (.tool-circle) are 56px: the progress ring's corner radius. */
export const TOOL_CIRCLE_RADIUS = 28;
/** Height the try-on grid needs under the render: its 44px head row, 3 rows of 46px tiles
    with 8px gaps, plus the panel's own padding (10 top, 16 bottom). The grid never scrolls. */
export const MOBILE_TRYON_PANEL_H = 232;
