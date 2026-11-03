// Cache policy for /api/splat key redirects. Lives outside the route file
// because Next.js route modules may only export handlers/config.

/** getSignedDownloadUrl's default lifetime (7 days). */
export const SIGNED_URL_TTL_S = 7 * 24 * 60 * 60;
/** Cache the 307 (and thus the same signed URL) for just under that lifetime. */
export const KEY_REDIRECT_MAX_AGE_S = 6 * 24 * 60 * 60;
