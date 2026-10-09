export const BUILD_STALE_MS = 6 * 60 * 1000; // 6 minutes
export const STALE_BUILD_ERROR = "That build didn't finish. Try again.";

export type BuildState = 'idle' | 'building' | 'ready' | 'failed';

/**
 * Derives the client-visible build state from a project document.
 *
 * Rules (applied in order):
 *   - null/undefined project → 'idle'
 *   - splatS3Key present → 'ready'  (covers legacy projects with no buildStatus)
 *   - no buildStatus → 'idle'
 *   - buildStatus 'failed' → 'failed'
 *   - buildStatus 'ready' → 'ready'
 *   - buildStatus 'building' older than BUILD_STALE_MS → 'failed' (server died)
 *   - buildStatus 'building' → 'building'
 */
export function resolveBuildState(
  p: { buildStatus?: string; buildStartedAt?: number; splatS3Key?: string } | null | undefined,
  now = Date.now(),
): BuildState {
  if (!p) return 'idle';
  if (p.splatS3Key) return 'ready';
  if (!p.buildStatus) return 'idle';
  if (p.buildStatus === 'failed') return 'failed';
  if (p.buildStatus === 'ready') return 'ready';
  if (p.buildStatus === 'building') {
    if (p.buildStartedAt !== undefined && now - p.buildStartedAt > BUILD_STALE_MS) {
      return 'failed';
    }
    return 'building';
  }
  return 'idle';
}
