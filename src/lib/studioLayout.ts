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
