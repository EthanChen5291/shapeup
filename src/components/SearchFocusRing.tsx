'use client';

/**
 * SearchFocusRing — a single stroke that lights up a pill input's border from
 * the top centre, running clockwise and counter-clockwise at once until the
 * two ends meet at the bottom centre.
 *
 * Mount it absolutely inside the input's positioned wrapper. It measures the
 * wrapper and draws a pill path that starts at top centre; `pathLength=100`
 * plus a symmetric dash (`len (100-len)` with offset `len/2`) grows the lit
 * arc evenly in both directions. Stroke colour is `currentColor`. At rest the
 * stroke is hidden once the retract finishes — a zero-length dash with a round
 * cap would otherwise leave a dot at top centre.
 */

import { useLayoutEffect, useRef, useState } from 'react';

export const SEARCH_RING_SWEEP_MS = 380;
export const SEARCH_RING_RETRACT_MS = 280;

/** Pill outline starting at top centre and running clockwise (SVG path data). */
export function pillPath(width: number, height: number, strokeWidth: number): string {
  const inset = strokeWidth / 2;
  const x0 = inset, x1 = width - inset, y0 = inset, y1 = height - inset;
  const r = Math.max(0, (y1 - y0) / 2);
  const cl = x0 + r, cr = x1 - r;
  const f = (n: number) => +n.toFixed(2);
  return [
    `M ${f(width / 2)} ${f(y0)}`,
    `H ${f(cr)}`,
    `A ${f(r)} ${f(r)} 0 0 1 ${f(cr)} ${f(y1)}`,
    `H ${f(cl)}`,
    `A ${f(r)} ${f(r)} 0 0 1 ${f(cl)} ${f(y0)}`,
    'Z',
  ].join(' ');
}

/** Dash settings for a given lit fraction (0..1): symmetric about the path start. */
export function sweepDash(fraction: number): { dasharray: string; dashoffset: number } {
  const len = Math.max(0, Math.min(1, fraction)) * 100;
  return { dasharray: `${len} ${100 - len}`, dashoffset: len / 2 };
}

export function SearchFocusRing({ active, strokeWidth = 1.5, className }: { active: boolean; strokeWidth?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { dasharray, dashoffset } = sweepDash(active ? 1 : 0);
  const ms = active ? SEARCH_RING_SWEEP_MS : SEARCH_RING_RETRACT_MS;

  return (
    <svg
      ref={ref}
      className={className}
      aria-hidden
      data-active={active ? 'true' : 'false'}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
    >
      {size && (
        <path
          d={pillPath(size.w, size.h, strokeWidth)}
          pathLength={100}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{
            strokeDasharray: dasharray,
            strokeDashoffset: dashoffset,
            opacity: active ? 1 : 0,
            transition: `stroke-dasharray ${ms}ms cubic-bezier(.2,.7,.2,1), stroke-dashoffset ${ms}ms cubic-bezier(.2,.7,.2,1), opacity 0ms linear ${active ? 0 : ms}ms`,
          }}
        />
      )}
    </svg>
  );
}
