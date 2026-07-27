// ============================================================
// One rule for showing a caught error to a person.
//
// Only a ConvexError's data is ours to display: it's the one channel Convex
// leaves intact in production. A plain Error's message arrives either redacted
// ("Server Error") or wrapped in request-ID prefixes ("[CONVEX M(chair:…)]
// [Request ID: …] …") — neither is something to put in front of a client in a
// barbershop, so everything that isn't a ConvexError gets the caller's
// fallback copy instead.
// ============================================================

import { ConvexError } from 'convex/values';

/** The shape server code throws for typed errors — see convex/freeGen.ts. */
export interface ConvexErrorData {
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
}

/** The ConvexError payload, whichever of the two shapes it was thrown with. */
export function convexErrorData(err: unknown): ConvexErrorData | null {
  if (!(err instanceof ConvexError)) return null;
  const data: unknown = err.data;
  if (typeof data === 'string') return { message: data };
  if (data && typeof data === 'object') return data as ConvexErrorData;
  return null;
}

/**
 * A message safe to render, in the server's source language (EN) — run it
 * through t() where it's displayed.
 */
export function presentableError(err: unknown, fallback: string): string {
  const message = convexErrorData(err)?.message;
  return message && message.trim() ? message : fallback;
}
