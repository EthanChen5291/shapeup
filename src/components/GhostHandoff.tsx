'use client';

/**
 * GhostHandoff — carries the BuildGhost across the scan → studio route change.
 *
 * Without it the handoff is three hard cuts: the scan popup rotates out, the
 * dashboard shows through, the studio mounts as a blank wash until its project
 * query resolves, then the real ghost pops in. This provider (mounted in the
 * root layout) hosts ONE ghost that
 * outlives the navigation:
 *
 *   dashboard: beginHandoff()        → a studio look-alike (tomato wash + the
 *                                      rounded canvas frame + ghost) fades in
 *                                      OVER the scan popup's "done" state
 *   router.push('/studio/<id>')      → route swaps underneath; ghost stays put
 *   studio:    adoptHandoff(frame)   → frame snaps to the measured canvas rect
 *                                      (normally a no-op) and the overlay fades
 *                                      out over the studio's own identical ghost
 *
 * The frame is PREDICTED from the viewport (predictStudioFrame) so the ghost is
 * never shown full-bleed: it is only ever drawn at the size and place the studio
 * will draw it, and the studio's own chrome is what fades in around it.
 *
 * Safety nets: a max hold releases it if the studio never adopts, and any
 * navigation that lands somewhere other than /studio releases it too.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BuildGhost } from './BuildGhost';
import { EditPanelSkeleton } from './EditPanelSkeleton';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MOBILE_SHORT_REGION_MIN, MOBILE_SHORT_TOP, SHORT_SCREEN_MAX_H } from '@/lib/studioLayout';
import { readStoredSidebarWidth, STUDIO_RESIZER_W, STUDIO_SIDEBAR, studioTopPad } from '@/lib/studioLayout';

/** How long the ghost takes to settle from full-viewport into the studio frame. */
export const HANDOFF_SETTLE_MS = 420;
/** Fade-out over the studio's own ghost. */
export const HANDOFF_FADE_MS = 360;
/** Fade-in behind the exiting scan popup. */
export const HANDOFF_FADE_IN_MS = 280;
/** Release no matter what after this long — the studio never adopted. */
export const HANDOFF_MAX_HOLD_MS = 12_000;

/**
 * Studio canvas-frame geometry, mirrored from src/app/studio/[projectId]/page.tsx:
 * desktop → canvas region `flex-1 p-6` with a `studioTopPad` top and 16px left
 *           gutter, then the 10px resizer and the (user-sized) edit panel;
 * mobile  → canvas region `h-[46vh] p-2 pt-20`, sidebar below. Frame is `rounded-3xl`.
 * It must match exactly: any drift shows as the frame jumping when the studio adopts.
 */
export const STUDIO_FRAME = {
  desktop: { left: 16, right: 24, bottom: 24 },
  mobile: { top: 80, side: 8, bottom: 8, regionVh: 0.46 },
  radius: 24,
} as const;

/** Where the studio will draw its canvas frame for a given viewport and edit-panel width. */
export function predictStudioFrame(vw: number, vh: number, isMobile: boolean, sidebarWidth: number = STUDIO_SIDEBAR.initial): HandoffFrame {
  if (isMobile) {
    const m = STUDIO_FRAME.mobile;
    // Short screens (e.g. a zoomed-in desktop) scroll: taller region, slimmer header.
    const short = vh <= SHORT_SCREEN_MAX_H;
    const top = short ? MOBILE_SHORT_TOP : m.top;
    // Short: the header sits above the region (in flow), so the region's own padding is just 8px.
    const height = short
      ? Math.max(Math.round(vh * m.regionVh), MOBILE_SHORT_REGION_MIN) - 2 * m.bottom
      : Math.round(vh * m.regionVh) - top - m.bottom;
    return {
      top,
      left: m.side,
      width: Math.max(0, vw - m.side * 2),
      height: Math.max(0, height),
      radius: STUDIO_FRAME.radius,
    };
  }
  const d = STUDIO_FRAME.desktop;
  const top = studioTopPad(vh);
  return {
    top,
    left: d.left,
    width: Math.max(0, vw - sidebarWidth - STUDIO_RESIZER_W - d.left - d.right),
    height: Math.max(0, vh - top - d.bottom),
    radius: STUDIO_FRAME.radius,
  };
}

