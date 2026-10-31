'use client';

import { useEffect, useState } from 'react';

/** The image URL inside a CSS background value like `url(/x.jpg) center / cover`. */
export function cssBackgroundUrl(background: string): string | null {
  const m = /url\((['"]?)(.*?)\1\)/.exec(background);
  return m ? m[2] : null;
}

/**
 * True once `url` has loaded (or failed — then show whatever the browser has),
 * so a layer can fade in instead of popping. No URL (a solid colour) is ready
 * immediately.
 */
export function useImageReady(url: string | null): boolean {
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = img.onerror = () => { if (alive) setReadyUrl(url); };
    img.src = url;
    if (img.complete) setReadyUrl(url); // already cached
    return () => { alive = false; };
  }, [url]);
  return !url || readyUrl === url;
}
