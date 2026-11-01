'use client';

// CaptureGlyph — the "camera at work" mark for the 360° capture overlay.
//
// One smooth, solid camera that floats while it works. The motion is organic
// rather than mechanical: a slow vertical bob and a gentle tilt run on nested
// groups with different, non-multiple durations, so the combined path drifts
// and never visibly loops.
//   recording → a soft glint sweeps continuously around the lens; the rec dot breathes
//   encoding  → the glint quickens and the lens core eases into focus
// Timing is all CSS (see CaptureGlyph.module.css), so it runs without JS ticks.

import styles from './CaptureGlyph.module.css';

export type CaptureGlyphState = 'recording' | 'encoding';

const LENS = { cx: 32, cy: 35, r: 10.5 };

export default function CaptureGlyph({ state, size = 84, label }: { state: CaptureGlyphState; size?: number; label?: string }) {
  const encoding = state === 'encoding';
  const { cx, cy, r } = LENS;
  return (
    <svg
      className={styles.root}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label ?? (encoding ? 'Finishing the 360° video' : 'Recording the 360° video')}
      data-state={state}
    >
      <g className={styles.bob}>
        <g className={styles.tilt}>
          {/* body + viewfinder hump: one solid outlined shape */}
          <path
            className={styles.body}
            d="M14 18 H21 L24.5 11 H39.5 L43 18 H50 A8 8 0 0 1 58 26 V44 A8 8 0 0 1 50 52 H14 A8 8 0 0 1 6 44 V26 A8 8 0 0 1 14 18 Z"
          />
          {/* lens: ring + dim glass */}
          <circle cx={cx} cy={cy} r={r} className={styles.lensRing} />
          <circle cx={cx} cy={cy} r={r - 3.6} className={styles.glass} />
          {/* a soft glint sweeping around the lens (continuous, not stepped) */}
          <g className={`${styles.glint}${encoding ? ` ${styles.glintFast}` : ''}`}>
            <path
              d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r * Math.sin(Math.PI / 3)} ${cy - r * Math.cos(Math.PI / 3)}`}
              className={styles.glintArc}
            />
          </g>
          {/* lens core: breathes while recording, eases into focus when finishing */}
          <circle cx={cx} cy={cy} r={3.4} className={`${styles.core}${encoding ? ` ${styles.coreFocus}` : ''}`} />
          {/* rec dot */}
          <circle cx={50} cy={26} r={2.8} className={encoding ? styles.recDone : styles.rec} />
        </g>
      </g>
    </svg>
  );
}
