import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
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

/**
 * An admin-authenticated Convex client, or the refusal to return instead.
 *
 * Every /api/admin-* route needs the same six lines — check admin, mint a
 * Convex token, attach it — and they had drifted into three near-identical
 * copies. Note the Convex call is authenticated as the caller, not with a
 * service key: the admin gate here is the first of two, and the Convex function
 * still runs its own requireConvexAdmin.
 */
export async function adminConvexClient(): Promise<
  { response: NextResponse; convex: null } | { response: null; convex: ConvexHttpClient }
> {
  const authResult = await requireAdmin();
  if (authResult.response) return { response: authResult.response, convex: null };

  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return {
      response: NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 }),
      convex: null,
    };
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);
  return { response: null, convex };
}
