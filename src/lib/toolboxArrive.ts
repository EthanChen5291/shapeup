// Studio arrival choreography: when the loading shadow lifts, the toolbox (and
// the barber-video card, wherever it sits — in the panel or docked over the
// render frame) arrives as a quick top → bottom sweep instead of popping in:
//
//   • surfaces — top-level blocks and the cards inside them — fade in with a
//     small drop;
//   • atoms — text, buttons, inputs, icons, images — mist in just after their
//     card (opacity + a light blur, a subtler version of the trending-cut list).
//
// Delays come from each element's vertical position, not its index, so a row
// arrives together and the sweep speed doesn't depend on how many items exist.
// Elements that already carry their own finite entrance animation (e.g. the
// trending-cut rows' mist) get that animation replayed instead of ours, so
// nothing double-fades. Pure DOM helpers so the plan can be unit-tested.

export type ArriveKind = 'surface' | 'atom';
export interface ArriveTarget { el: HTMLElement; kind: ArriveKind; delayMs: number }

export const ARRIVE_SURFACE_CLASS = 'arrive-surface';
export const ARRIVE_ATOM_CLASS = 'arrive-atom';
export const ARRIVE_DELAY_VAR = '--arrive-delay';
/** Delay added from the top of the sweep to one viewport-height below it. */
export const ARRIVE_SPAN_MS = 420;
/** Contents trail their card by this much, so text/buttons come on separately. */
export const ARRIVE_ATOM_LAG_MS = 70;
/** Longest of the two keyframe durations in globals.css. */
export const ARRIVE_DURATION_MS = 340;
/** Surfaces are only tracked this deep; deeper backgrounds ride with them. */
const SURFACE_DEPTH = 2;
const MAX_TARGETS = 140;

const ATOM_SELECTOR = [
  'button', 'a', 'input', 'textarea', 'select', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p',
  'img', 'svg', 'video', 'canvas', '[role="button"]', '[role="switch"]', '[role="tab"]',
].join(',');

function hasOwnText(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 && (n.textContent ?? '').trim()) return true;
  }
  return false;
}

/** Text, a control, or media: animated as one unit, never descended into. */
export function isAtom(el: Element): boolean {
  return el.matches(ATOM_SELECTOR) || hasOwnText(el);
}

function laidOut(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/**
 * Plan the sweep. `containers` contribute their children as top-level blocks
 * (the toolbox column); `standalone` elements are top-level blocks themselves
 * (the docked barber card, which lives in a body portal).
 */
export function planArrive(
  containers: Element[],
  standalone: Element[] = [],
  viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight,
): ArriveTarget[] {
  const found: Array<{ el: HTMLElement; kind: ArriveKind; order: number }> = [];
  const seen = new Set<Element>();
  const visit = (el: Element, depth: number) => {
    if (found.length >= MAX_TARGETS || seen.has(el)) return;
    seen.add(el);
    if (!laidOut(el)) return;
    if (isAtom(el)) { found.push({ el: el as HTMLElement, kind: 'atom', order: found.length }); return; }
    if (depth <= SURFACE_DEPTH) found.push({ el: el as HTMLElement, kind: 'surface', order: found.length });
    for (const c of Array.from(el.children)) visit(c, depth + 1);
  };
  for (const root of containers) for (const c of Array.from(root.children)) visit(c, 1);
  for (const el of standalone) visit(el, 1);
  if (!found.length) return [];

  const tops = new Map(found.map((f) => [f.el, f.el.getBoundingClientRect().top]));
  const minTop = Math.min(...tops.values());
  const span = Math.max(1, viewportHeight);
  return found
    .sort((a, b) => (tops.get(a.el)! - tops.get(b.el)!) || (a.order - b.order))
    .map(({ el, kind }) => {
      const t = Math.min(1, Math.max(0, (tops.get(el)! - minTop) / span));
      return { el, kind, delayMs: Math.round(t * ARRIVE_SPAN_MS + (kind === 'atom' ? ARRIVE_ATOM_LAG_MS : 0)) };
    });
}

/** Finite CSS animation already on the element (its own entrance), if any. */
function hasOwnEntrance(el: HTMLElement): boolean {
  if (typeof getComputedStyle !== 'function') return false;
  const cs = getComputedStyle(el);
  const name = cs.animationName;
  if (!name || name === 'none') return false;
  return !cs.animationIterationCount.split(',').some((c) => c.trim() === 'infinite');
}

/**
 * Apply the plan: tag targets with their class + delay (call before paint —
 * e.g. from a layout effect — or the first frame shows the finished panel).
 * Returns a cleanup that removes every tag; it also runs itself afterwards.
 */
export function stageArrive(containers: Array<Element | null | undefined>, standalone: Array<Element | null | undefined> = []): () => void {
  const plan = planArrive(
    containers.filter((x): x is Element => !!x),
    standalone.filter((x): x is Element => !!x),
  );
  const tagged: HTMLElement[] = [];
  const replay: HTMLElement[] = [];
  for (const { el, kind, delayMs } of plan) {
    if (hasOwnEntrance(el)) { replay.push(el); continue; }
    el.style.setProperty(ARRIVE_DELAY_VAR, `${delayMs}ms`);
    el.classList.add(kind === 'atom' ? ARRIVE_ATOM_CLASS : ARRIVE_SURFACE_CLASS);
    tagged.push(el);
  }
  // Restart own entrances (they already played while the panel was hidden).
  if (replay.length) {
    for (const el of replay) el.style.animation = 'none';
    void (replay[0] as HTMLElement).offsetWidth;
    for (const el of replay) el.style.animation = '';
  }
  const lastDelay = plan.reduce((m, p) => Math.max(m, p.delayMs), 0);
  const timer = setTimeout(cleanup, lastDelay + ARRIVE_DURATION_MS + 120);
  let done = false;
  function cleanup() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const el of tagged) {
      el.classList.remove(ARRIVE_SURFACE_CLASS, ARRIVE_ATOM_CLASS);
      el.style.removeProperty(ARRIVE_DELAY_VAR);
    }
  }
  return cleanup;
}
