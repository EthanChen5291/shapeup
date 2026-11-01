// Landing-page head videos: only react to the wheel / a swipe when the pointer is
// actually over the head, not anywhere in the (much larger) hero box around it.
// Outside the radius the event is left alone, so the page scrolls normally.

export interface BoxLike { left: number; top: number; width: number; height: number }

/** Point is within `radius` (px) of the box's centre. */
export function withinHeadRadius(x: number, y: number, box: BoxLike, radius: number): boolean {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  return Math.hypot(x - cx, y - cy) <= radius;
}

/** Hero 1: the visible circle is 82% of the box width, so its radius is 41% of the width. */
export const HERO_CIRCLE_RADIUS_FRACTION = 0.41;
/** Hero 2: blob-masked video scaled to 85%; the head itself sits within ~36% of the smaller side. */
export const HERO_BLOB_RADIUS_FRACTION = 0.36;

export function heroCircleRadius(box: BoxLike): number {
  return box.width * HERO_CIRCLE_RADIUS_FRACTION;
}
export function heroBlobRadius(box: BoxLike): number {
  return Math.min(box.width, box.height) * HERO_BLOB_RADIUS_FRACTION;
}
