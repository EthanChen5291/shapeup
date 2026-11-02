'use client';

// ============================================================
// BarberVideoCard — the "Show your barber!" 360° panel card.
//
// In the `ready` state the card (pill, re-film, the looping clip, and the save
// button) can pop out of its panel slot and smoothly grow to a large, centered
// overlay. On first success it auto-opens; the fullscreen toggle expands it, and
// the icon flips to exit-fullscreen to shrink it right back into its slot.
//
// Two things make this feel native:
//
//  1. Never-reload video. The card markup lives in a single persistent host node
//     that is *physically re-parented* (appendChild) between the slot and a
//     body-level overlay — React only ever portals into that one host, so the
//     <video> element is never unmounted and the loop never stutters.
//
//  2. Crisp growth via real layout — exactly like the Studio's expanding
//     polaroid. The overlay animates its `width` (and glides its centre from the
//     slot to the viewport centre); the card re-lays-out at the new width every
//     frame, so the clip and chrome stay razor sharp — no zoomed bitmap. The
//     overlay portals to <body> so its position:fixed escapes the Studio panel's
//     transformed / scroll-clipped ancestors, which would otherwise swallow it.
// ============================================================

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BarberVideoResult from '@/components/BarberVideoResult';
import RequestRecap, { type EditPromptEntry } from '@/components/RequestRecap';
import ButtonProgressRing from '@/components/ButtonProgressRing';
import {
  DOCK_DRAG_THRESHOLD, DOCK_HOME, decideDock, dockRect, dockWidth, freeHeightForCard, returnRoom,
  normalizeDockOffset, nudgeDockOffset, readDockOffset, writeDockOffset, type DockOffset,
  clampFloatSize, dropTargetFor, floatWidthForDrag, readDockPlacement, readFloatSize, writeDockPlacement, writeFloatSize,
  type DockPlacement, type FloatSize,
} from '@/lib/videoDock';

/**
 * Lets the card leave the edit panel when the panel is taller than the viewport
 * (so its buttons never scroll off screen) and float over the render frame's
 * bottom-right corner instead. See src/lib/videoDock.ts for the rules.
 */
export interface BarberVideoDock {
  /** The render frame the docked card floats over. */
  frameRef: React.RefObject<HTMLElement | null>;
  /** Off on mobile and while the toolbox is hidden or still settling (shadow loading). */
  enabled: boolean;
  /**
   * Dragging the docked card back over the panel: ask the panel to free `px` of
   * room (a live preview; null puts it back). Returns false if it can't.
   */
  previewReturn?: (px: number | null) => boolean;
  /** The card was dropped on the panel: keep the room the preview made. */
  commitReturn?: () => void;
}

interface BarberVideoCardProps {
  isMobile?: boolean;
  onRequestVideo?: () => void;
  videoState?: 'idle' | 'recording' | 'encoding' | 'ready' | 'error';
  videoProgress?: number;
  videoUrl?: string | null;
  videoExt?: 'mp4' | 'webm';
  projectName?: string;
  /** Requests behind finished cuts (oldest first), for the Recap button. */
  editPrompts?: EditPromptEntry[];
  /** More icon buttons for the action row (e.g. the Quick try-ons toggle). */
  extraActions?: React.ReactNode;
  /** Stop a 360° capture that's under way. */
  onCancelVideo?: () => void;
  dock?: BarberVideoDock;
}

interface Rect { top: number; left: number; width: number; height: number; }

// Matches the polaroid's expand feel (width 0.4s, gentle overshoot).
const DUR = 420;
const EASE = 'cubic-bezier(0.34,1.2,0.64,1)';
// Enlarged size — bounded to the viewport so it can never run off-screen.
const BIG_WIDTH = 'min(560px, 92vw)';
const BIG_VIDEO_MAX_H = '64vh';

// Four arrows pointing outward — "go fullscreen / expand".
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3H3v5" />
      <path d="M21 8V3h-5" />
      <path d="M16 21h5v-5" />
      <path d="M3 16v5h5" />
    </svg>
  );
}

// Four arrows pointing inward — "exit fullscreen / shrink".
function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h5V3" />
      <path d="M16 3v5h5" />
      <path d="M21 16h-5v5" />
      <path d="M8 21v-5H3" />
    </svg>
  );
}

const CARD_CLASS = 'flex-shrink-0 rounded-2xl px-5 py-4 flex flex-col gap-3';
const REST_SHADOW = '0 30px 60px -24px rgba(0,0,0,0.45)';
const BIG_SHADOW = '0 40px 90px -30px rgba(0,0,0,0.7)';

