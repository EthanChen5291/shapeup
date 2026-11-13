// Config and frame schedule for the turntable lab: one head, a list of try-on looks, one full
// turn. scripts/turntable-gif.mjs drives the page frame by frame to make the README GIF.

export interface TurntableParams {
  base: string;   // buzz-cut try-on base .splat (same-origin)
  meta: string;   // its meta.json sidecar (viewer transform); '' = the default transform
  size: number;   // canvas edge in CSS px (square)
  fov: number;    // vertical field of view; the camera distance stays the studio's, so this only crops
  y: number;      // world height the camera orbits and looks at
  bg: string;     // background colour
  hairAlpha: number; // extra opacity gain on the hair rows, on top of the cut's own (1 = as the studio draws it)
}

export const TURNTABLE_DEFAULTS: TurntableParams = {
  base: '/lab/turntable_base.splat',
  meta: '/lab/turntable_base.meta.json',
  size: 720,
  fov: 35,
  y: -0.2,
  bg: '#f6ecd8', // --biscuit: dark hair reads against it from every side
  hairAlpha: 1,
};

/** Same-origin absolute paths only: the page fetches whatever the URL names. */
const localPath = (v: string | null, fallback: string) => (v && v.startsWith('/') && !v.startsWith('//') ? v : fallback);
const finite = (v: string | null, fallback: number) => {
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function parseTurntableParams(q: URLSearchParams): TurntableParams {
  const d = TURNTABLE_DEFAULTS;
  const bg = q.get('bg');
  return {
    base: localPath(q.get('base'), d.base),
    meta: q.has('meta') && q.get('meta') === '' ? '' : localPath(q.get('meta'), d.meta),
    size: Math.min(2048, Math.max(64, Math.round(finite(q.get('size'), d.size)))),
    fov: Math.min(90, Math.max(5, finite(q.get('fov'), d.fov))),
    y: finite(q.get('y'), d.y),
    bg: bg && /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : d.bg,
    hairAlpha: Math.min(16, Math.max(0.1, finite(q.get('alpha'), d.hairAlpha))),
  };
}

export interface TurntableFrame { angle: number; look: number }

/**
 * Frame `i` of a loop of `frames` frames over `looks` looks: the camera goes once around
 * (frame 0 faces the front, and frame `frames` would be frame 0 again, so the GIF loops),
 * and every look is held for the same number of frames, in order.
 */
export function turntableFrame(i: number, frames: number, looks: number): TurntableFrame {
  const n = Math.max(1, Math.floor(frames));
  const k = ((Math.floor(i) % n) + n) % n;
  return { angle: (2 * Math.PI * k) / n, look: Math.min(Math.max(1, looks) - 1, Math.floor((k * Math.max(1, looks)) / n)) };
}