/** Matches the studio's canvas frame chrome; the backdrop colour comes from `.render-frame`. */
const STUDIO_FRAME_STYLE: React.CSSProperties = {
  border: '1px solid rgba(255,248,234,0.12)',
  boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)',
};

export interface HandoffFrame {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Border radius of the studio frame, so the settle matches its corners. */
  radius?: number;
}

type Status = 'idle' | 'in' | 'hold' | 'settle' | 'out';

/** 'building': a fresh scan is being built (ghost shows its subtitle).
 *  'loading':  opening an existing cut — just the quiet loading shadow. */
export type HandoffKind = 'building' | 'loading';

interface GhostHandoffValue {
  /** Raise the full-viewport ghost (call as the scan popup starts exiting). */
  beginHandoff: (kind?: HandoffKind) => void;
  /** Studio has its own ghost mounted: settle into `frame` (if given) and fade out. */
  adoptHandoff: (frame?: HandoffFrame) => void;
  /** Drop the ghost immediately (fade out, no settle). */
  releaseHandoff: () => void;
}

const noop = () => {};
const GhostHandoffContext = createContext<GhostHandoffValue>({
  beginHandoff: noop,
  adoptHandoff: noop,
  releaseHandoff: noop,
});

export function useGhostHandoff(): GhostHandoffValue {
  return useContext(GhostHandoffContext);
}

/** Pure: should a pathname change while the ghost is up release it? */
export function shouldReleaseOnPath(pathname: string | null | undefined): boolean {
  return !!pathname && !pathname.startsWith('/studio/');
}

