// The try-on merge state machine, shared by the Worker entry (prebakeMerge.worker.ts)
// and the in-thread fallback (prebakeMerge.ts). Kept in its own module so the worker
// entry does not import the file that spawns it (webpack flags that as a circular chunk).

import { fetchPrebake } from './prebakeFetch';
import { mergeSplatBuffersWith, type MergeOptions } from './splatMerge';

export interface MergeRequest {
  type: 'merge';
  id: number;
  variantId: string;
  splatUrl: string;
  preferSpz: boolean;
  opts: MergeOptions;
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
  return {
    setBase(bytes: ArrayBuffer) { base = bytes; },
    async merge(req: MergeRequest, onProgress?: (p: MergeProgress) => void): Promise<MergeWorkerResponse> {
      try {
        if (!base) throw new Error('no base head loaded');
        let h = hair.get(req.variantId);
        if (!h) {
          h = await fetchPrebake(req.splatUrl, fetchImpl, {
            preferSpz: req.preferSpz,
            onProgress: onProgress && ((loaded, total) => onProgress({ type: 'progress', id: req.id, loaded, total })),
          });
          hair.set(req.variantId, h);
        }
        const merged = mergeSplatBuffersWith(base, h, req.opts);
        return { type: 'merged', id: req.id, bytes: merged.buffer as ArrayBuffer };
      } catch (err) {
        return { type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) };
      }
    },
    /** Message handler shared by the Worker entry and the in-thread fallback. */
    /** Best effort: a failed warm is simply not cached and the real merge reports the error. */
    async warm(req: WarmRequest): Promise<void> {
      if (hair.has(req.variantId)) return;
      try { hair.set(req.variantId, await fetchPrebake(req.splatUrl, fetchImpl, { preferSpz: req.preferSpz })); } catch { /* the merge will retry and report */ }
    },
    has(variantId: string): boolean { return hair.has(variantId); },
    async handle(msg: MergeWorkerRequest, onProgress?: (p: MergeProgress) => void): Promise<MergeWorkerResponse | null> {
      if (msg.type === 'base') { this.setBase(msg.bytes); return null; }
      if (msg.type === 'warm') { await this.warm(msg); return null; }
      return this.merge(msg, onProgress);
    },
  };
}
