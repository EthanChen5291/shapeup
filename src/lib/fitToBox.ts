// Keep a fixed-height textarea from ever scrolling: its capacity is whatever
// fits in the box. Typing past the edge is ignored, and a paste is trimmed to
// the longest prefix that still fits.

/** The part of `next` that fits in `el` without overflowing. Leaves `el.value` as given. */
export function fitToBox(el: Pick<HTMLTextAreaElement, 'value' | 'scrollHeight' | 'clientHeight'>, next: string): string {
  const original = el.value;
  const fits = (text: string) => {
    el.value = text;
    return el.scrollHeight <= el.clientHeight + 1; // +1: sub-pixel rounding
  };
  try {
    if (fits(next)) return next;
    // Binary search the longest prefix that fits.
    let lo = 0;
    let hi = next.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(next.slice(0, mid))) lo = mid;
      else hi = mid - 1;
    }
    return next.slice(0, lo);
  } finally {
    el.value = original;
  }
}
