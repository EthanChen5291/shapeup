/**
 * useSplatLoaded — fires `onLoaded` once per `src`, when drei's <Splat> has
 * finished streaming the whole file (not merely started rendering it).
 *
 * drei's SplatLoader isn't exported, so we can't read its `shared.loaded`
 * flag directly. It does, however, report to THREE.DefaultLoadingManager:
 * `itemStart(url)` before the fetch and `itemEnd(url)` after the last chunk
 * is pushed to the GPU. drei's public `useProgress` store mirrors that
 * manager — `onProgress` (fired by itemEnd) sets `item: url` and
 * `onLoad` flips `active: false` once nothing else is pending — so "our url
 * is the latest item and the manager is idle (or loaded ≥ total)" is only
 * true after the splat is fully in. We subscribe to the store imperatively
 * so progress ticks never re-render the scene.
 *
 * A safety timeout guarantees the caller is never stuck behind the ghost
 * overlay if the manager emits nothing (e.g. a useLoader cache hit, which
 * skips itemStart/itemEnd entirely).
 */

import { useEffect, useRef } from 'react';
import { useProgress } from '@react-three/drei';

/** Fallback: fire anyway after this long so the UI can never stay hidden. */
export const LOADED_SAFETY_TIMEOUT_MS = 20_000;

type ProgressState = { active: boolean; item: string; loaded: number; total: number };

export function isSplatFinished(state: ProgressState, src: string): boolean {
  if (state.item !== src) return false;
  return state.active === false || (state.loaded > 0 && state.loaded >= state.total);
}

export function useSplatLoaded(
  src: string | null | undefined,
  onLoaded: (() => void) | undefined,
  safetyTimeoutMs: number = LOADED_SAFETY_TIMEOUT_MS,
): void {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    if (!src) return;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      onLoadedRef.current?.();
    };

    // itemEnd may already have happened if the effect ran late.
    if (isSplatFinished(useProgress.getState(), src)) fire();

    const unsubscribe = useProgress.subscribe((state) => {
      if (isSplatFinished(state, src)) fire();
    });
    const timer = setTimeout(fire, safetyTimeoutMs);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [src, safetyTimeoutMs]);
}
