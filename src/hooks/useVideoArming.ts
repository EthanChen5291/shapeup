'use client';

import { useEffect, useState } from 'react';

// Decorative <video>s get their `src` only once they're "armed", so the first
// paint isn't competing with megabytes of clips nobody is looking at yet.

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
