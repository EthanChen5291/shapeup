'use client';

// CaptureGlyph — the "camera at work" mark for the 360° capture overlay.
//
// Drawn in the Drift language (thick solid outlines, white-hot cooldowns,
// stepped frame swaps, ring emission, no gradients/blur) with ShapeUp's colours:
//   enter      → body arrives white-hot and cools to a tomato outline; the hump
//                and lens extrude; the lens hole punches through (mass → detail → holes)
//   recording  → a comet orbits the lens one step per beat, the inner mark cycles
//                a 4-frame sprite, the rec dot pulses hot, and every 2.4 s the
//                shutter fills the lens white and hollows out
//   encoding   → the comet stops; the lens emits two rings out past the body
//                (outer-first decay) and a solid core marks the work landing
// Timing is all CSS (see CaptureGlyph.module.css) so it runs without JS ticks.

import styles from './CaptureGlyph.module.css';

export type CaptureGlyphState = 'recording' | 'encoding';

const LENS = { cx: 32, cy: 35, r: 10.5 };
const SEGMENTS = 12;
const TAU = Math.PI * 2;

/** One arc segment of the lens ring (a 12-cell comet track). */
function segment(i: number, gap = 0.05): string {
  const a0 = (i / SEGMENTS) * TAU - Math.PI / 2 + gap;
  const a1 = ((i + 1) / SEGMENTS) * TAU - Math.PI / 2 - gap;
  const q = (v: number) => Math.round(v * 100) / 100;
  const { cx, cy, r } = LENS;
  return `M ${q(cx + Math.cos(a0) * r)} ${q(cy + Math.sin(a0) * r)} A ${r} ${r} 0 0 1 ${q(cx + Math.cos(a1) * r)} ${q(cy + Math.sin(a1) * r)}`;
}

// Comet: white head, two body cells, two stepped-darker tail cells.
const COMET = ['var(--hot)', 'var(--cam)', 'var(--cam)', 'var(--cam-2)', 'var(--cam-3)'];

export default function CaptureGlyph({ state, size = 84, label }: { state: CaptureGlyphState; size?: number; label?: string }) {
  const encoding = state === 'encoding';
  const outline = { fill: 'none', stroke: 'var(--cam)', strokeWidth: 4.5, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
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
      {/* mass: the body slab */}
      <g className={styles.slab}>
        <rect className={styles.body} x={6} y={18} width={52} height={34} rx={8} strokeWidth={4.5} strokeLinejoin="round" />
      </g>

      {/* detail: the viewfinder hump, the lens ring track, the rec dot */}
      <g className={styles.detail}>
        <path d="M21 18 L24.5 11 H39.5 L43 18" {...outline} fill="var(--ground)" />
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <path key={i} d={segment(i)} fill="none" stroke="var(--cam-3)" strokeWidth={4.5} strokeLinecap="butt" />
        ))}
        <circle className={encoding ? undefined : styles.rec} cx={50} cy={26} r={2.8} fill="var(--cam)" />
      </g>

      {!encoding && (
        <g className={styles.comet}>
          {COMET.map((c, k) => (
            <path key={k} d={segment((SEGMENTS - k) % SEGMENTS)} fill="none" stroke={c} strokeWidth={4.5} strokeLinecap="butt" />
          ))}
        </g>
      )}
      {encoding && (
        <circle cx={LENS.cx} cy={LENS.cy} r={LENS.r} fill="none" stroke="var(--cam)" strokeWidth={4.5} />
      )}

      {/* holes: the inner mark (sprite while recording; solid core once encoding) */}
      <g className={styles.hole}>
        {encoding ? (
          <circle className={styles.core} cx={LENS.cx} cy={LENS.cy} r={5.5} fill="var(--cam)" />
        ) : (
          <>
            <circle className={`${styles.frame} ${styles.frame1}`} cx={LENS.cx} cy={LENS.cy} r={3} fill="var(--cam)" />
            <circle className={`${styles.frame} ${styles.frame2}`} cx={LENS.cx} cy={LENS.cy} r={4.5} fill="none" stroke="var(--cam)" strokeWidth={2.6} />
            <g className={`${styles.frame} ${styles.frame3}`}>
              <circle cx={LENS.cx} cy={LENS.cy} r={2} fill="var(--cam)" />
              <circle cx={LENS.cx} cy={LENS.cy} r={5.5} fill="none" stroke="var(--cam)" strokeWidth={2.2} />
            </g>
            <circle className={`${styles.frame} ${styles.frame4}`} cx={LENS.cx} cy={LENS.cy} r={6} fill="none" stroke="var(--cam)" strokeWidth={2.6} />
          </>
        )}
      </g>

      {/* shutter: white disc fills the lens, then hollows out */}
      {!encoding && <circle className={styles.shutter} cx={LENS.cx} cy={LENS.cy} r={LENS.r - 2.25} fill="var(--hot)" />}

      {/* ring emission while finishing */}
      {encoding && (
        <>
          {/* born 50 ms apart, grow past the body, outer one steps dark and goes first */}
          <circle className={styles.ring} cx={LENS.cx} cy={LENS.cy} r={31} fill="none" strokeWidth={3} />
          <circle className={`${styles.ring} ${styles.ring2}`} cx={LENS.cx} cy={LENS.cy} r={25} fill="none" strokeWidth={3} />
        </>
      )}
    </svg>
  );
}
