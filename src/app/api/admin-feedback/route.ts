import { NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import { adminConvexClient } from '@/lib/serverAuth';

// Star ratings behind /admin/feedback. Two gates: the allowlist in
// adminConvexClient, and requireConvexAdmin again inside feedback.listRecent.
export async function GET() {
  const { response, convex } = await adminConvexClient();
  if (response) return response;

  try {
    const feedback = await convex.query(api.feedback.listRecent, { limit: 200 });
    return NextResponse.json({ feedback });
  } catch (err) {
    console.error('admin-feedback error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
