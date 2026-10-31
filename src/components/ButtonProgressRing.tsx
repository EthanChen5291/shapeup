'use client';

import { useEffect, useRef, useState } from 'react';
import { pillOutlinePath } from '@/lib/outlinePath';

const STROKE = 2.5;
// The line is centred on the button's outer edge (half in, half out), so the
// canvas extends past the button by this much on every side.
const PAD = STROKE;

/**
 * A progress ring traced around its parent button's outline: starts at top
 * centre and runs counter-clockwise as `progress` goes 0 → 1. Render it as a
 * child of the (position: relative) button; it measures the button itself.
 */
export default function ButtonProgressRing({
  progress,
  label,
  radius = 14,
  border = 1,
}: {
  progress: number;
  label: string;
  /** The button's corner radius (px). */
  radius?: number;
  /** The button's border width (px); absolute offsets start inside it. */
  border?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ w: host.offsetWidth, h: host.offsetHeight }));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const W = size.w + 2 * PAD;
  const H = size.h + 2 * PAD;
  return (
    <svg
      ref={ref}
      className="btn-progress-ring"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      width={W}
      height={H}
      style={{ left: -border - PAD, top: -border - PAD }}
    >
      {size.w > 0 && progress > 0.004 && (
        <path
          d={pillOutlinePath(W, H, PAD, radius)}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - Math.min(1, progress)}
          strokeWidth={STROKE}
        />
      )}
    </svg>
  );
}
