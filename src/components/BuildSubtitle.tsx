'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

export const BUILD_PHRASES = [
  'Building model',
  'Drawing blueprint',
  'Mapping your features',
  'Sculpting in 3D',
  'Tracing every angle',
  'Shaping the geometry',
  'Adding depth',
  'Refining the mesh',
  'Smoothing the surface',
  'Polishing details',
  'Aligning the lighting',
  'Almost there',
] as const;

interface BuildSubtitleProps {
  /** Text color; defaults to the standard processing cream. */
  color?: string;
  /** Font size in px; defaults to 14. */
  size?: number;
}

/**
 * Cycles through BUILD_PHRASES every 4 s, key-animating in each phrase.
 * Used both inside the ScanPopup during processing and over the BuildGhost
 * in the studio while the async build runs.
 */
export function BuildSubtitle({ color = 'rgba(255,248,234,0.8)', size = 14 }: BuildSubtitleProps) {
  const t = useT();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIdx(i => i + 1), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p
      key={idx}
      className="chatter-line"
      style={{
        fontFamily: 'var(--font-dmsans)',
        fontSize: size,
        fontWeight: 600,
        color,
        marginTop: 4,
        fontStyle: 'italic',
        textAlign: 'center',
      }}
    >
      {t(BUILD_PHRASES[idx % BUILD_PHRASES.length])}…
    </p>
  );
}
