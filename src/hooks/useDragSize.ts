'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A user-resizable length (px) driven by a drag handle, remembered per browser.
 *
 * Spread `handleProps` onto the handle element. Dragging along `axis` changes
 * the size (set `invert` when dragging toward the origin should grow it, e.g. a
 * handle on a right-hand panel's left edge). Arrow keys resize by 16px, so the
 * handle works without a pointer. The first render uses `initial` so server and
 * client HTML match; the stored size is applied before the first paint.
 *
 * Pass `liveRef` + `liveProperty` to resize that element directly during a
 * drag and commit React state only on release. Re-rendering a heavy tree on
 * every pointer move starves other updates (e.g. a WebGL canvas re-fitting to
 * its new size), which then only catch up once the drag ends.
 */
export function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

const KEY_STEP = 16;

export function useDragSize({
  storageKey,
  initial,
  min,
  max,
  axis,
  invert = false,
  liveRef,
  liveProperty,
  remoteValue,
  onCommit,
  fallback,
  onReset,
  snap,
}: {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  axis: 'x' | 'y';
  invert?: boolean;
  liveRef?: React.RefObject<HTMLElement | null>;
  liveProperty?: 'width' | 'height';
  /** A size saved on the user's account; applied when it arrives (wins over the local cache). */
  remoteValue?: number;
  /** Called with the final size after a drag or key press, e.g. to save it to the account. */
  onCommit?: (size: number) => void;
  /** Size to use while the user has no saved preference (e.g. an auto-fit height). */
  fallback?: number;
  /** Called when the user resets (double-clicks the handle), e.g. to clear the account value. */
  onReset?: () => void;
  /** Where a released drag settles, e.g. snapping a too-small size shut to 0. */
  snap?: (size: number) => number;
}) {
  const [size, setSize] = useState(initial);
  const sizeRef = useRef(initial);
  const drag = useRef<{ start: number; startSize: number } | null>(null);
  // Whether the user has a size of their own (stored, on the account, or dragged);
  // until then the fallback drives the size.
  const hasPreference = useRef(false);

  const commit = useCallback((next: number, persist: boolean) => {
    const v = clampSize(next, min, max);
    sizeRef.current = v;
    setSize(v);
    if (persist) {
      try { localStorage.setItem(storageKey, String(v)); } catch { /* private mode etc. */ }
    }
  }, [min, max, storageKey]);

  // A layout effect, so the cached size is in place before the first paint
  // (no frame at `initial` and then a jump).
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const stored = raw === null || raw === '' ? NaN : Number(raw);
      // 0 is a real preference (e.g. a list folded shut), so test for a number, not truthiness.
      if (Number.isFinite(stored)) { hasPreference.current = true; commit(stored, false); }
    } catch { /* storage unavailable: keep the default */ }
  }, [storageKey, commit]);

  // The account's saved size arrives after mount (it's a query); adopt it unless mid-drag.
  useEffect(() => {
    if (remoteValue === undefined || drag.current) return;
    hasPreference.current = true;
    commit(remoteValue, true);
  }, [remoteValue, commit]);

  useEffect(() => {
    if (fallback === undefined || hasPreference.current || drag.current) return;
    commit(fallback, false);
  }, [fallback, commit]);

  const onResetRef = useRef(onReset);
  useEffect(() => { onResetRef.current = onReset; }, [onReset]);
  const fallbackRef = useRef(fallback);
  useEffect(() => { fallbackRef.current = fallback; }, [fallback]);

  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  const snapRef = useRef(snap);
  useEffect(() => { snapRef.current = snap; }, [snap]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { start: axis === 'x' ? e.clientX : e.clientY, startSize: sizeRef.current };
  }, [axis]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (axis === 'x' ? e.clientX : e.clientY) - d.start;
    const next = d.startSize + (invert ? -delta : delta);
    const el = liveProperty ? liveRef?.current : null;
    if (el && liveProperty) {
      // Hot path: touch only the DOM; React state catches up on release.
      const v = clampSize(next, min, max);
      sizeRef.current = v;
      el.style[liveProperty] = `${v}px`;
      e.currentTarget.setAttribute('aria-valuenow', String(v));
    } else {
      commit(next, false);
    }
  }, [axis, invert, commit, liveRef, liveProperty, min, max]);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    if (snapRef.current) sizeRef.current = clampSize(snapRef.current(sizeRef.current), min, max);
    const moved = sizeRef.current !== drag.current.startSize;
    drag.current = null;
    commit(sizeRef.current, true);
    if (moved) { hasPreference.current = true; onCommitRef.current?.(sizeRef.current); }
  }, [commit, min, max]);

  // Double-click: forget the user's size and go back to the fallback.
  const onDoubleClick = useCallback(() => {
    hasPreference.current = false;
    try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    if (fallbackRef.current !== undefined) commit(fallbackRef.current, false);
    onResetRef.current?.();
  }, [storageKey, commit]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const grow = axis === 'x' ? (invert ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
    const shrink = axis === 'x' ? (invert ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    commit(sizeRef.current + (e.key === grow ? KEY_STEP : -KEY_STEP), true);
    hasPreference.current = true;
    onCommitRef.current?.(sizeRef.current);
  }, [axis, invert, commit]);

  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': (axis === 'x' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': size,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown,
    onDoubleClick,
  };

  // Set the size from code (e.g. the panel making room for a returning card):
  // treated like a finished drag, so it's remembered and reported.
  const setSizeFromCode = useCallback((next: number) => {
    commit(next, true);
    hasPreference.current = true;
    onCommitRef.current?.(sizeRef.current);
  }, [commit]);

  return { size, handleProps, setSize: setSizeFromCode };
}