export function GhostHandoffProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [frame, setFrame] = useState<HandoffFrame | null>(null);
  const statusRef = useRef<Status>('idle');
  statusRef.current = status;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafRef = useRef<number | null>(null);
  const pathname = usePathname();
  const beganOnPath = useRef<string | null>(null);
  const isMobile = useIsMobile();
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [kind, setKind] = useState<HandoffKind>('building');
  // Edit-panel width the studio will open with, read when the handoff starts.
  const [sidebarWidth, setSidebarWidth] = useState<number>(STUDIO_SIDEBAR.initial);

  // Track the viewport only while the overlay is up (it's a global provider).
  useEffect(() => {
    if (status === 'idle' || typeof window === 'undefined') return;
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [status]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const fadeOut = useCallback(() => {
    clearTimers();
    setStatus('out');
    later(() => { setStatus('idle'); setFrame(null); }, HANDOFF_FADE_MS);
  }, [clearTimers, later]);

  const releaseHandoff = useCallback(() => {
    if (statusRef.current === 'idle' || statusRef.current === 'out') return;
    fadeOut();
  }, [fadeOut]);

  const beginHandoff = useCallback((nextKind: HandoffKind = 'building') => {
    clearTimers();
    beganOnPath.current = pathname;
    // Guard against being wired straight to onClick (the event would arrive here).
    setKind(nextKind === 'loading' ? 'loading' : 'building');
    setSidebarWidth(readStoredSidebarWidth());
    setFrame(null);
    setStatus('in');
    // Mount at opacity 0, then flip to 1 on the next frame so the fade-in runs.
    const flip = () => { if (statusRef.current === 'in') setStatus('hold'); };
    if (typeof requestAnimationFrame === 'function') {
      rafRef.current = requestAnimationFrame(() => { rafRef.current = requestAnimationFrame(flip); });
    } else {
      later(flip, 16);
    }
    later(() => { if (statusRef.current !== 'idle') fadeOut(); }, HANDOFF_MAX_HOLD_MS);
  }, [clearTimers, later, fadeOut, pathname]);

  const adoptHandoff = useCallback((target?: HandoffFrame) => {
    const s = statusRef.current;
    if (s === 'idle' || s === 'out') return;
    if (!target || target.width <= 0 || target.height <= 0) { fadeOut(); return; }
    clearTimers();
    setFrame(target);
    setStatus('settle');
    // Start the fade a little before the settle finishes so the two overlap.
    later(fadeOut, Math.max(0, HANDOFF_SETTLE_MS - 80));
  }, [clearTimers, later, fadeOut]);

  // Landed somewhere other than the studio (push failed, user went back): drop it.
  useEffect(() => {
    if (statusRef.current === 'idle') return;
    if (pathname === beganOnPath.current) return;
    if (shouldReleaseOnPath(pathname)) releaseHandoff();
  }, [pathname, releaseHandoff]);

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo(() => ({ beginHandoff, adoptHandoff, releaseHandoff }), [beginHandoff, adoptHandoff, releaseHandoff]);

  const visible = status === 'hold' || status === 'settle';
  const ease = 'cubic-bezier(.2,.85,.2,1)';
  // Measured rect from the studio once adopted; predicted from the viewport until then.
  const shown: HandoffFrame | null = frame
    ?? (viewport ? predictStudioFrame(viewport.w, viewport.h, isMobile, sidebarWidth) : null);
  const frameStyle: React.CSSProperties = shown
    ? { top: shown.top, left: shown.left, width: shown.width, height: shown.height, borderRadius: shown.radius ?? STUDIO_FRAME.radius }
    : { top: 96, left: STUDIO_FRAME.desktop.left, right: sidebarWidth + STUDIO_RESIZER_W + STUDIO_FRAME.desktop.right, bottom: STUDIO_FRAME.desktop.bottom, borderRadius: STUDIO_FRAME.radius };

  return (
    <GhostHandoffContext.Provider value={value}>
      {children}
      {status !== 'idle' && (
        <div
          data-testid="ghost-handoff"
          data-status={status}
          aria-hidden
          className="bg-tomato-shop"
          style={{
            position: 'fixed',
            inset: 0,
            // Above the scan popup (z 10000) and the dashboard's profile pill
            // (z 9999): the popup's "done" state crossfades straight into the
            // studio look-alike, and nothing from the dashboard pokes through.
            zIndex: 10001,
            opacity: visible ? 1 : 0,
            transition: `opacity ${status === 'out' ? HANDOFF_FADE_MS : HANDOFF_FADE_IN_MS}ms ease`,
            pointerEvents: status === 'out' ? 'none' : 'auto',
          }}
        >
          <div
            data-testid="ghost-handoff-frame"
            // Same class as the studio's canvas frame: theme-matched backdrop colour, no brown flash.
            className="render-frame"
            style={{
              position: 'absolute',
              overflow: 'hidden',
              ...STUDIO_FRAME_STYLE,
              ...frameStyle,
              transition: `top ${HANDOFF_SETTLE_MS}ms ${ease}, left ${HANDOFF_SETTLE_MS}ms ${ease}, width ${HANDOFF_SETTLE_MS}ms ${ease}, height ${HANDOFF_SETTLE_MS}ms ${ease}, border-radius ${HANDOFF_SETTLE_MS}ms ${ease}`,
            }}
          >
            <BuildGhost state={kind} />
          </div>
          {/* Desktop: the toolbox column beside the frame, already "loading". */}
          {!isMobile && (
            <EditPanelSkeleton
              className="absolute"
              // Same spot as the studio's own skeleton: inside the edit panel's 16px gutters.
              style={{ top: viewport ? studioTopPad(viewport.h) : 96, right: 16, width: sidebarWidth - 32 }}
            />
          )}
        </div>
      )}
    </GhostHandoffContext.Provider>
  );
}
