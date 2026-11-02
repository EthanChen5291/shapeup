import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { requireSignedIn } from '@/lib/serverAuth';
import { deleteManyFromS3 } from '@/lib/s3';
import { hashIdentifier } from '@/lib/rateLimit';

// Upper bound on deletion rounds (each covers up to 100 rows per table), so a
// runaway loop can't hold the function open.
const MAX_ROUNDS = 50;

export async function POST() {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);
  const user = hashIdentifier(authResult.session.userId);

  try {
    // Files first, then the rows that point at them: if S3 fails we stop with
    // the rows intact, so a retry can still find (and delete) every file.
    const deleted = new Set<string>();
    let finished = false;
    let warning: string | undefined;
    for (let round = 0; round < MAX_ROUNDS && !finished; round++) {
      const batch = await convex.query(api.users.accountDeletionBatch, {});
      await deleteManyFromS3(batch.s3Keys);
      batch.s3Keys.forEach((k) => deleted.add(k));

      if (batch.sessionIds.length + batch.faceliftIds.length + batch.projectIds.length > 0) {
        await convex.mutation(api.users.deleteAccountRows, {
          sessionIds: batch.sessionIds,
          faceliftIds: batch.faceliftIds,
          projectIds: batch.projectIds,
        });
        continue;
      }

      // No data rows left: remove the user row. It also sweeps up any rows
      // created mid-deletion and hands back their keys.
      const final = await convex.mutation(api.users.deleteCurrentUserData, {});
      const stragglers = final.s3Keys.filter((k) => !deleted.has(k));
      await deleteManyFromS3(stragglers);
      stragglers.forEach((k) => deleted.add(k));
      finished = final.done;
      warning = final.warning;
    }
    if (!finished) throw new Error(`account data not cleared after ${MAX_ROUNDS} rounds`);

    const client = await clerkClient();
    await client.users.deleteUser(authResult.session.userId);

    console.warn('[account-delete] completed', { user, s3KeyCount: deleted.size });

    return NextResponse.json({
      ok: true,
      deletedS3Keys: deleted.size,
      warning,
    });
  } catch (err) {
    console.error('[account-delete] failed', {
      user,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Account deletion failed' }, { status: 500 });
  }
}