export default function BarberVideoCard({
  isMobile = false,
  onRequestVideo,
  videoState = 'idle',
  videoProgress = 0,
  videoUrl,
  videoExt = 'mp4',
  projectName,
  editPrompts,
  extraActions,
  onCancelVideo,
  dock,
}: BarberVideoCardProps) {
  const [showRecap, setShowRecap] = useState(false);
  // The finished clip can be tucked away (kept, not deleted) and shown again.
  const [previewHidden, setPreviewHidden] = useState(false);
  const capturing = videoState === 'recording' || videoState === 'encoding';
  // A new clip always shows itself.
  useEffect(() => { if (videoState === 'recording') setPreviewHidden(false); }, [videoState]);
  const badgeId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const slotRef = useRef<HTMLDivElement>(null);     // in-flow at-rest mount / spacer
  const overlayRef = useRef<HTMLDivElement>(null);  // fixed positioner in the body portal
  // Persistent host the card markup is portaled into. It is re-parented between
  // the slot and the overlay so the <video> never unmounts. display:contents so
  // the host adds no box of its own — the card lays out as a direct child.
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (typeof document !== 'undefined' && !hostRef.current) {
    hostRef.current = document.createElement('div');
    hostRef.current.style.display = 'contents';
  }

  const [popped, setPopped] = useState(false);     // out of flow (fixed overlay)
  const [centered, setCentered] = useState(false); // enlarged + centred vs. at slot
  const [rect, setRect] = useState<Rect | null>(null); // collapsed slot rect
  // ── Dock (floating over the render frame when the panel overflows) ──
  const cardRef = useRef<HTMLDivElement>(null);     // the card box itself, wherever it lives
  const [docked, setDocked] = useState(false);
  const dockedRef = useRef(false);
  dockedRef.current = docked;
  const centeredRef = useRef(false);
  const [dockBox, setDockBox] = useState<Rect | null>(null);
  const [dockOffset, setDockOffset] = useState<DockOffset>(DOCK_HOME);
  const dockOffsetRef = useRef<DockOffset>(DOCK_HOME);
  dockOffsetRef.current = dockOffset;
  const [dragging, setDragging] = useState(false);
  // Dragged over the panel: the end it would land at. The panel opens a gap there
  // at once (no outline, no easing) and the trending list gives up the room.
  const [preview, setPreview] = useState<'top' | 'bottom' | null>(null);
  const previewRef = useRef<'top' | 'bottom' | null>(null);
  previewRef.current = preview;
  const returning = preview !== null;
  const returningRef = useRef(false);
  returningRef.current = returning;
  // Where the user put the card (remembered): 'auto' floats only when the panel
  // would overflow; 'top' / 'bottom' keep it in the panel; 'float' keeps it out.
  const [placement, setPlacementState] = useState<DockPlacement>('auto');
  const placementRef = useRef<DockPlacement>('auto');
  placementRef.current = placement;
  const setPlacement = useCallback((p: DockPlacement) => { setPlacementState(p); writeDockPlacement(p); }, []);
  // Manual floating size from the corner grip. Only used while floating; the card
  // is its natural size in the panel, and this comes back next time it floats.
  const [floatSize, setFloatSize] = useState<FloatSize | null>(null);
  const floatSizeRef = useRef<FloatSize | null>(null);
  floatSizeRef.current = floatSize;
  const [resizing, setResizing] = useState(false);
  // While dragging, the card follows the pointer freely (clamped to the viewport only).
  const [dragBox, setDragBox] = useState<Rect | null>(null);
  const dragBoxRef = useRef<Rect | null>(null);
  dragBoxRef.current = dragBox;
  // The card's natural height in the panel, for the gap it needs when dragged back.
  const restHeightRef = useRef<number | null>(null);
  const dockEnabled = Boolean(dock?.enabled) && !isMobile;
  // Honour reduced motion: the glides become jumps.
  const [reduceMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dur = reduceMotion ? 0 : DUR;
  useEffect(() => {
    setDockOffset(readDockOffset());
    setPlacementState(readDockPlacement());
    setFloatSize(readFloatSize());
  }, []);
  // True once the clip's intrinsic size is known. We hold the auto-open until
  // then so the slot is measured at the card's real (loaded) height — otherwise
  // the spacer freezes short and the toolbox only catches up after the preview
  // has already settled back into its corner.
  const [dimsReady, setDimsReady] = useState(false);
  const autoOpened = useRef(false);
  const isReady = videoState === 'ready';

  // Read the collapsed card rect from the slot (host lives there at rest; the
  // slot is a fixed-height spacer while floating — a clean measuring target).
  const measure = useCallback((): Rect | null => {
    const el = slotRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const next = { top: r.top, left: r.left, width: r.width, height: r.height };
    setRect(next);
    return next;
  }, []);

  const expand = useCallback(() => {
    if (dockedRef.current) { setCentered(true); return; } // already floating: glide from the dock
    if (!measure()) return;
    setPopped(true);
    setCentered(false);
    requestAnimationFrame(() => setCentered(true));
  }, [measure]);

  const collapse = useCallback(() => {
    if (!dockedRef.current) measure(); // refresh slot position in case the panel scrolled
    setCentered(false);
  }, [measure]);
  centeredRef.current = centered;

  // Re-parent the persistent host into the slot (at rest) or the overlay (popped)
  // synchronously, before paint — moving the node keeps the <video> alive.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const target = popped ? overlayRef.current : slotRef.current;
    if (host && target && host.parentNode !== target) target.appendChild(host);
  });

  // First time the clip is ready *and* measured, pop it out to center. Waiting
  // for dimsReady means the slot already holds the full-height card, so the
  // toolbox rides up while the preview animates — not after it lands.
  useLayoutEffect(() => {
    if (!isReady || !dimsReady || autoOpened.current) return;
    autoOpened.current = true;
    expand();
  }, [isReady, dimsReady, expand]);

  // If we leave the ready state (e.g. a re-film starts), drop back to the slot.
  useEffect(() => {
    if (!isReady) {
      autoOpened.current = false;
      setDimsReady(false);
      // (A card being dragged out of the panel is popped but not docked yet: leave it be.)
      if (popped && !dockedRef.current && !dragging) { setPopped(false); setCentered(false); }
      else if (popped) setCentered(false);
    }
  }, [isReady, popped, dragging]);

  // A fresh clip arrives — re-arm the dimension gate for the new video.
  useEffect(() => { setDimsReady(false); }, [videoUrl]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!centered) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [centered]);

  // ── Dock/undock ─────────────────────────────────────────────
  // Both moves are FLIP animations on the card itself: the card is put in its new
  // home in one commit, then animated from where it was. That way the trip home
  // ends wherever the slot actually is — the toolbox is still re-fitting while
  // the card flies — and the trip out can't skip its first frame.
  const flip = useRef<DOMRect | null>(null);
  const currentDockBox = useCallback((cardHeight: number): Rect | null => {
    const frame = dock?.frameRef.current;
    const aside = slotRef.current?.closest('aside');
    if (!frame || !aside) return null;
    const f = frame.getBoundingClientRect();
    const fb = { left: f.left, top: f.top, width: f.width, height: f.height };
    const fs = floatSizeRef.current;
    const width = fs ? clampFloatSize(fs, fb).w : dockWidth(f.width, aside.getBoundingClientRect().width);
    return dockRect(fb, width, cardHeight, dockOffsetRef.current);
  }, [dock?.frameRef]);
  // Leave the panel: into the dock now, animate from the slot; the slot folds shut.
  const dockNow = useCallback(() => {
    const card = cardRef.current;
    const slot = slotRef.current;
    const r = measure();
    if (!card || !slot || !r) return;
    const box = currentDockBox(card.offsetHeight);
    if (!box) return;
    // Give the slot an explicit height first so its fold to 0 can animate (auto → 0 can't).
    slot.style.height = `${r.height}px`;
    void slot.offsetHeight;
    flip.current = card.getBoundingClientRect();
    setDockBox(box);
    setPopped(true);
    setDocked(true);
  }, [measure, currentDockBox]);
  // Return to the panel: back into normal flow now, animate from the dock.
  const undockNow = useCallback(() => {
    const card = cardRef.current;
    if (card) flip.current = card.getBoundingClientRect();
    setDocked(false);
    setDockBox(null);
    setPopped(false);
  }, []);
  // Runs after the host has been re-parented (declared after that effect): play
  // the recorded move. Position via transform, width via real layout, so the
  // card stays crisp — the same feel as the fullscreen glide.
  useLayoutEffect(() => {
    const first = flip.current;
    if (!first) return;
    flip.current = null;
    const card = cardRef.current;
    if (!card || dur === 0 || typeof card.animate !== 'function') return;
    const last = card.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (!dx && !dy && first.width === last.width) return;
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, width: `${first.width}px` },
        { transform: 'none', width: `${last.width}px` },
      ],
      { duration: dur, easing: EASE },
    );
  });
  // The fullscreen glide back to a slot still uses the positioner's CSS
  // transition; settle into flow once it is over (a timer — the width may not
  // change, so transitionend can't be relied on).
  const settleTimer = useRef<number | null>(null);
  useEffect(() => {
    if (docked || !popped || centered || dragging) return;
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      if (!dockedRef.current && !centeredRef.current) setPopped(false);
    }, dur + 60);
    return () => { if (settleTimer.current) { window.clearTimeout(settleTimer.current); settleTimer.current = null; } };
  }, [docked, popped, centered, dur, dragging]);

  const scheduleRef = useRef<(() => void) | null>(null);
  // Watch the panel: dock when the card would overflow it, come back when there
  // is room again, and keep the docked box glued to the frame as it resizes.
  useEffect(() => {
    if (!dockEnabled) { if (dockedRef.current) undockNow(); return; }
    const slot = slotRef.current;
    const aside = slot?.closest('aside');
    const content = slot?.parentElement;
    const frame = dock?.frameRef.current;
    if (!slot || !aside || !content || !frame) return;
    let raf = 0;
    const run = () => {
      raf = 0;
      const card = cardRef.current;
      if (!card) return;
      // Mid-drag the layout is the user's to change (the panel may be making room);
      // decide again once the card has been let go.
      if (dragRef.current?.moved || returningRef.current) {
        if (dockedRef.current) {
          const box = currentDockBox(card.offsetHeight);
          if (box) setDockBox(prev => (prev && prev.left === box.left && prev.top === box.top && prev.width === box.width && prev.height === box.height ? prev : box));
        }
        return;
      }
      const cardHeight = card.offsetHeight;
      // Remember the natural in-panel height while the card sits in its slot.
      if (hostRef.current?.parentNode === slot) restHeightRef.current = cardHeight;
      const p = placementRef.current;
      let next: boolean;
      if (p === 'float') next = true;
      else if (p === 'top' || p === 'bottom') next = false; // the panel scrolls / the list shortens instead
      else {
        const padBottom = parseFloat(getComputedStyle(aside).paddingBottom) || 0;
        const free = freeHeightForCard({ viewportHeight: window.innerHeight, contentHeight: content.offsetHeight, slotHeight: slot.offsetHeight, padBottom });
        next = decideDock(dockedRef.current, free, cardHeight);
      }
      if (next !== dockedRef.current) { if (next) dockNow(); else undockNow(); }
      if (next && dockedRef.current) {
        const box = currentDockBox(cardHeight);
        if (box) setDockBox(prev => (prev && prev.left === box.left && prev.top === box.top && prev.width === box.width && prev.height === box.height ? prev : box));
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(run); };
    scheduleRef.current = schedule;
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(content); ro.observe(aside); ro.observe(frame);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener('resize', schedule);
    return () => { scheduleRef.current = null; ro.disconnect(); window.removeEventListener('resize', schedule); if (raf) cancelAnimationFrame(raf); };
  }, [dockEnabled, dock?.frameRef, dockNow, undockNow, currentDockBox, popped, docked, placement]);
  // A moved/nudged/reset offset re-places the docked box without re-subscribing.
  useEffect(() => { scheduleRef.current?.(); }, [dockOffset]);

  // Drag the docked card by its grip (pointer), nudge it with the arrow keys,
  // double-click to send it home. The offset is remembered per browser and
  // re-clamped to the frame whenever the layout or zoom changes.
  const dragRef = useRef<{ x: number; y: number; start: DockOffset; moved: boolean; from: 'panel' | 'float'; grab: Rect | null } | null>(null);
  const commitOffset = useCallback((next: DockOffset) => {
    const frame = dock?.frameRef.current;
    const aside = slotRef.current?.closest('aside');
    const card = cardRef.current;
    let normalized = next;
    if (frame && aside && card) {
      const f = frame.getBoundingClientRect();
      const fb = { left: f.left, top: f.top, width: f.width, height: f.height };
      const fs = floatSizeRef.current;
      const width = fs ? clampFloatSize(fs, fb).w : dockWidth(f.width, aside.getBoundingClientRect().width);
      normalized = normalizeDockOffset(fb, width, card.offsetHeight, next);
    }
    setDockOffset(normalized);
    writeDockOffset(normalized);
  }, [dock?.frameRef]);
  const boxes = () => {
    const aside = slotRef.current?.closest('aside');
    const frame = dock?.frameRef.current;
    if (!aside || !frame) return null;
    const a = aside.getBoundingClientRect(), f = frame.getBoundingClientRect();
    return {
      panel: { left: a.left, top: a.top, width: a.width, height: a.height },
      frame: { left: f.left, top: f.top, width: f.width, height: f.height },
    };
  };
  // The offset (from the frame's bottom-right anchor) that puts the card's top-left at `box`.
  const offsetForBox = (box: Rect): DockOffset | null => {
    const b = boxes();
    const card = cardRef.current;
    if (!b || !card) return null;
    const fs = floatSizeRef.current;
    const width = fs ? clampFloatSize(fs, b.frame).w : dockWidth(b.frame.width, b.panel.width);
    const anchor = dockRect(b.frame, width, card.offsetHeight, DOCK_HOME);
    return { dx: box.left - anchor.left, dy: box.top - anchor.top };
  };
  // Grab the card by its grip from wherever it is (panel or floating). It follows
  // the pointer anywhere; where it is dropped decides where it goes:
  //   panel top half / bottom half → first / last block in the panel
  //   the render frame              → floats there (kept inside the frame)
  //   anywhere else                 → back inside the frame if it was floating, else back in the panel
  const onGripPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, start: dockOffsetRef.current, moved: false, from: dockedRef.current ? 'float' : 'panel', grab: null };
  };
  const onGripPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DOCK_DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      const card = cardRef.current;
      const r = card?.getBoundingClientRect();
      d.grab = r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: e.clientX, top: e.clientY, width: 0, height: 0 };
      if (!dockedRef.current) { measure(); setPopped(true); } // lift it out; its slot stays as a spacer
    }
    const g = d.grab!;
    const vw = window.innerWidth, vh = window.innerHeight;
    setDragBox({
      left: Math.min(Math.max(0, g.left + dx), Math.max(0, vw - g.width)),
      top: Math.min(Math.max(0, g.top + dy), Math.max(0, vh - g.height)),
      width: g.width,
      height: g.height,
    });
    const b = boxes();
    if (!b) return;
    const target = dropTargetFor(e.clientX, e.clientY, b.panel, b.frame);
    const end = target === 'top' || target === 'bottom' ? target : null;
    if (end === previewRef.current) return;
    if (end) {
      // Room the panel must free, sized by the card's natural in-panel height. A
      // card lifted out of the panel still holds its own room (its spacer).
      if (d.from === 'float') {
        const slot = slotRef.current;
        const content = slot?.parentElement;
        const aside = slot?.closest('aside');
        if (slot && content && aside) {
          const padBottom = parseFloat(getComputedStyle(aside).paddingBottom) || 0;
          const free = freeHeightForCard({ viewportHeight: window.innerHeight, contentHeight: content.offsetHeight, slotHeight: slot.offsetHeight, padBottom });
          const restH = restHeightRef.current ?? rect?.height ?? cardRef.current?.offsetHeight ?? 0;
          dock?.previewReturn?.(returnRoom(free, restH));
        }
      }
      setPreview(end);
    } else {
      if (d.from === 'float') dock?.previewReturn?.(null);
      setPreview(null);
    }
  };
  const onGripPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.moved) return;
    setDragging(false);
    const dropped = dragBoxRef.current;
    setDragBox(null);
    const end = previewRef.current;
    if (end) {
      // Into the panel at that end: keep the room the list gave up.
      if (d.from === 'float') dock?.commitReturn?.();
      setPreview(null);
      setPlacement(end);
      if (d.from === 'float') setDockOffset(d.start); // the float spot stays for next time
      undockNow();
      return;
    }
    const b = boxes();
    const target = b ? dropTargetFor(e.clientX, e.clientY, b.panel, b.frame) : 'none';
    if (target === 'float' || d.from === 'float') {
      // Float where it was dropped (or, dropped outside the frame, the nearest spot inside it).
      const off = dropped ? offsetForBox(dropped) : null;
      if (off) commitOffset(off);
      setPlacement('float');
      if (!dockedRef.current) {
        const card = cardRef.current;
        if (card) {
          const box = currentDockBox(card.offsetHeight);
          if (box) setDockBox(box);
        }
        setDocked(true);
      }
      return;
    }
    // Lifted out of the panel and dropped nowhere valid: back where it was.
    undockNow();
  };
  // A cancelled drag (lost pointer) never lands: undo any room the panel made.
  const onGripPointerCancel = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (previewRef.current) { if (d?.from === 'float') dock?.previewReturn?.(null); setPreview(null); }
    if (!d?.moved) return;
    setDragging(false);
    setDragBox(null);
    if (d.from === 'float') commitOffset(dockOffsetRef.current);
    else undockNow();
  };
  const onGripKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!dockedRef.current) return; // arrows nudge only while floating
    const next = nudgeDockOffset(dockOffsetRef.current, e.key);
    if (!next) return;
    e.preventDefault();
    commitOffset(next);
  };

  // Corner grip (floating only): drag to set the card's width and height. The
  // top-left corner stays put; the size is clamped to the frame and remembered.
  const resizeRef = useRef<{ x: number; w: number; h: number; off: DockOffset } | null>(null);
  const onResizeDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const card = cardRef.current;
    if (!card || !dockBox) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resizeRef.current = { x: e.clientX, w: dockBox.width, h: card.offsetHeight, off: dockOffsetRef.current };
    setResizing(true);
  };
  // Width only (horizontal or diagonal drags); the height follows the content.
  const onResizeMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = resizeRef.current;
    const b = boxes();
    if (!r || !b) return;
    const w = floatWidthForDrag(r.w, r.h, e.clientX - r.x, b.frame);
    if (w === r.w && !floatSizeRef.current) return; // no horizontal change yet: keep the default size
    const h = Math.round(r.h * (w / r.w)); // ≈ new height (the preview scales with the width)
    setFloatSize({ w, h });
    // The dock anchors at the frame's bottom-right: shift by the growth so the top-left stays put.
    setDockOffset({ dx: r.off.dx + (w - r.w), dy: r.off.dy + (h - r.h) });
  };
  const onResizeUp = () => {
    const r = resizeRef.current;
    resizeRef.current = null;
    setResizing(false);
    if (!r) return;
    writeFloatSize(floatSizeRef.current);
    commitOffset(dockOffsetRef.current);
  };
  const dockGrip = dockEnabled && !centered ? (
    <button
      type="button"
      aria-label="Move the card — drag it into the 3D view to float it, or onto the top or bottom of the side panel; while floating, arrow keys nudge it and double-click sends it back to the corner"
      title="Drag: float it over the 3D view, or drop on the top / bottom of the panel · arrows nudge · double-click: back to corner"
      onPointerDown={onGripPointerDown}
      onPointerMove={onGripPointerMove}
      onPointerUp={onGripPointerUp}
      onPointerCancel={onGripPointerCancel}
      onKeyDown={onGripKeyDown}
      onDoubleClick={() => { if (dockedRef.current) commitOffset(DOCK_HOME); }}
      className="inline-flex items-center justify-center rounded-lg flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]"
      style={{ width: 28, height: 28, color: 'var(--smoke)', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
    >
      {/* six-dot grip */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="9" cy="5" r="2" /><circle cx="15" cy="5" r="2" />
        <circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
        <circle cx="9" cy="19" r="2" /><circle cx="15" cy="19" r="2" />
      </svg>
    </button>
  ) : null;

  // The card markup. It fills whatever container it currently sits in (slot or
  // overlay), so growth comes entirely from the overlay's animated width.
  // On mobile at-rest the card is seamless inside the shared toolbox rectangle:
  // no background/border/shadow/rounding, tighter padding. When popped to the
  // centered overlay it always wears full card chrome.
  const merged = isMobile && !centered;
  // Floating: a little more room under the buttons (and the corner grip). A manual
  // size only sets the width; the height always follows the content.
  const floating = docked && !centered && !isMobile;
  const cardMarkup = (
    <div
      ref={cardRef}
      data-barber-card=""
      className={merged ? 'flex-shrink-0 px-4 pt-0 pb-3 flex flex-col gap-2' : CARD_CLASS}
      style={{
        position: 'relative',
        background: merged ? 'transparent' : 'var(--biscuit-lt)',
        border: merged ? 'none' : '1px solid rgba(42,32,26,0.1)',
        boxShadow: merged ? 'none' : centered ? BIG_SHADOW : REST_SHADOW,
        transition: `box-shadow ${DUR}ms ease`,
        ...(floating ? { paddingBottom: 24 } : {}),
      }}
    >
      {(!isMobile || isReady) && (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {dockGrip}
          {!isMobile && <span className="pill pill-tomato">NEW: Show your barber!</span>}
        </div>
        {isReady && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { if (centered) collapse(); setPreviewHidden(h => !h); }}
              aria-pressed={previewHidden}
              aria-label={previewHidden ? 'Show the 360° preview' : 'Hide the 360° preview'}
              title={previewHidden ? 'Show preview' : 'Hide preview'}
              className="card-preview-toggle"
            >
              {previewHidden ? (
                // eye (show)
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                // eye-off (hide)
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.8 17.8 0 0 1-2.4 3.3M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                </svg>
              )}
            </button>
            <button
              onClick={() => onRequestVideo?.()}
              aria-label="Record a fresh 360° video of the latest cut"
              className="font-mono text-[10px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--ink)] transition-colors inline-flex items-center gap-1"
            >
              {/* refresh icon — refilm */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 4v5h-5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => (centered ? collapse() : expand())}
              aria-label={centered ? 'Shrink the video back to the panel' : 'Expand the video'}
              title={centered ? 'Exit fullscreen' : 'Expand'}
              className="inline-flex items-center justify-center rounded-lg transition-transform hover:scale-110 active:scale-95"
              style={{
                width: 28, height: 28,
                color: 'var(--ink)',
                background: 'rgba(42,32,26,0.14)',
                border: '1px solid rgba(42,32,26,0.18)',
              }}
            >
              {centered ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Icon-only action row: 360° video · Recap of requests · extras (Quick try-ons). */}
      <div className="card-actions">
        <button
          type="button"
          onClick={() => (capturing ? onCancelVideo?.() : onRequestVideo?.())}
          disabled={capturing && !onCancelVideo}
          aria-label={capturing ? 'Cancel the 360° video' : 'Record a 360° video of your cut to show your barber'}
          title={capturing ? 'Cancel' : '360° video for your barber'}
          className="card-action card-action-360"
          data-capturing={capturing || undefined}
        >
          {capturing ? (
            <>
              {/* Progress traced around the button (no layout change), with a cancel ✕. */}
              <ButtonProgressRing progress={videoState === 'encoding' ? 1 : videoProgress} label="Recording the 360° video" />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </>
          ) : (
            // Solid oval badge with an italic "360°" knocked out of it.
            <svg width="36" height="36" viewBox="1 5 22 14" aria-hidden>
              <defs>
                <mask id={`deg360-${badgeId}`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                  <ellipse cx="12" cy="12" rx="10.4" ry="6.2" fill="white" />
                  <text x="12" y="14.3" textAnchor="middle" fontSize="6.6" fontWeight="800" fontStyle="italic" fill="black" style={{ fontFamily: 'var(--font-dmsans), sans-serif' }}>360°</text>
                </mask>
              </defs>
              <rect x="0" y="0" width="24" height="24" fill="currentColor" mask={`url(#deg360-${badgeId})`} />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowRecap(true)}
          aria-label="Recap: what you asked for to get this cut"
          title="Recap of your requests"
          className="card-action"
        >
          {/* Filled receipt, rolled at top and bottom (wider rounded ends), with its
              two text lines cut out (evenodd). Cropped viewBox so it matches the
              other icons' size. */}
          <svg width="25" height="25" viewBox="3.2 1.8 17.6 20.4" aria-hidden>
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M6 5.2H4.9a1.3 1.3 0 0 1 0-2.6h14.2a1.3 1.3 0 0 1 0 2.6H18v13.6h1.1a1.3 1.3 0 0 1 0 2.6H4.9a1.3 1.3 0 0 1 0-2.6H6Z M9.2 8.6h5.6a0.95 0.95 0 0 1 0 1.9H9.2a0.95 0.95 0 0 1 0-1.9Z M9.2 13.1h5.6a0.95 0.95 0 0 1 0 1.9H9.2a0.95 0.95 0 0 1 0-1.9Z"
            />
          </svg>
        </button>
        {extraActions}
      </div>
      {showRecap && <RequestRecap prompts={editPrompts ?? []} onClose={() => setShowRecap(false)} />}


      {videoState === 'error' && (
        <div className="error-shake px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
          <span className="font-sans text-[9px] uppercase tracking-wider mr-2 font-semibold not-italic">oops</span>
          couldn’t record the video — <button onClick={() => onRequestVideo?.()} className="underline">try again</button>
        </div>
      )}

      {isReady && videoUrl && !previewHidden && (
        <BarberVideoResult
          videoUrl={videoUrl}
          ext={videoExt}
          projectName={projectName}
          videoMaxHeight={centered ? BIG_VIDEO_MAX_H : undefined}
          onDimensions={() => setDimsReady(true)}
        />
      )}

      {/* Corner grip (floating only): drag to resize; double-click for the default size. */}
      {floating && (
        <button
          type="button"
          className="dock-resize"
          aria-label="Resize the card — drag the corner sideways or diagonally; double-click for the default size"
          title="Drag sideways or diagonally to resize · double-click: default size"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onDoubleClick={() => { setFloatSize(null); writeFloatSize(null); }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M11 2.5 V11 H2.5 Z" fill="currentColor" /></svg>
        </button>
      )}
    </div>
  );

  // Which end of the panel the slot sits at: the live drag preview wins, else the user's placement.
  const slotTop = preview ? preview === 'top' : placement === 'top';

  // Fixed overlay positioner. Centred via translate(-50%,-50%), so we only glide
  // its centre-point (slot centre → viewport centre) and animate its width.
  // Three resting places: the slot, the dock over the frame, or centred fullscreen.
  const overlayStyle: React.CSSProperties = popped && rect ? {
    position: 'fixed',
    zIndex: 70,
    transform: 'translate(-50%, -50%)',
    // No glide while the user is dragging or resizing: the card tracks the pointer.
    transition: dragging || resizing ? 'none' : `top ${dur}ms ${EASE}, left ${dur}ms ${EASE}, width ${dur}ms ${EASE}`,
    willChange: 'top, left, width',
    ...(centered
      ? { top: '50%', left: '50%', width: BIG_WIDTH }
      : dragging && dragBox
        ? { top: dragBox.top + dragBox.height / 2, left: dragBox.left + dragBox.width / 2, width: dragBox.width }
        : docked && dockBox
        ? { top: dockBox.top + dockBox.height / 2, left: dockBox.left + dockBox.width / 2, width: dockBox.width }
        : { top: rect.top + rect.height / 2, left: rect.left + rect.width / 2, width: rect.width }),
  } : {};

  return (
    <>
      {/* Always-in-flow slot: hosts the card at rest, becomes a fixed-height
          spacer (and measuring target) while the card floats in the portal. */}
      <div
        ref={slotRef}
        className="flex-shrink-0"
        aria-hidden={returning || undefined}
        data-slot-end={slotTop ? 'top' : 'bottom'}
        style={{
          // order -1 puts the card first in the panel (above the toolbox).
          order: slotTop ? -1 : undefined,
          // Folds away while the card floats so the toolbox reclaims the room; opens
          // at once to the card's natural size while it's dragged over that end.
          marginTop: slotTop || (docked && !returning) ? 0 : 12,
          marginBottom: slotTop && !(docked && !returning) ? 12 : 0,
          height: returning
            ? (restHeightRef.current ?? rect?.height ?? cardRef.current?.offsetHeight ?? 0)
            : popped && rect ? (docked ? 0 : rect.height) : undefined,
          // Instant while the user is dragging; the glide is only for automatic moves.
          transition: dragging || returning ? 'none' : `height ${dur}ms ${EASE}, margin-top ${dur}ms ${EASE}`,
        }}
      />

      {/* The card markup lives permanently in the persistent host. */}
      {hostRef.current && createPortal(cardMarkup, hostRef.current)}

      {/* Body-level overlay so position:fixed escapes the Studio panel's
          transformed / scroll-clipped ancestors. The host is re-parented into
          the positioner imperatively (see the layout effect above). */}
      {popped && typeof document !== 'undefined' && createPortal(
        <>
          {centered && (
            <div
              onClick={collapse}
              aria-hidden
              style={{
                position: 'fixed', inset: 0, zIndex: 60,
                background: 'rgba(20,14,10,0.62)', backdropFilter: 'blur(3px)',
                animation: 'fadeIn 240ms ease',
              }}
            />
          )}
          <div
            ref={overlayRef}
            style={overlayStyle}
            onTransitionEnd={(e) => {
              // Once the shrink glide lands, drop back to normal flow so the card
              // scrolls with the panel again.
              if (e.target === e.currentTarget && e.propertyName === 'width' && !centered && !dockedRef.current) setPopped(false);
            }}
          />
        </>,
        document.body,
      )}
    </>
  );
}
