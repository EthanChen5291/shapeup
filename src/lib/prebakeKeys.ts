// S3 layout for the prebaked try-on hair. The .splat files are git-ignored
// (public/**/*.splat), so deploys don't carry them: they live in the app bucket
// under `prebake/<gender>/<file>.splat`, uploaded by `npm run prebake:upload`.
// The app keeps requesting /prebake/<gender>/<file>.splat; locally the public/
// copy answers, and anywhere it's missing next.config rewrites the request to
// /api/prebake/..., which redirects to a signed S3 URL.

export const PREBAKE_S3_PREFIX = 'prebake/';
export const PREBAKE_GENDER_DIRS = ['men', 'women'] as const;
const FILE_RE = /^[a-z0-9][a-z0-9_-]*\.splat$/i;

/** Maps request path segments (e.g. ['men', 'middlepart_black.splat']) to an S3 key, or null if invalid. */
export function prebakeKeyFromSegments(segments: readonly string[] | undefined): string | null {
  if (!segments || segments.length !== 2) return null;
  const [dir, file] = segments;
  if (!(PREBAKE_GENDER_DIRS as readonly string[]).includes(dir)) return null;
  if (!FILE_RE.test(file)) return null;
  return `${PREBAKE_S3_PREFIX}${dir}/${file}`;
}

/** Prebakes can be regenerated under the same name, so cache for a day, not forever. */
export const PREBAKE_CACHE_MAX_AGE_S = 24 * 60 * 60;
