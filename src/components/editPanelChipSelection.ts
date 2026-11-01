// Mobile suggestion-chip selection logic, kept pure for unit testing.
//
// On mobile a chip can't be hovered, so tapping a chip *selects* it: the border
// glows and its preview stays up until the user taps another chip or taps the
// same one again (which un-selects it). Pressing Apply then applies the selected
// chip's text rather than whatever is in the prompt box.

/** Next selection after a tap: same chip toggles off, a different chip selects. */
export function nextSelectedChip(current: string | null, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

/** Which text Apply should run — the selected chip wins on mobile. */
export function resolveApplyPrompt(
  isMobile: boolean,
  selectedChip: string | null,
  prompt: string,
): string {
  return isMobile && selectedChip ? selectedChip : prompt;
}

/**
 * Keyword search over the trending-cut list. Every word must appear somewhere in
 * the cut (any order, case-insensitive), so "fade mid" finds "spiky eboy, mid fade".
 */
export function filterCuts(cuts: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return cuts;
  return cuts.filter((cut) => {
    const text = cut.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Below this the trending list isn't worth showing: a released drag folds it shut. */
export const CUT_LIST_FOLD_AT = 64;
/** Smallest open height (about two rows). */
export const CUT_LIST_MIN_OPEN = 96;

/** Where a released grip drag settles: folded shut (0), or at least two rows tall. */
export function snapCutListHeight(height: number): number {
  if (height < CUT_LIST_FOLD_AT) return 0;
  return Math.max(CUT_LIST_MIN_OPEN, height);
}

/**
 * The trending list's height after giving up `shrink` px (e.g. to take the
 * "Show your barber" card back into the panel): still at least two rows tall,
 * or folded shut if that's what it takes (also when even folding isn't enough).
 */
export function yieldCutListHeight(height: number, shrink: number): number | null {
  if (shrink <= 0) return height;
  // Give everything it can: if even folding shut isn't enough, fold shut anyway
  // (the panel scrolls for the rest) rather than refusing the card.
  if (shrink >= height) return 0;
  const left = height - shrink;
  return left >= CUT_LIST_MIN_OPEN ? left : 0;
}
