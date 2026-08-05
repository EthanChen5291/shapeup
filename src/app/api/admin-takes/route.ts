import { NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import { adminConvexClient } from '@/lib/serverAuth';

// The take debug feed behind /admin/takes. Same two-gate shape as
// /api/admin-feedback: the allowlist in adminConvexClient, and
// requireConvexAdmin again inside chair.debugTakes.
export async function GET() {
  const { response, convex } = await adminConvexClient();
  if (response) return response;

  try {
    const takes = await convex.query(api.chair.debugTakes, { limit: 100 });
    return NextResponse.json({ takes });
  } catch (err) {
    console.error('admin-takes error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
