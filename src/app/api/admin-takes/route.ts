import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { requireAdmin } from '@/lib/serverAuth';

// The take debug feed behind /admin/takes. Same two-gate shape as
// /api/admin-feedback: the allowlist here, and requireConvexAdmin again inside
// chair.debugTakes.
export async function GET() {
  const authResult = await requireAdmin();
  if (authResult.response) return authResult.response;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }
  convex.setAuth(convexToken);

  try {
    const takes = await convex.query(api.chair.debugTakes, { limit: 100 });
    return NextResponse.json({ takes });
  } catch (err) {
    console.error('admin-takes error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
