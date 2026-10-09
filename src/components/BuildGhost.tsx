'use client';

import { ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import { BuildSubtitle } from './BuildSubtitle';

interface BuildGhostProps {
  /** 'building': animated speckle + subtitle.
   *  'failed':   same ghost but dimmed, shows children (error card).
   *  'revealing': ghost fades out while the real render is unveiled. */
  state: 'building' | 'failed' | 'revealing';
  children?: ReactNode;
  /** Aspect ratio to assume before the container is measured (previews/tests). */
  initialAspect?: number;
}

/**
 * Full-bleed overlay for the canvas while the async 3D build runs: the soft
 * shadow a splat render occupies before it has detail.
 *
 * ONE outline. The head, neck and shoulders are a single path so there is no
 * seam where separately blurred layers overlap. To keep head proportions on
 * every aspect ratio while the shoulders still run to the side edges, the
 * container is measured (ResizeObserver) and the viewBox is generated to
 * match it: height is always 1000 units, width = 1000 × aspect, and the
 * shoulders are drawn out to the (over-extended) viewBox edges.
 *
 * Proportions come from a real render, then the head compressed ~20 % in
 * height (crown → chin ≈ 48 % of the height, starting ≈ 32 % down); hair ≈ 44 % of the height wide; shoulders
 * leave the neck at ≈ 82 % and reach the edges by ≈ 97 %.
 */

export const GHOST_VB_H = 1000;
const BLEED = 60; // path over-extends past the viewBox so the blur never fades at an edge

/** Pure geometry so the aspect handling can be unit-tested. */
export function ghostGeometry(aspect: number): { vbW: number; outline: string; hair: string } {
  const vbW = Math.round(GHOST_VB_H * Math.max(0.3, Math.min(4, aspect)));
  const cx = vbW / 2;
  const r = (dx: number) => (cx + dx).toFixed(1);
  const l = (dx: number) => (cx - dx).toFixed(1);

  // Right half from the crown clockwise, then the mirrored left half.
  const outline = [
    `M ${cx} 324`,
    `C ${r(110)} 324 ${r(190)} 392 ${r(208)} 480`,   // hair crown → widest
    `C ${r(218)} 536 ${r(205)} 608 ${r(185)} 664`,   // hair sides → cheek
    `C ${r(172)} 712 ${r(158)} 752 ${r(128)} 777.6`,   // jaw
    `C ${r(112)} 787.2 ${r(97)} 792.8 ${r(92)} 800`,     // under-chin → neck
    `L ${r(92)} 824`,                                // neck base
    `C ${r(135)} 830 ${r(280)} 846 ${r(400)} 890`,   // trapezius: mass rises next to the neck…
    `L ${vbW + BLEED} 968`,                          // …then a straight slope off the edge
    `L ${vbW + BLEED} ${GHOST_VB_H + BLEED}`,
    `L ${-BLEED} ${GHOST_VB_H + BLEED}`,
    `L ${-BLEED} 968`,
    `L ${l(400)} 890`,
    `C ${l(280)} 846 ${l(135)} 830 ${l(92)} 824`,
    `L ${l(92)} 800`,
    `C ${l(97)} 792.8 ${l(112)} 787.2 ${l(128)} 777.6`,
    `C ${l(158)} 752 ${l(172)} 712 ${l(185)} 664`,
    `C ${l(205)} 608 ${l(218)} 536 ${l(208)} 480`,
    `C ${l(190)} 392 ${l(110)} 324 ${cx} 324 Z`,
  ].join(' ');

  // Hair mass: a slightly darker cap inside the outline — crown to a soft,
  // gently dipped fringe ≈ 36 % down the head, sides reaching ear level.
  const hair = [
    `M ${cx} 332`,
    `C ${r(100)} 332 ${r(178)} 396 ${r(196)} 480`,
    `C ${r(200)} 512 ${r(190)} 560 ${r(170)} 576`,
    `C ${r(135)} 521.6 ${r(70)} 496 ${cx} 502`,
    `C ${l(70)} 496 ${l(135)} 521.6 ${l(170)} 576`,
    `C ${l(190)} 560 ${l(200)} 512 ${l(196)} 480`,
    `C ${l(178)} 396 ${l(100)} 332 ${cx} 332 Z`,
  ].join(' ');

  return { vbW, outline, hair };
}

const DEFAULT_ASPECT = 1.27; // studio canvas on a laptop; corrected on first measure

export function BuildGhost({ state, children, initialAspect = DEFAULT_ASPECT }: BuildGhostProps) {
  const isFailed = state === 'failed';
  const isRevealing = state === 'revealing';
  const rootRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(initialAspect);
  // Per-instance SVG ids: two ghosts in one document would otherwise share
  // (and mis-resolve) each other's clip/filter/gradient definitions.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `build-ghost-${name}-${uid}`;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setAspect(Math.round((width / height) * 100) / 100);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { vbW, outline, hair } = ghostGeometry(aspect);

  return (
    <div
      ref={rootRef}
      className="build-ghost"
      aria-hidden={isRevealing}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 12,
        pointerEvents: isFailed ? 'auto' : 'none',
        opacity: isRevealing ? 0 : 1,
        transition: isRevealing ? 'opacity 400ms ease' : undefined,
      }}
    >
      {/* Silhouette. Group opacity (and the skeleton-style pulse) live on the
          wrapper so nothing compounds — see .build-ghost__silhouette in globals.css. */}
      <div
        className={`build-ghost__silhouette${isFailed ? ' build-ghost__svg--failed' : ''}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <svg
          aria-hidden
          data-testid="ghost-svg"
          viewBox={`0 0 ${vbW} ${GHOST_VB_H}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, display: 'block' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* One blur for the whole bust — soft edge, no inner seams. */}
            <filter id={id('blur')} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation="9" />
            </filter>

            {/* 3-layer noise → sparse-splat speckle */}
            <filter id={id('noise')} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.045 0.052" numOctaves="3" seed="7" result="noise1">
                <animate attributeName="baseFrequency" values="0.045 0.052;0.048 0.055;0.045 0.052" dur="9s" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise1" scale="14" xChannelSelector="R" yChannelSelector="G" result="disp1" />
              <feTurbulence type="fractalNoise" baseFrequency="0.09 0.11" numOctaves="2" seed="19" result="noise2">
                <animate attributeName="baseFrequency" values="0.09 0.11;0.093 0.115;0.09 0.11" dur="13s" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="disp1" in2="noise2" scale="7" xChannelSelector="B" yChannelSelector="R" result="disp2" />
              <feTurbulence type="turbulence" baseFrequency="0.22 0.18" numOctaves="1" seed="43" result="noise3">
                <animate attributeName="baseFrequency" values="0.22 0.18;0.24 0.20;0.22 0.18" dur="7s" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="disp2" in2="noise3" scale="4" xChannelSelector="G" yChannelSelector="B" result="displaced" />
              <feComponentTransfer in="displaced" result="brightened">
                <feFuncR type="linear" slope="0.55" intercept="0.18" />
                <feFuncG type="linear" slope="0.48" intercept="0.14" />
                <feFuncB type="linear" slope="0.38" intercept="0.10" />
                <feFuncA type="linear" slope="0.32" />
              </feComponentTransfer>
              <feBlend in="brightened" in2="SourceGraphic" mode="screen" />
            </filter>

            <clipPath id={id('clip')}>
              <path d={outline} />
            </clipPath>

            <radialGradient id={id('fill')} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="rgba(240,225,200,0.18)" />
              <stop offset="55%" stopColor="rgba(230,210,185,0.08)" />
              <stop offset="100%" stopColor="rgba(220,200,175,0.02)" />
            </radialGradient>

            <linearGradient id={id('rim')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(217,78,58,0)" />
              <stop offset="66%" stopColor="rgba(217,78,58,0)" />
              <stop offset="84%" stopColor="rgba(217,78,58,0.16)" />
              <stop offset="100%" stopColor="rgba(217,78,58,0.28)" />
            </linearGradient>
          </defs>

          {/* Bust: outline + hair cap blurred together as one group */}
          <g filter={`url(#${id('blur')})`}>
            <path data-testid="ghost-body" d={outline} fill="#3d3028" />
            <path data-testid="ghost-hair" d={hair} fill="#332924" />
          </g>

          {/* Speckle, clipped to the bust */}
          <rect
            x={-BLEED} y={0} width={vbW + 2 * BLEED} height={GHOST_VB_H + BLEED}
            fill={`url(#${id('fill')})`}
            clipPath={`url(#${id('clip')})`}
            filter={`url(#${id('noise')})`}
            className="build-ghost__speckle"
          />

          {/* Tomato rim-light on the right */}
          <rect
            x={-BLEED} y={0} width={vbW + 2 * BLEED} height={GHOST_VB_H + BLEED}
            fill={`url(#${id('rim')})`}
            clipPath={`url(#${id('clip')})`}
          />
        </svg>
      </div>

      {/* Subtitle pill (building only) — sits on the chest, below the collar */}
      {!isFailed && (
        <div
          className="build-ghost__label"
          style={{
            position: 'absolute',
            top: '90%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '8px 18px 10px',
            background: 'rgba(14,10,7,0.6)',
            backdropFilter: 'blur(6px)',
            borderRadius: 12,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            className="build-ghost__eyebrow"
            style={{
              fontFamily: 'var(--font-jetbrains, monospace)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: 'rgba(255,248,234,0.45)',
            }}
          >
            building your 3D model
          </span>
          <BuildSubtitle color="rgba(255,248,234,0.85)" size={13} />
        </div>
      )}

      {/* Failed: children (error card) centered */}
      {isFailed && children && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {children}
        </div>
      )}
    </div>
  );
}
