'use client';

// The take clock. A ring rather than a bare number because the client is
// looking at this too, from a chair, without their glasses — a sweeping arc
// reads as "time left" at a glance where "0:18" does not.
//
// The numeral stays, in tabular figures so the width doesn't jitter every
// tenth of a second, and the whole thing is announced politely rather than
// assertively: a screen reader shouldn't interrupt every second of a take.

interface CountdownRingProps {
  elapsedMs: number;
  totalMs: number;
  /** Warn state — the last few seconds. */
  urgentAtMs?: number;
  label: string;
}

const SIZE = 92;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CountdownRing({
  elapsedMs,
  totalMs,
  urgentAtMs = 5_000,
  label,
}: CountdownRingProps) {
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = remainingMs <= urgentAtMs;

  return (
    <div className={`chair-ring${urgent ? ' is-urgent' : ''}`} role="timer" aria-live="off">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        <circle
          className="chair-ring-track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          className="chair-ring-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span className="chair-ring-num font-mono" aria-hidden>
        {seconds}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
