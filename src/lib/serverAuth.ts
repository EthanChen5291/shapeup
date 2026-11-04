import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdminUserId } from './adminAllowlist';

export type ClerkSession = Awaited<ReturnType<typeof auth>>;

export async function getClerkSession(): Promise<ClerkSession | null> {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export async function requireSignedIn() {
  const session = await getClerkSession();
  if (!session?.userId) {
    return {
      response: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }),
      session: null,
    };
  }
  return { response: null, session };
}

/**
 * Mint the Convex JWT for a signed-in session. Clerk's Backend API fails
 * transiently now and then (a ClerkAPIResponseError with no status), which used
 * to surface as a 500 from any route that minted inline. Retry once, then
 * answer 503 so the client can try again instead of treating it as broken.
 */
export async function getConvexToken(
  session: NonNullable<ClerkSession>,
  { retries = 1, delayMs = 300 }: { retries?: number; delayMs?: number } = {},
): Promise<{ token: string; response: null } | { token: null; response: NextResponse }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = await session.getToken({ template: 'convex' });
      if (!token) return { token: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      return { token, response: null };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error('[auth] Convex token mint failed:', lastError instanceof Error ? lastError.message : String(lastError));
  return {
    token: null,
    response: NextResponse.json({ error: 'Sign-in service is temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '2' } }),
  };
}

export async function requireAdmin() {
  const result = await requireSignedIn();
  if (result.response) return result;

  // Fail closed: if ADMIN_CLERK_IDS is empty/unset, nobody is an admin.
  if (!isAdminUserId(result.session.userId)) {
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      session: null,
    };
  }

  return result;
}
