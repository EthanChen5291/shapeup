// Rounded-rect outline geometry for the progress rings traced around buttons.
//
// The path starts at top centre and runs counter-clockwise: left along the top,
// down the left side, right along the bottom, up the right side, back to the top.
// Draw it with pathLength={1} so dash values are fractions of the outline.

/**
 * A rounded-rect outline (corner radius `radius`, capped at a full pill) that
 * starts at top centre and runs counter-clockwise back to it.
 */
export function pillOutlinePath(w: number, h: number, inset: number, radius = Infinity): string {
  const x0 = inset, x1 = w - inset, y0 = inset, y1 = h - inset;
  const r = Math.max(0, Math.min(radius, (y1 - y0) / 2, (x1 - x0) / 2));
  const cx = w / 2;
  return [
    `M ${cx} ${y0}`,
    `L ${x0 + r} ${y0}`,
    `A ${r} ${r} 0 0 0 ${x0} ${y0 + r}`, // top-left corner
    `L ${x0} ${y1 - r}`,
    `A ${r} ${r} 0 0 0 ${x0 + r} ${y1}`, // bottom-left corner
    `L ${x1 - r} ${y1}`,
    `A ${r} ${r} 0 0 0 ${x1} ${y1 - r}`, // bottom-right corner
    `L ${x1} ${y0 + r}`,
    `A ${r} ${r} 0 0 0 ${x1 - r} ${y0}`, // top-right corner
    `L ${cx} ${y0}`,
  ].join(' ');
}
