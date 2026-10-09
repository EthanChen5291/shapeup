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
 * Full-bleed overlay for the canvas while the async 3D build runs.
 *
 * Two absolutely-positioned SVG layers solve the landscape-canvas problem
 * (studio canvas is ~2000×1577 — a single-viewBox slice approach clips the
 * chin and loses the shoulders entirely at that aspect ratio):
 *
 *   HEAD layer  (viewBox 0 0 300 360, preserveAspectRatio="xMidYMin meet")
 *     top: 8%  height: 70%  width: auto, max-width 86% (narrow phones)
 *     Contains hair cap (ghost-hair) + face oval + neck column (ghost-body).
 *     overflow: visible so the neck column bleeds ~6 % past the box bottom
 *     into the shoulders layer's collar dome — blur hides the seam.
 *
 *   SHOULDERS layer  (viewBox 0 0 400 190, preserveAspectRatio="none")
 *     left: 0  right: 0  bottom: 0  height: 34%
 *     preserveAspectRatio="none" is intentional — horizontal stretch looks
 *     correct for shoulders (broader on wide screens).
 *     Contains ghost-shoulders path: two shoulder arches that flare to the
 *     container edges, rising to a broad rounded collar dome at the top.
 *
 * Vertical budget (verified for 16:9, 1:1, 3:4 and the studio ~4:3 canvas):
 *   head box:    10 %→74 % of container height
 *   shoulders:   66 %→100 %
 *   neck overlap: 8 % (blur hides the seam)
 *   head height (crown→chin): 55.8 % of container height on every aspect ratio
 *
 * Fill: warm dark brown (#3d3028 / #2e2520) at 0.85–0.88 opacity reads over
 * both the dark studio chrome and the light beige scene background.
 * Blur: body 1.3 %, hair 1.7 %, shoulders 1.3 % of their respective viewBox
 * widths (feGaussianBlur, no per-frame JS).
 * Speckle: feTurbulence / feDisplacementMap (3 layers) with CSS flicker +
 * breathe animations; stops in failed state; respects prefers-reduced-motion.
 * Tomato rim-light on the right side of both layers.
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
        zIndex: 12,
        pointerEvents: isFailed ? 'auto' : 'none',
        opacity: isRevealing ? 0 : 1,
        transition: isRevealing ? 'opacity 400ms ease' : undefined,
      }}
    >
      {/* ── Silhouette wrapper — opacity carries the translucency for both layers.
          fillOpacity=1 on all paths prevents compounding at the neck junction. ── */}
      <div
        className={isFailed ? 'build-ghost__svg--failed' : undefined}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: isFailed ? 0.4 : 0.85 }}
      >

        {/* ══════════════════════════════════════════════════════════
            HEAD LAYER
            viewBox 0 0 240 360 · preserveAspectRatio xMidYMid meet
            top 10 %  height 64 %  width auto (portrait aspect 2:3)
            overflow visible → neck bleeds into the shoulders' collar dome
            ══════════════════════════════════════════════════════════ */}
        <svg
          aria-hidden
          viewBox="0 0 300 360"
          preserveAspectRatio="xMidYMin meet"
          style={{
            position: 'absolute',
            top: '8%',
            left: '50%',
            transform: 'translateX(-50%)',
            height: '70%',
            width: 'auto',
            // Narrow phones: cap by width instead (head scales down, stays top-pinned).
            maxWidth: '86%',
            overflow: 'visible',
          }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Blur for face / neck */}
            <filter
              id="build-ghost-blur-body-hd"
              x="-20%" y="-10%"
              width="140%" height="125%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="6" />
            </filter>

            {/* Stronger blur for hair cap */}
            <filter
              id="build-ghost-blur-hair-hd"
              x="-25%" y="-25%"
              width="150%" height="150%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="6.8" />
            </filter>

            {/* 3-layer noise for speckle (head) */}
            <filter
              id="build-ghost-noise-hd"
              x="-10%" y="-10%"
              width="120%" height="120%"
              colorInterpolationFilters="sRGB"
            >
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
              <feDisplacementMap
                in="SourceGraphic" in2="noise1"
                scale="14" xChannelSelector="R" yChannelSelector="G"
                result="disp1"
              />
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
              <feDisplacementMap
                in="disp1" in2="noise2"
                scale="7" xChannelSelector="B" yChannelSelector="R"
                result="disp2"
              />
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
              <feDisplacementMap
                in="disp2" in2="noise3"
                scale="4" xChannelSelector="G" yChannelSelector="B"
                result="displaced"
              />
              <feComponentTransfer in="displaced" result="brightened">
                <feFuncR type="linear" slope="0.55" intercept="0.18" />
                <feFuncG type="linear" slope="0.48" intercept="0.14" />
                <feFuncB type="linear" slope="0.38" intercept="0.10" />
                <feFuncA type="linear" slope="0.32" />
              </feComponentTransfer>
              <feBlend in="brightened" in2="SourceGraphic" mode="screen" />
            </filter>

            {/* Clip path for head speckle — hull covering hair crown through neck */}
            <clipPath id="build-ghost-bust-clip-hd">
              <path d="
                M 150 14
                C 288.7 12 294 90 280.7 152
                C 275.3 182 264.7 218 256.7 248
                C 246 270 230 295 216.7 312
                C 203.3 320 187.3 327 150 329
                C 182 333 204.7 345 204.7 410
                L 204.7 430 L 95.3 430 L 95.3 410
                C 95.3 345 118 333 150 329
                C 112.7 327 96.7 320 83.3 312
                C 70 295 54 270 43.3 248
                C 35.3 218 24.7 182 19.3 152
                C 6 90 11.3 12 150 14 Z
              " />
            </clipPath>

            <radialGradient id="build-ghost-fill-hd" cx="44%" cy="36%" r="60%">
              <stop offset="0%"   stopColor="rgba(240,225,200,0.18)" />
              <stop offset="55%"  stopColor="rgba(230,210,185,0.08)" />
              <stop offset="100%" stopColor="rgba(220,200,175,0.02)" />
            </radialGradient>

            <linearGradient id="build-ghost-rim-hd" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(217,78,58,0)" />
              <stop offset="68%"  stopColor="rgba(217,78,58,0)" />
              <stop offset="84%"  stopColor="rgba(217,78,58,0.18)" />
              <stop offset="100%" stopColor="rgba(217,78,58,0.30)" />
            </linearGradient>
          </defs>

          {/* Face oval + neck column
              Hairline: y=70  Face: x=30–270 (240 px, ratio ≈ 0.77 — matches the render)
              Broad rounded jaw (face stays wide to y≈246, then arcs broadly)
              Chin: y≈326  Neck: x≈95–205 (≈46 % of face width)
              Neck extends to y=430 via overflow:visible, sinking into the collar dome */}
          <path
            data-testid="ghost-body"
            d="
              M 150 70
              C 219.3 68 270 94 270 140
              C 270 180 264.7 218 254 246
              C 243.3 268 230 292 216.7 308
              C 203.3 318 187.3 324 150 326
              C 176.7 330 204.7 342 204.7 408
              L 204.7 430
              L 95.3 430
              L 95.3 408
              C 95.3 342 123.3 330 150 326
              C 112.7 324 96.7 318 83.3 308
              C 70 292 56.7 268 46 246
              C 35.3 218 30 180 30 140
              C 30 94 80.7 68 150 70 Z
            "
            fill="#3d3028"
            fillOpacity="1"
            filter="url(#build-ghost-blur-body-hd)"
          />

          {/* Hair cap
              Crown: y≈14 (single arc)  Cap: x≈14–286  Sides to temples: y≈150
              Fringe lower edge: y≈95–102 with 3 gentle scallops
              (nothing hair-coloured below y≈110 at face center) */}
          <path
            data-testid="ghost-hair"
            d="
              M 267.3 150
              C 262 138 251.3 120 235.3 108
              C 224.7 100 206 95 187.3 96
              C 171.3 97 155.3 102 150 102
              C 144.7 102 128.7 97 112.7 96
              C 94 95 75.3 100 59.3 108
              C 43.3 120 38 138 32.7 150
              C 22 140 14 114 14 86
              C 14 52 30 24 56.7 14
              C 92 -6 208 -6 243.3 14
              C 270 24 286 52 286 86
              C 286 114 280.7 140 267.3 150 Z
            "
            fill="#2e2520"
            fillOpacity="1"
            filter="url(#build-ghost-blur-hair-hd)"
          />

          {/* Speckle — clipped to bust hull */}
          <rect
            x="0" y="0" width="300" height="430"
            fill="url(#build-ghost-fill-hd)"
            clipPath="url(#build-ghost-bust-clip-hd)"
            filter="url(#build-ghost-noise-hd)"
            className="build-ghost__speckle"
          />

          {/* Tomato rim-light (right edge) */}
          <rect
            x="0" y="0" width="300" height="430"
            fill="url(#build-ghost-rim-hd)"
            clipPath="url(#build-ghost-bust-clip-hd)"
          />
        </svg>

        {/* ══════════════════════════════════════════════════════════
            SHOULDERS LAYER
            viewBox 0 0 400 190 · preserveAspectRatio="none"
            left 0  right 0  bottom 0  height 34 %
            preserveAspectRatio="none" → horizontal stretch is correct:
            shoulders read broader on wide screens.
            Collar dome (y≈22 at centre) overlaps the head layer's neck extension.
            ══════════════════════════════════════════════════════════ */}
        <svg
          aria-hidden
          data-testid="ghost-shoulders"
          viewBox="0 0 400 190"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '34%',
            width: '100%',
          }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Blur for shoulder shape */}
            <filter
              id="build-ghost-blur-sh"
              x="-5%" y="-20%"
              width="110%" height="140%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="5" />
            </filter>

            {/* 3-layer noise for speckle (shoulders) — unique IDs to avoid collision */}
            <filter
              id="build-ghost-noise-sh"
              x="-10%" y="-10%"
              width="120%" height="120%"
              colorInterpolationFilters="sRGB"
            >
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
              <feDisplacementMap
                in="SourceGraphic" in2="noise1"
                scale="18" xChannelSelector="R" yChannelSelector="G"
                result="disp1"
              />
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
              <feDisplacementMap
                in="disp1" in2="noise2"
                scale="9" xChannelSelector="B" yChannelSelector="R"
                result="disp2"
              />
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
              <feDisplacementMap
                in="disp2" in2="noise3"
                scale="5" xChannelSelector="G" yChannelSelector="B"
                result="displaced"
              />
              <feComponentTransfer in="displaced" result="brightened">
                <feFuncR type="linear" slope="0.55" intercept="0.18" />
                <feFuncG type="linear" slope="0.48" intercept="0.14" />
                <feFuncB type="linear" slope="0.38" intercept="0.10" />
                <feFuncA type="linear" slope="0.32" />
              </feComponentTransfer>
              <feBlend in="brightened" in2="SourceGraphic" mode="screen" />
            </filter>

            {/* Clip path for shoulder speckle */}
            <clipPath id="build-ghost-bust-clip-sh">
              <path d="
                M 0 190 L 0 150
                C 18 108 70 76 130 58
                C 160 48 178 22 200 22
                C 222 22 240 48 270 58
                C 330 76 382 108 400 150
                L 400 190 Z
              " />
            </clipPath>

            <radialGradient id="build-ghost-fill-sh" cx="42%" cy="55%" r="65%">
              <stop offset="0%"   stopColor="rgba(240,225,200,0.16)" />
              <stop offset="55%"  stopColor="rgba(230,210,185,0.07)" />
              <stop offset="100%" stopColor="rgba(220,200,175,0.02)" />
            </radialGradient>

            <linearGradient id="build-ghost-rim-sh" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(217,78,58,0)" />
              <stop offset="72%"  stopColor="rgba(217,78,58,0)" />
              <stop offset="88%"  stopColor="rgba(217,78,58,0.12)" />
              <stop offset="100%" stopColor="rgba(217,78,58,0.22)" />
            </linearGradient>
          </defs>

          {/* Shoulder arch — flares to x=0/x=400 at y≈150, rising to a broad rounded
              collar dome at centre (y≈22) that the head layer's neck sinks into.
              No flat neck notch: a plateau wider than the neck read as a collar block. */}
          <path
            d="
              M 0 190 L 0 150
              C 18 108 70 76 130 58
              C 160 48 178 22 200 22
              C 222 22 240 48 270 58
              C 330 76 382 108 400 150
              L 400 190 Z
            "
            fill="#3d3028"
            fillOpacity="1"
            filter="url(#build-ghost-blur-sh)"
          />

          {/* Speckle — clipped to shoulder outline */}
          <rect
            x="0" y="0" width="400" height="190"
            fill="url(#build-ghost-fill-sh)"
            clipPath="url(#build-ghost-bust-clip-sh)"
            filter="url(#build-ghost-noise-sh)"
            className="build-ghost__speckle"
          />

          {/* Tomato rim-light (right edge) */}
          <rect
            x="0" y="0" width="400" height="190"
            fill="url(#build-ghost-rim-sh)"
            clipPath="url(#build-ghost-bust-clip-sh)"
          />
        </svg>
      </div>{/* /silhouette wrapper */}

      {/* ── Subtitle pill (building state only) ── */}
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
