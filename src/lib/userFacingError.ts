// Maps a failed API response to text that's safe to show a user.
//
// 4xx bodies carry messages our routes write *for* users (bad photo, content
// filter, rate limit, verify-your-email). 5xx bodies, Vercel's own timeout
// page, and network errors carry internals (upstream URLs, stack-ish text,
// HTML) — those always collapse to the caller's generic fallback. Log the raw
// detail to the console before calling this; never render it.

export const BUILD_BUSY_ERROR = 'Our 3D builder is busy right now. Please try again in a few minutes.';
export const EDIT_FAILED_ERROR = "We couldn't create that look. Please try again.";

export function userFacingError(
  status: number | null,
  serverMessage: unknown,
  fallback: string,
): string {
  const isClientError = status !== null && status >= 400 && status < 500 && status !== 401;
  if (isClientError && typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage;
  }
  return fallback;
}
