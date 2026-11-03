// Download a project's head into the HTTP cache while the pointer rests on its
// dashboard card, so the studio's splat loader finds it there instead of
// starting a ~6 MB download after the click. Works because both hops are
// cacheable: the /api/splat redirect (src/lib/splatRedirectCache.ts) and the
// immutable S3 object behind it. Same URL as the studio requests.

const warmed = new Set<string>();

/** The URL the studio loads a head from. */
export const splatUrl = (key: string) => `/api/splat?key=${encodeURIComponent(key)}`;

/** Whether the visitor asked to save data (Chrome's Data Saver / Save-Data). */
function saveData(): boolean {
  const conn = (globalThis.navigator as Navigator & { connection?: { saveData?: boolean } } | undefined)?.connection;
  return !!conn?.saveData;
}

/** Start warming `key` once per page; returns whether a download was started. */
export function warmSplat(key: string | undefined | null, fetchImpl: typeof fetch = fetch): boolean {
  if (!key || warmed.has(key) || saveData()) return false;
  warmed.add(key);
  // Read the body to the end: a response is only cached once fully received.
  fetchImpl(splatUrl(key))
    .then(r => (r.ok ? r.arrayBuffer() : undefined))
    .catch(() => { warmed.delete(key); });
  return true;
}

/** Test hook. */
export function resetWarmedSplats() { warmed.clear(); }
