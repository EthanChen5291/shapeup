// The try-on merge state machine, shared by the Worker entry (prebakeMerge.worker.ts)
// and the in-thread fallback (prebakeMerge.ts). Kept in its own module so the worker
// entry does not import the file that spawns it (webpack flags that as a circular chunk).

import { fetchPrebake } from './prebakeFetch';
import { headCenterX } from './splatFit';
import { mergeSplatBuffersWith, type MergeOptions } from './splatMerge';

export interface MergeRequest {
  type: 'merge';
  id: number;
  variantId: string;
  splatUrl: string;
  preferSpz: boolean;
  opts: MergeOptions & {
    /** Object x the hair's own temple-band centre (headCenterX over the hair rows, scaled by
     *  k·kx) should land on: the wearer's head centre. Several catalog assets sit up to 0.05 off
     *  their house head (Long Layers + Bangs −0.053), so each asset is centred by its own extent
     *  rather than by one house centre per gender. Resolved into `dx` here, where the hair bytes
     *  are; skipped when the hair has no rows in the band. */
    centerX?: number;
  };
}

/** The dx that puts the hair's temple-band centre on `centerX`, or 0 when it can't be measured. */
export function centerShift(hair: ArrayBuffer, centerX: number | undefined, k: number, kx: number): number {
  if (centerX === undefined) return 0;
  const mid = headCenterX(hair);
  return mid === null ? 0 : centerX - mid * k * kx;
}
export interface SetBaseRequest { type: 'base'; bytes: ArrayBuffer }
/** Fetch and decode a style into the hair cache so its later merge skips the network. */
export interface WarmRequest { type: 'warm'; variantId: string; splatUrl: string; preferSpz: boolean }
export type MergeWorkerRequest = MergeRequest | SetBaseRequest | WarmRequest;
export type MergeWorkerResponse =
  | { type: 'merged'; id: number; bytes: ArrayBuffer }
  | { type: 'error'; id: number; message: string };
/** Interim download progress for a merge request (never sent for a cache hit). */
export type MergeProgress = { type: 'progress'; id: number; loaded: number; total: number };

/** The merge state machine: one head, a hair cache, merge on request. Runs anywhere. */
export function createMergeCore(fetchImpl: typeof fetch = fetch) {
  let base: ArrayBuffer | null = null;
  const hair = new Map<string, ArrayBuffer>();
  // Fetches in flight, by variant: a merge that arrives while its warm is still downloading
  // joins that download instead of starting a second one. (Measured 2026-11-05: without this
  // a swatch tapped before its warm finished paid the whole fetch+decode again, ~3.4 s on dev.)
  const inflight = new Map<string, Promise<ArrayBuffer>>();
  const fetchOnce = (variantId: string, splatUrl: string, preferSpz: boolean, onProgress?: (loaded: number, total: number) => void) => {
    let p = inflight.get(variantId);
    if (!p) {
      const t0 = Date.now();
      p = fetchPrebake(splatUrl, fetchImpl, { preferSpz, onProgress })
        .then((bytes) => { hair.set(variantId, bytes); console.info(`[prebake] ${variantId} fetched+decoded in ${Date.now() - t0} ms`); return bytes; })
        .finally(() => inflight.delete(variantId));
      inflight.set(variantId, p);
    }
    return p;
  };
  return {
    setBase(bytes: ArrayBuffer) { base = bytes; },
    async merge(req: MergeRequest, onProgress?: (p: MergeProgress) => void): Promise<MergeWorkerResponse> {
      try {
        if (!base) throw new Error('no base head loaded');
        const h = hair.get(req.variantId) ?? await fetchOnce(req.variantId, req.splatUrl, req.preferSpz,
          onProgress && ((loaded, total) => onProgress({ type: 'progress', id: req.id, loaded, total })));
        const { centerX, ...opts } = req.opts;
        opts.dx = (opts.dx ?? 0) + centerShift(h, centerX, opts.k, opts.kx ?? 1);
        const merged = mergeSplatBuffersWith(base, h, opts);
        return { type: 'merged', id: req.id, bytes: merged.buffer as ArrayBuffer };
      } catch (err) {
        return { type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) };
      }
    },
    /** Message handler shared by the Worker entry and the in-thread fallback. */
    /** Best effort: a failed warm is simply not cached and the real merge reports the error. */
    async warm(req: WarmRequest): Promise<void> {
      if (hair.has(req.variantId)) return;
      try { await fetchOnce(req.variantId, req.splatUrl, req.preferSpz); } catch { /* the merge will retry and report */ }
    },
    has(variantId: string): boolean { return hair.has(variantId); },
    async handle(msg: MergeWorkerRequest, onProgress?: (p: MergeProgress) => void): Promise<MergeWorkerResponse | null> {
      if (msg.type === 'base') { this.setBase(msg.bytes); return null; }
      if (msg.type === 'warm') { await this.warm(msg); return null; }
      return this.merge(msg, onProgress);
    },
  };
}
