'use client';

import { ReactNode } from 'react';
import { BuildSubtitle } from './BuildSubtitle';

interface BuildGhostProps {
  /** 'building': animated speckle + subtitle.
   *  'failed':   same ghost but dimmed, shows children (error card).
   *  'revealing': ghost fades out (handled externally via CSS class). */
  state: 'building' | 'failed' | 'revealing';
  children?: ReactNode;
}

/**
 * Full-bleed overlay for the canvas area while the async 3D build runs.
 *
 * Renders a bust silhouette (head + hair + shoulders) as an SVG path masked
 * over animated speckle noise via SVG feTurbulence + feDisplacementMap.
 * Deliberately reads as a sparse Gaussian-splat render — NOT a photo or a
 * person. Three noise layers at different scales drift slowly; opacity flickers
 * at ~10 Hz via CSS steps() plus a 3 s breathe cycle. A tomato rim-light on
 * the right side anchors it to the brand's warm palette.
 *
 * GPU-cheap: one SVG filter, no per-frame JS, CSS-only animation.
 * Respects prefers-reduced-motion (instant cut — no flicker or breathe).
 */
export function BuildGhost({ state, children }: BuildGhostProps) {
  const isFailed = state === 'failed';
  const isRevealing = state === 'revealing';

  return (
    <div
      className="build-ghost"
      aria-hidden={isRevealing}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 12,
        pointerEvents: isFailed ? 'auto' : 'none',
        opacity: isRevealing ? 0 : 1,
        transition: isRevealing ? 'opacity 400ms ease' : undefined,
      }}
    >
      {/* ── Speckle bust silhouette ── */}
      <div
        className={`build-ghost__bust ${isFailed ? 'build-ghost__bust--failed' : ''}`}
        aria-hidden
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 520,
          flex: 1,
          minHeight: 0,
        }}
      >
        <svg
          viewBox="0 0 400 520"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%', display: 'block' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* ── Noise filter (3 layers, different scales/drift) ── */}
            <filter id="build-ghost-noise" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
              {/* Layer 1: coarse speckle */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.045 0.052"
                numOctaves="3"
                seed="7"
                result="noise1"
              >
                <animate
                  attributeName="baseFrequency"
                  values="0.045 0.052;0.048 0.055;0.045 0.052"
                  dur="9s"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise1" scale="18" xChannelSelector="R" yChannelSelector="G" result="disp1" />
              {/* Layer 2: fine speckle */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.09 0.11"
                numOctaves="2"
                seed="19"
                result="noise2"
              >
                <animate
                  attributeName="baseFrequency"
                  values="0.09 0.11;0.093 0.115;0.09 0.11"
                  dur="13s"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap in="disp1" in2="noise2" scale="9" xChannelSelector="B" yChannelSelector="R" result="disp2" />
              {/* Layer 3: micro shimmer */}
              <feTurbulence
                type="turbulence"
                baseFrequency="0.22 0.18"
                numOctaves="1"
                seed="43"
                result="noise3"
              >
                <animate
                  attributeName="baseFrequency"
                  values="0.22 0.18;0.24 0.20;0.22 0.18"
                  dur="7s"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap in="disp2" in2="noise3" scale="5" xChannelSelector="G" yChannelSelector="B" result="displaced" />
              {/* Lighten the displaced result — sets the speckle brightness */}
              <feComponentTransfer in="displaced" result="brightened">
                <feFuncR type="linear" slope="0.85" intercept="0.1" />
                <feFuncG type="linear" slope="0.80" intercept="0.08" />
                <feFuncB type="linear" slope="0.72" intercept="0.06" />
                <feFuncA type="linear" slope="0.55" />
              </feComponentTransfer>
              <feBlend in="brightened" in2="SourceGraphic" mode="screen" result="blended" />
            </filter>

            {/* ── Bust silhouette clip-path ── */}
            {/* Head + hair mass (tall crown) + neck + shoulders */}
            <clipPath id="build-ghost-bust-clip">
              <path d="
                M 200 20
                C 140 20, 100 60, 95 110
                C 88 145, 88 160, 90 185
                C 72 185, 60 198, 68 220
                C 74 236, 92 244, 104 240
                C 108 268, 130 292, 165 302
                L 165 330
                C 165 338, 155 348, 135 355
                C 90 368, 50 388, 30 430
                L 30 520
                L 370 520
                L 370 430
                C 350 388, 310 368, 265 355
                C 245 348, 235 338, 235 330
                L 235 302
                C 270 292, 292 268, 296 240
                C 308 244, 326 236, 332 220
                C 340 198, 328 185, 310 185
                C 312 160, 312 145, 305 110
                C 300 60, 260 20, 200 20
                Z
              " />
            </clipPath>

            {/* ── Radial gradient fill for the bust silhouette ── */}
            <radialGradient id="build-ghost-fill" cx="45%" cy="45%" r="60%">
              <stop offset="0%" stopColor="rgba(255,248,234,0.22)" />
              <stop offset="55%" stopColor="rgba(255,248,234,0.10)" />
              <stop offset="100%" stopColor="rgba(255,248,234,0.03)" />
            </radialGradient>

            {/* ── Tomato rim-light gradient (right side) ── */}
            <linearGradient id="build-ghost-rim" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(217,78,58,0)" />
              <stop offset="72%" stopColor="rgba(217,78,58,0)" />
              <stop offset="88%" stopColor="rgba(217,78,58,0.18)" />
              <stop offset="100%" stopColor="rgba(217,78,58,0.28)" />
            </linearGradient>
          </defs>

          {/* Speckle fill — cream/butter tones, filtered */}
          <rect
            x="0" y="0" width="400" height="520"
            fill="url(#build-ghost-fill)"
            clipPath="url(#build-ghost-bust-clip)"
            filter="url(#build-ghost-noise)"
            className="build-ghost__speckle"
          />

          {/* Rim light overlay (no filter — stays crisp) */}
          <rect
            x="0" y="0" width="400" height="520"
            fill="url(#build-ghost-rim)"
            clipPath="url(#build-ghost-bust-clip)"
          />
        </svg>
      </div>

      {/* ── Subtitle area ── */}
      {!isFailed && (
        <div
          className="build-ghost__label"
          style={{
            position: 'absolute',
            bottom: '18%',
            left: '50%',
            transform: 'translateX(-50%)',
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

      {/* ── Failed state: children (error card) centered ── */}
      {isFailed && children && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
