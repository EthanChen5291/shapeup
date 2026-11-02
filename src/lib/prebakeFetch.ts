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

/** The prebake's .splat rows, from its .spz when available. */
export async function fetchPrebake(
  splatUrl: string,
  fetchImpl: typeof fetch = fetch,
  { preferSpz = !prebakeSpzDisabled() }: { preferSpz?: boolean } = {},
): Promise<ArrayBuffer> {
  if (preferSpz && splatUrl.endsWith('.splat')) {
    try {
      const res = await fetchImpl(spzUrlFor(splatUrl));
      if (res.ok) {
        const rows = await decodeSpz(await res.arrayBuffer());
        return rows.buffer.slice(rows.byteOffset, rows.byteOffset + rows.byteLength) as ArrayBuffer;
      }
    } catch (err) {
      console.warn('[prebake] .spz unusable, loading .splat instead:', err instanceof Error ? err.message : err);
    }
  }
  const res = await fetchImpl(splatUrl);
  if (!res.ok) throw new Error(`prebake ${res.status}`);
  return res.arrayBuffer();
}
