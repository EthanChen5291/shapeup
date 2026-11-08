// Off-main-thread try-on merging.
//
// Fetching a prebake, decoding its .spz and merging it into the head is CPU work
// that stalls the UI for tens to hundreds of milliseconds per style switch. A
// dedicated Worker owns the head bytes and a cache of hair bytes, does all of it,
// and hands back the merged buffer (transferred, not copied). Where Workers don't
// exist (SSR, unit tests) the same core runs on the calling thread, so behaviour
// is identical either way and the core is testable without a browser.

import { createMergeCore, type MergeProgress, type MergeRequest, type MergeWorkerResponse, type SetBaseRequest, type WarmRequest } from './prebakeMergeCore';
export { createMergeCore } from './prebakeMergeCore';
export type { MergeProgress, MergeRequest, MergeWorkerRequest, MergeWorkerResponse, SetBaseRequest, WarmRequest } from './prebakeMergeCore';

/** Download progress for one merge: bytes so far and the total (0 if unknown). */
export type MergeProgressFn = (loaded: number, total: number) => void;

export interface PrebakeMerger {
  setBase(bytes: ArrayBuffer): void;
  merge(variantId: string, splatUrl: string, opts: MergeRequest['opts'], preferSpz: boolean, onProgress?: MergeProgressFn): Promise<ArrayBuffer>;
  /** Fetch + decode a style into the worker's cache ahead of time (fire and forget). */
  warm(variantId: string, splatUrl: string, preferSpz: boolean): void;
  dispose(): void;
}

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>;

/** Build the Worker, or null where Workers are unavailable. Separated so tests can inject one. */
export function spawnMergeWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./prebakeMerge.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('[prebake] merge worker unavailable, merging on the main thread:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function createPrebakeMerger(worker: WorkerLike | null = spawnMergeWorker(), fetchImpl: typeof fetch = fetch): PrebakeMerger {
  let nextId = 1;
  if (!worker) {
    const core = createMergeCore(fetchImpl);
    return {
      setBase: (bytes) => core.setBase(bytes),
      warm: (variantId, splatUrl, preferSpz) => { void core.warm({ type: 'warm', variantId, splatUrl, preferSpz }); },
      async merge(variantId, splatUrl, opts, preferSpz, onProgress) {
        const res = await core.merge({ type: 'merge', id: nextId++, variantId, splatUrl, preferSpz, opts },
          onProgress && ((p) => onProgress(p.loaded, p.total)));
        if (res.type === 'error') throw new Error(res.message);
        return res.bytes;
      },
      dispose() {},
    };
  }
  const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void; onProgress?: MergeProgressFn }>();
  worker.addEventListener('message', (e: MessageEvent<MergeWorkerResponse | MergeProgress>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if (e.data.type === 'progress') { p.onProgress?.(e.data.loaded, e.data.total); return; }
    pending.delete(e.data.id);
    if (e.data.type === 'merged') p.resolve(e.data.bytes);
    else p.reject(new Error(e.data.message));
  });
  worker.addEventListener('error', (e: ErrorEvent) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'merge worker crashed'));
    pending.clear();
  });
  return {
    setBase(bytes) {
      // Copy (not transfer): the caller keeps reading the base for head-gain views.
      worker.postMessage({ type: 'base', bytes: bytes.slice(0) } satisfies SetBaseRequest);
    },
    warm(variantId, splatUrl, preferSpz) {
      worker.postMessage({ type: 'warm', variantId, splatUrl, preferSpz } satisfies WarmRequest);
    },
    merge(variantId, splatUrl, opts, preferSpz, onProgress) {
      const id = nextId++;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ type: 'merge', id, variantId, splatUrl, preferSpz, opts } satisfies MergeRequest);
      });
    },
    dispose() {
      for (const p of pending.values()) p.reject(new Error('merger disposed'));
      pending.clear();
      worker.terminate();
    },
  };
}
