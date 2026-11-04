// Prebaked hair is published twice: <name>.spz (compressed, ~2.7× smaller) and
// <name>.splat (the original). Try the .spz first and decode it to .splat rows;
// if it's missing or unreadable, fall back to the .splat, so styles can move to
// .spz one at a time and nothing breaks if an upload is incomplete.

import { decodeSpz } from './spz';

export const spzUrlFor = (splatUrl: string) => splatUrl.replace(/\.splat$/, '.spz');

/**
 * Add `?splat` to the studio URL to load the original .splat files instead, for
 * a side-by-side check of what the compression changed.
 */
export function prebakeSpzDisabled(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).has('splat');
}

/** `?warm=all`: warm every style of the current gender when the list opens (screen recordings on localhost). */
export function prebakeWarmAll(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('warm') === 'all';
}

/** The prebake's .splat rows, from its .spz when available. */
/** Download progress: bytes so far and the total (0 when the server sent no Content-Length). */
export type FetchProgress = (loaded: number, total: number) => void;

/** Reads a response body to the end, reporting bytes as they arrive. */
export async function readWithProgress(res: Response, onProgress?: FetchProgress): Promise<ArrayBuffer> {
  if (!onProgress || !res.body) return res.arrayBuffer();
  const total = Number(res.headers.get('Content-Length') ?? 0) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

export async function fetchPrebake(
  splatUrl: string,
  fetchImpl: typeof fetch = fetch,
  { preferSpz = !prebakeSpzDisabled(), onProgress }: { preferSpz?: boolean; onProgress?: FetchProgress } = {},
): Promise<ArrayBuffer> {
  if (preferSpz && splatUrl.endsWith('.splat')) {
    try {
      const res = await fetchImpl(spzUrlFor(splatUrl));
      if (res.ok) {
        const rows = await decodeSpz(await readWithProgress(res, onProgress));
        return rows.buffer.slice(rows.byteOffset, rows.byteOffset + rows.byteLength) as ArrayBuffer;
      }
    } catch (err) {
      console.warn('[prebake] .spz unusable, loading .splat instead:', err instanceof Error ? err.message : err);
    }
  }
  const res = await fetchImpl(splatUrl);
  if (!res.ok) throw new Error(`prebake ${res.status}`);
  return readWithProgress(res, onProgress);
}

/** The browser's Data Saver flag (Chromium); absent elsewhere, so false. */
const saveDataRequested = (): boolean =>
  typeof navigator !== 'undefined' && !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;

/** Run `task` when the browser is idle (or soon, where requestIdleCallback is missing). */
const whenIdle = (task: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(task, { timeout: 3000 }) : setTimeout(task, 200);

/**
 * Warm the HTTP cache with a cut's other colours, so switching swatches loads from
 * cache. Low priority and idle-scheduled: never competes with the style on screen.
 * Failures are ignored (the real load retries and reports).
 */
export function prefetchPrebakes(
  splatUrls: readonly string[],
  fetchImpl: typeof fetch = fetch,
  { preferSpz = !prebakeSpzDisabled(), schedule = whenIdle, saveData = saveDataRequested() }:
    { preferSpz?: boolean; schedule?: (task: () => void) => unknown; saveData?: boolean } = {},
): void {
  if (saveData) return; // the user asked for less data: only load what they tap
  for (const url of splatUrls) {
    const target = preferSpz && url.endsWith('.splat') ? spzUrlFor(url) : url;
    schedule(() => {
      void fetchImpl(target, { priority: 'low' } as RequestInit).catch(() => {});
    });
  }
}
