# Mobile Support — Mechanism

**Hard rule: desktop stays pixel-for-pixel identical.** All mobile work is additive
and gated behind a breakpoint; the desktop code path is never altered.

Because ~95% of the UI is styled with inline `style={{}}` objects (Tailwind
`md:`/`sm:` prefixes do not affect inline styles), mobile overrides use a hook:

- `src/hooks/useMediaQuery.ts` exports `useIsMobile()` and `MOBILE_BREAKPOINT = 768`.
- Components merge a mobile-only style object onto the existing desktop one:
  `style={{ ...desktopStyle, ...(isMobile ? mobileStyle : {}) }}`.
- The desktop branch is left byte-identical, so `isMobile === false` reproduces
  today's UI exactly.
- Breakpoint: **768px** (`max-width: 768px` ⇒ mobile). Use this everywhere.
- SSR/first client render report `false` (desktop) to avoid hydration mismatch;
  the real value lands in an effect after mount.

Viewport meta + safe-area handling live in `src/app/layout.tsx` (`export const
viewport`) and `src/app/globals.css`.
