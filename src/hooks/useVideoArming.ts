'use client';

import { useEffect, useState } from 'react';

// Decorative <video>s get their `src` only once they're "armed", so the first
// paint isn't competing with megabytes of clips nobody is looking at yet. Each
// swiper keeps its neighbours armed at all times, so switching never waits on a
// download (and never shows a parked first frame).

/** Indices of a ring of `n` clips that must always be ready: the active one and both neighbours. */
export function ringNeighbors(active: number, n: number): Set<number> {
  if (n <= 0) return new Set();
  return new Set([active, (active + 1) % n, (active - 1 + n) % n]);
}

/** True once the page has finished loading and the browser is idle: arm the rest. */
export function useArmAfterLoad(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => setArmed(true), { timeout: 1500 });
      else timer = setTimeout(() => setArmed(true), 200);
    };
    if (document.readyState === 'complete') arm();
    else window.addEventListener('load', arm, { once: true });
    return () => {
      window.removeEventListener('load', arm);
      if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return armed;
}

/** True (and stays true) once `ref` comes within `margin` of the viewport. */
export function useNearViewport(ref: React.RefObject<Element | null>, margin = '800px'): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}
