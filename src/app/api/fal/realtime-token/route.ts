// ============================================================
// POST /api/fal/realtime-token — the only place FAL_KEY exists.
//
// Two doors, one gate:
//
//   chair  { clientId, cutLabel, cutSlug?, prompt }          — the barber's tablet
//   card   { slug, cutLabel, cutSlug?, prompt }              — a client on /b/<slug>
//
// Response: { ok: true, token, takeId, maxSeconds, takesLeftToday }
//           | { ok: false, reason: 'daily_cap' | 'global_budget', ... }
//
// The realtime model bills PER SECOND OF WALL CLOCK, so a leaked token is a
// leaked meter — this route is a spend gate first and an auth gate second. Four
// things have to hold before a token is minted, in increasing cost order:
//
//   1. Signed in                       (src/lib/serverAuth.ts)
//   2. Allowed on this meter           — the chair door requires owning the
//      card; the card door requires a consent stamp from THIS visitor on THAT
//      barber's page. Convex decides both; this route never does.
//   3. Under the request rate limit    (src/lib/durableRateLimit.ts)
//   4. Under the budget                — convex/chair.ts `startTake` /
//      `startCardTake`, which debit the take's full MAX_TAKE_SECONDS ceiling
//      BEFORE we mint. A refusal there means no token ever comes into
//      existence, which is the only guard that survives a hostile browser. The
//      browser refunds the unused remainder on stop; a take that never reports
//      stays fully charged.
//
// Both doors spend the same barber's daily cap on purpose — see the section
// header in convex/chair.ts.
//
// The minted token is scoped (`allowed_apps`) to the one endpoint and outlives
// a full-length take by only a minute — long enough to open a WebRTC session
// and never expire mid-take, far too short to farm.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { StartTakeResult } from '@convex/chair';
import { requireSignedIn } from '@/lib/serverAuth';
import { convexErrorData } from '@/lib/errors';
import { RATE_LIMITS, getClientIp, hashIdentifier, rateLimitResponse } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { LUCY_REALTIME_ALIAS } from '@/lib/lucy/constants';
import { MAX_TAKE_SECONDS } from '@convex/lib/chair';

/**
 * fal's short-lived realtime JWT mint.
 *
 * This is the same call `fal.realtime.connect()` would make for itself if the
 * browser held FAL_KEY (@fal-ai/client's `getTemporaryAuthToken`) — the trailing
 * slash, `allowed_apps`, and `token_expiration` are all load-bearing. The
 * neighbouring `/tokens/realtime` takes a different schema and rejects this one.
 */
const FAL_TOKEN_URL = 'https://rest.fal.ai/tokens/';

/**
 * Token lifetime in seconds. Must exceed MAX_TAKE_SECONDS: the client
 * deliberately leaves auto-refresh off (src/lib/lucy/session.ts — a refresh
 * would claim a second take's budget), so the one token has to outlive the
 * longest possible take.
 */
const TOKEN_DURATION_SECONDS = MAX_TAKE_SECONDS + 60;

export async function POST(req: NextRequest) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('[fal-token] FAL_KEY not configured');
    return NextResponse.json(
      { ok: false, error: 'Live try-on isn’t configured on this deployment.' },
      { status: 503 },
    );
  }

  const { response: authError, session } = await requireSignedIn();
  if (authError) return authError;

  const ip = getClientIp(req);
  const limited = await enforceDurableRateLimits(
    [
      { ...RATE_LIMITS.lucyTokenUser, key: session.userId },
      { ...RATE_LIMITS.lucyTokenIp, key: ip },
    ],
    session,
    { route: 'fal-realtime-token', ipHash: hashIdentifier(ip) },
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request' }, { status: 400 });
  }
  const { clientId, slug, cutLabel, cutSlug, prompt } = (body ?? {}) as Record<string, unknown>;

  const isChair = typeof clientId === 'string' && clientId.length > 0;
  const isCard = typeof slug === 'string' && slug.length > 0;
  if (!isChair && !isCard) {
    return NextResponse.json({ ok: false, error: 'Missing clientId' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing prompt' }, { status: 400 });
  }

  // Claim budget through Convex as the signed-in barber, so `startTake` derives
  // the owning card from ctx.auth rather than trusting anything in this body.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convexToken =
    typeof session.getToken === 'function'
      ? await session.getToken({ template: 'convex' }).catch(() => null)
      : null;
  if (!convexUrl || !convexToken) {
    console.error('[fal-token] Convex auth unavailable — refusing to mint');
    return NextResponse.json(
      { ok: false, error: 'Couldn’t verify your account. Try again.' },
      { status: 503 },
    );
  }

  const shared = {
    cutLabel: typeof cutLabel === 'string' ? cutLabel : 'Custom',
    cutSlug: typeof cutSlug === 'string' ? cutSlug : undefined,
    prompt,
  };

  let claim: StartTakeResult;
  try {
    const convex = new ConvexHttpClient(convexUrl);
    convex.setAuth(convexToken);
    claim = (isChair
      ? await convex.mutation(api.chair.startTake, {
          ...shared,
          clientId: clientId as Id<'chairClients'>,
        })
      : await convex.mutation(api.chair.startCardTake, {
          ...shared,
          slug: slug as string,
        })) as StartTakeResult;
  } catch (err) {
    // Convex threw: not a barber, unknown client or card, no consent on file,
    // or over the mutation rate limit. All of them mean "don't mint". Only a
    // ConvexError's data is fit to show — a plain error's message arrives
    // redacted or wrapped in request-ID prefixes, so it gets generic copy.
    const data = convexErrorData(err);
    console.warn(
      '[fal-token] startTake refused:',
      data?.message ?? (err instanceof Error ? err.message : String(err)),
    );
    if (data?.code === 'rate_limited') {
      return rateLimitResponse('take', data.retryAfterSeconds ?? 60);
    }
    return NextResponse.json(
      { ok: false, error: data?.message || 'Couldn’t start that take.' },
      { status: 403 },
    );
  }

  if (!claim.ok) {
    return NextResponse.json(claim, { status: 429 });
  }

  let token: string;
  try {
    const res = await fetch(FAL_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${falKey}`,
      },
      body: JSON.stringify({
        allowed_apps: [LUCY_REALTIME_ALIAS],
        token_expiration: TOKEN_DURATION_SECONDS,
      }),
    });
    if (!res.ok) {
      console.error('[fal-token] mint failed:', res.status, await res.text().catch(() => ''));
      return NextResponse.json(
        { ok: false, error: 'The live model didn’t answer. Try that take again.' },
        { status: 502 },
      );
    }
    // fal returns the JWT as a bare (quoted) string, not an envelope.
    token = (await res.text()).trim().replace(/^"|"$/g, '');
  } catch (err) {
    console.error('[fal-token] mint threw:', err);
    return NextResponse.json(
      { ok: false, error: 'The live model didn’t answer. Try that take again.' },
      { status: 502 },
    );
  }

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'The live model didn’t answer. Try that take again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    token,
    takeId: claim.takeId,
    maxSeconds: claim.maxSeconds,
    takesLeftToday: claim.takesLeftToday,
  });
}
