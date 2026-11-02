import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

function pngDataUrl(width = 1, height = 1) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

describe('Stripe checkout route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://shapeup.test');
  });

  test('includes authenticated Clerk metadata so the webhook can grant credits', async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/session' });
    vi.doMock('stripe', () => ({
      default: vi.fn(function Stripe() {
        return {
          checkout: { sessions: { create: createCheckoutSession } },
        };
      }),
    }));
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: null,
        session: { userId: 'user_123' },
      }),
    }));

    const { POST } = await import('./stripe/checkout/route');

    const res = await POST(new Request('https://shapeup.test/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan: 'starter' }),
    }));

    expect(res.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        clerkId: 'user_123',
        plan: 'starter',
        credits: '8',
      }),
    }));
  });
});

describe('admin APIs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
    vi.stubEnv('AWS_S3_BUCKET_NAME', 'shapeup-test');
  });

  test('/api/admin-s3 rejects unauthenticated callers before listing private S3 data', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(function S3Client() {
        return {
          send: vi.fn().mockResolvedValue({
            Contents: [{
              Key: 'pictures/session_123/scan.png',
              LastModified: new Date('2026-01-01T00:00:00Z'),
              Size: 42,
            }],
          }),
        };
      }),
      ListObjectsV2Command: vi.fn(function ListObjectsV2Command(input) {
        return input;
      }),
      GetObjectCommand: vi.fn(function GetObjectCommand(input) {
        return input;
      }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/scan.png'),
    }));

    const { GET } = await import('./admin-s3/route');
    const res = await GET(new Request('https://shapeup.test/api/admin-s3?section=images'));

    expect([401, 403]).toContain(res.status);
  });

  test('/api/admin-sessions rejects unauthenticated callers before returning sessions', async () => {
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          query: vi.fn().mockResolvedValue([{ sessionId: 'session_123' }]),
        };
      }),
    }));

    const { GET } = await import('./admin-sessions/route');
    const res = await GET();

    expect([401, 403]).toContain(res.status);
  });
});

describe('scan and generation APIs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://convex.test');
  });

  test('/api/save-scan rejects unauthenticated callers instead of creating public scan sessions', async () => {
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example/scan.png'),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          mutation: vi.fn().mockResolvedValue('session_doc'),
        };
      }),
    }));

    const { POST } = await import('./save-scan/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/save-scan', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,AAAA' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect([401, 403]).toContain(res.status);
  });

  test('/api/facelift validates the image before deducting a credit', async () => {
    const deductCredit = vi.fn().mockResolvedValue(0);
    vi.stubEnv('FACELIFT_URL', 'https://ml.shapeup.test');
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_123',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn().mockResolvedValue(true),
          mutation: deductCredit,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: 'not-an-image' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(deductCredit.mock.calls.some(([, args]) => JSON.stringify(args) === '{}')).toBe(false);
  });

  test('/api/facelift/warmup wakes the primary GPU worker without consuming a generation', async () => {
    const { api } = await import('@convex/_generated/api');
    // The only mutation the warmup path may make is the durable rate-limit
    // consume — never freeGen.consumeGeneration.
    const mutation = vi.fn().mockResolvedValue({ limited: false, label: null, retryAfterSeconds: 0 });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FACELIFT_URL', 'https://ml.shapeup.test');
    vi.stubEnv('FACELIFT_SHARED_SECRET', 'server-only-secret');
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_123',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return { setAuth: vi.fn(), query: vi.fn(), mutation };
      }),
    }));

    const { POST } = await import('./facelift/warmup/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift/warmup', { method: 'POST' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, warmed: true });
    // Woke the primary worker with the shared secret it gates /warmup on...
    expect(fetchMock).toHaveBeenCalledWith('https://ml.shapeup.test/warmup', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-ShapeUp-Facelift-Secret': 'server-only-secret' }),
    }));
    // ...but never spent the user's credit or free generation.
    expect(mutation.mock.calls.every(([ref]) => ref !== api.freeGen.consumeGeneration)).toBe(true);
  });

  test('/api/facelift forwards the GPU shared secret and rejects malformed PLY before S3 upload', async () => {
    const uploadToS3 = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ply_b64: 'not-a-valid-ply' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FACELIFT_URL', 'https://ml.shapeup.test');
    vi.stubEnv('FACELIFT_SHARED_SECRET', 'server-only-secret');
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_123',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false),
          mutation: vi.fn().mockResolvedValue(undefined),
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3,
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl() }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledWith('https://ml.shapeup.test/process_image', expect.objectContaining({
      headers: expect.objectContaining({ 'X-ShapeUp-Facelift-Secret': 'server-only-secret' }),
    }));
    expect(JSON.stringify(await res.json())).not.toMatch(/PLY/);
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  test('/api/facelift gives up on a stalled GPU worker inside the function limit and hides upstream detail', async () => {
    const uploadToS3 = vi.fn();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FACELIFT_URL', 'https://ml.shapeup.test');
    vi.stubEnv('FACELIFT_SHARED_SECRET', 'server-only-secret');
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_123',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false),
          mutation: vi.fn().mockResolvedValue(undefined),
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3,
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl() }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(503);
    // maxDuration is 300s; the upstream wait must end well before it so the
    // route (not the platform) answers.
    const upstreamTimeouts = timeoutSpy.mock.calls.map(([ms]) => ms).filter(ms => ms > 10_000);
    expect(upstreamTimeouts.length).toBeGreaterThan(0);
    expect(Math.max(...upstreamTimeouts)).toBeLessThanOrEqual(240_000);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/busy/i);
    expect(JSON.stringify(body)).not.toMatch(/ml\.shapeup\.test|timeout|primary/i);
    expect(uploadToS3).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });

  test('/api/proxy-ply rejects arbitrary private-network URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ply', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./proxy-ply/route');
    const res = await GET(new NextRequest('https://shapeup.test/api/proxy-ply?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data'));

    expect([400, 403]).toContain(res.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('/api/gemini-hair-edit rejects arbitrary image URLs before server-side fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@google/generative-ai', () => ({
      HarmCategory: {
        HARM_CATEGORY_HARASSMENT: 'harassment',
        HARM_CATEGORY_HATE_SPEECH: 'hate_speech',
        HARM_CATEGORY_SEXUALLY_EXPLICIT: 'sex',
        HARM_CATEGORY_DANGEROUS_CONTENT: 'danger',
      },
      HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'high' },
      GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
        return {
          getGenerativeModel: vi.fn(() => ({
            generateContent: vi.fn().mockResolvedValue({
              response: {
                candidates: [{
                  finishReason: 'STOP',
                  content: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }] },
                }],
              },
            }),
          })),
        };
      }),
    }));

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: 'http://169.254.169.254/latest/meta-data',
        prompt: 'short crop',
        sessionId: 'session_123',
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect([400, 403]).toContain(res.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('/api/gemini-hair-edit applies its own per-minute and 24-hour limits, per user and per IP', async () => {
    const enforceDurableRateLimits = vi.fn().mockResolvedValue(Response.json({ error: 'Rate limit exceeded' }, { status: 429 }));
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_123' } }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({ enforceDurableRateLimits }));

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: '/api/img?key=scan.png', prompt: 'short crop' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    }));

    expect(res.status).toBe(429);
    const rules = enforceDurableRateLimits.mock.calls[0][0] as Array<{ label: string; key: string; windowMs: number }>;
    expect(rules.map((r) => r.label)).toEqual(['gemini-edit:user', 'gemini-edit:ip', 'gemini-edit-day:user', 'gemini-edit-day:ip']);
    expect(rules.filter((r) => r.windowMs === 24 * 60 * 60_000).map((r) => r.key)).toEqual(['user_123', '1.2.3.4']);
  });

  const mockGeminiReturning = (data: string) => vi.doMock('@google/generative-ai', () => ({
    HarmCategory: { HARM_CATEGORY_HARASSMENT: 'h', HARM_CATEGORY_HATE_SPEECH: 'hs', HARM_CATEGORY_SEXUALLY_EXPLICIT: 's', HARM_CATEGORY_DANGEROUS_CONTENT: 'd' },
    HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'high' },
    GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
      return { getGenerativeModel: vi.fn(() => ({ generateContent: vi.fn().mockResolvedValue({
        response: { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { data, mimeType: 'image/png' } }] } }] },
      }) })) };
    }),
  }));
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  test('/api/gemini-hair-edit saves the edit to S3 and links it to the project when given a projectId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from(tinyPng, 'base64'), { status: 200, headers: { 'content-type': 'image/png' } })));
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://convex.test');
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_123', getToken: vi.fn().mockResolvedValue('jwt') } }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({ enforceDurableRateLimits: vi.fn().mockResolvedValue(null) }));
    const uploadToS3 = vi.fn();
    vi.doMock('@/lib/s3', () => ({ uploadToS3 }));
    const mutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('convex/browser', () => ({ ConvexHttpClient: vi.fn(function ConvexHttpClient() { return { setAuth: vi.fn(), mutation }; }) }));
    mockGeminiReturning(tinyPng);

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: '/api/img?key=scan.png', prompt: 'short fade', projectId: 'pj_1' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as { editImageS3Key: string; newImageUrl: string };
    expect(body.editImageS3Key).toMatch(/^edit-images\/[0-9a-f-]+\.png$/);
    expect(body.newImageUrl).toMatch(/^data:image\/png;base64,/);
    expect(uploadToS3).toHaveBeenCalledWith(body.editImageS3Key, expect.any(Buffer), 'image/png');
    expect(mutation).toHaveBeenCalledWith(expect.anything(), { projectId: 'pj_1', lastEditImageS3Key: body.editImageS3Key });
  });

  test('/api/gemini-hair-edit still returns the edit when saving it fails (the client saves it instead)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from(tinyPng, 'base64'), { status: 200, headers: { 'content-type': 'image/png' } })));
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_123', getToken: vi.fn().mockResolvedValue('jwt') } }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({ enforceDurableRateLimits: vi.fn().mockResolvedValue(null) }));
    vi.doMock('@/lib/s3', () => ({ uploadToS3: vi.fn().mockRejectedValue(new Error('S3 down')) }));
    mockGeminiReturning(tinyPng);

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: '/api/img?key=scan.png', prompt: 'short fade', projectId: 'pj_1' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ ok: true, editImageS3Key: null }));
  });

  test('/api/gemini-hair-edit rejects malformed haircut references before fetching the source', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_123' } }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({ enforceDurableRateLimits: vi.fn().mockResolvedValue(null) }));

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: '/api/img?key=scan.png',
        prompt: 'match this haircut',
        referenceImageDataUrl: 'data:text/html;base64,PHNjcmlwdD4=',
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: expect.stringMatching(/Invalid haircut reference/) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('/api/gemini-hair-edit sends a valid haircut reference as a distinct second image', async () => {
    const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ inlineData: { data: 'EDITED', mimeType: 'image/png' } }] },
        }],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from(validPngBase64, 'base64'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_123' } }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({ enforceDurableRateLimits: vi.fn().mockResolvedValue(null) }));
    vi.doMock('@google/generative-ai', () => ({
      HarmCategory: {
        HARM_CATEGORY_HARASSMENT: 'harassment',
        HARM_CATEGORY_HATE_SPEECH: 'hate_speech',
        HARM_CATEGORY_SEXUALLY_EXPLICIT: 'sex',
        HARM_CATEGORY_DANGEROUS_CONTENT: 'danger',
      },
      HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'high' },
      GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
        return { getGenerativeModel: vi.fn(() => ({ generateContent })) };
      }),
    }));

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: '/api/img?key=scan.png',
        prompt: 'match this haircut',
        referenceImageDataUrl: `data:image/png;base64,${validPngBase64}`,
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(200);
    const parts = generateContent.mock.calls[0][0];
    expect(parts).toHaveLength(5);
    expect(parts[0]).toMatch(/SOURCE PHOTO/);
    expect(parts[1]).toHaveProperty('inlineData');
    expect(parts[2]).toMatch(/HAIRCUT REFERENCE/);
    expect(parts[3]).toHaveProperty('inlineData.mimeType', 'image/jpeg');
    expect(parts[4]).toMatch(/Do NOT copy the reference person's face/);
  });
});

describe('/api/facelift async build mode', () => {
  let capturedAfterCallbacks: Array<() => Promise<void>>;

  beforeEach(() => {
    capturedAfterCallbacks = [];
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('FACELIFT_URL', 'https://ml.shapeup.test');
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://convex.test');
  });

  test('returns 202 { jobId, projectId } and calls startBuild before responding', async () => {
    const convexMutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('next/server', async () => {
      const orig = await vi.importActual<typeof import('next/server')>('next/server');
      return { ...orig, after: (fn: () => Promise<void>) => capturedAfterCallbacks.push(fn) };
    });
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_async',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn()
            .mockResolvedValueOnce(false)  // isAllowlisted
            .mockResolvedValueOnce(true)   // hasBiometricConsent
            .mockResolvedValueOnce(false), // isOverBudget
          mutation: convexMutation,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl(), projectId: 'pj_async_test', async: true }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(202);
    const body = await res.json() as { jobId: string; projectId: string };
    expect(typeof body.jobId).toBe('string');
    expect(body.projectId).toBe('pj_async_test');

    // startBuild must have been called with the generated jobId and projectId
    // before the 202 response was returned.
    expect(convexMutation.mock.calls.some(([, args]) =>
      args?.projectId === 'pj_async_test' && typeof args?.jobId === 'string' && !args?.splatS3Key
    )).toBe(true);
  });

  test('after callback calls completeBuild with splatS3Key on upstream success', async () => {
    const convexMutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('next/server', async () => {
      const orig = await vi.importActual<typeof import('next/server')>('next/server');
      return { ...orig, after: (fn: () => Promise<void>) => capturedAfterCallbacks.push(fn) };
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      splat_s3_key: 'facelifts/upstream_job/output.splat',
      elapsed_s: 2.0,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_async2',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false),
          mutation: convexMutation,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl(), projectId: 'pj_cb_test', async: true }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(202);
    const { jobId } = await res.json() as { jobId: string };

    // Invoke the captured after() callback to run the build work.
    const [afterFn] = capturedAfterCallbacks;
    expect(afterFn).toBeDefined();
    await afterFn();

    // completeBuild must have been called with the upstream's splatS3Key.
    expect(convexMutation.mock.calls.some(([, args]) =>
      args?.splatS3Key === 'facelifts/upstream_job/output.splat' &&
      args?.jobId === jobId &&
      args?.projectId === 'pj_cb_test'
    )).toBe(true);
  });

  test('one job id end to end: the worker gets the build jobId and the facelift row records it', async () => {
    const convexMutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('next/server', async () => {
      const orig = await vi.importActual<typeof import('next/server')>('next/server');
      return { ...orig, after: (fn: () => Promise<void>) => capturedAfterCallbacks.push(fn) };
    });
    // A current worker echoes job_id and files outputs under it.
    const fetchMock = vi.fn(async (_url: string, init: { body: FormData }) => {
      const id = String(init.body.get('job_id'));
      return new Response(JSON.stringify({
        job_id: id,
        splat_s3_key: `facelifts/${id}/output.splat`,
        meta_s3_key: `facelifts/${id}/meta.json`,
        elapsed_s: 2.0,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({ userId: 'user_onejob', getToken: vi.fn().mockResolvedValue('convex.jwt') }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
          mutation: convexMutation,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({ uploadToS3: vi.fn(), getSignedDownloadUrl: vi.fn() }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl(), projectId: 'pj_onejob', async: true }),
      headers: { 'content-type': 'application/json' },
    }));
    const { jobId } = await res.json() as { jobId: string };
    await capturedAfterCallbacks[0]();

    expect(fetchMock.mock.calls[0][1].body.get('job_id')).toBe(jobId);
    const recorded = convexMutation.mock.calls.map(([, args]) => args).find((a) => a?.splatS3Key && !a?.projectId);
    expect(recorded).toMatchObject({ jobId, splatS3Key: `facelifts/${jobId}/output.splat`, metaS3Key: `facelifts/${jobId}/meta.json` });
    const completed = convexMutation.mock.calls.map(([, args]) => args).find((a) => a?.projectId === 'pj_onejob' && a?.splatS3Key);
    expect(completed).toMatchObject({ jobId, splatS3Key: `facelifts/${jobId}/output.splat` });
  });

  test("mode 'edit' drives the edit-build lifecycle (not the first build's) and records the prompt", async () => {
    const convexMutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('next/server', async () => {
      const orig = await vi.importActual<typeof import('next/server')>('next/server');
      return { ...orig, after: (fn: () => Promise<void>) => capturedAfterCallbacks.push(fn) };
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: FormData }) => {
      const id = String(init.body.get('job_id'));
      return new Response(JSON.stringify({ job_id: id, splat_s3_key: `facelifts/${id}/output.splat`, meta_s3_key: `facelifts/${id}/meta.json` }), { status: 200 });
    }));
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({ userId: 'user_edit', getToken: vi.fn().mockResolvedValue('convex.jwt') }),
    }));
    const { getFunctionName } = await import('convex/server');
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
          mutation: convexMutation,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({ uploadToS3: vi.fn(), getSignedDownloadUrl: vi.fn() }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl(), projectId: 'pj_edit', async: true, mode: 'edit', prompt: 'short fade' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(res.status).toBe(202);
    const { jobId } = await res.json() as { jobId: string };
    await capturedAfterCallbacks[0]();

    const called = (name: string) => convexMutation.mock.calls.filter(([fn]) => getFunctionName(fn) === name).map(([, a]) => a);
    expect(called('projects:startEditBuild')).toEqual([{ projectId: 'pj_edit', jobId }]);
    expect(called('projects:completeEditBuild')).toEqual([{
      projectId: 'pj_edit', jobId, splatS3Key: `facelifts/${jobId}/output.splat`, metaS3Key: `facelifts/${jobId}/meta.json`, prompt: 'short fade',
    }]);
    expect(called('projects:startBuild')).toHaveLength(0);
    expect(called('projects:completeBuild')).toHaveLength(0);
  });

  test('after callback calls failBuild with user-safe message when all upstreams fail', async () => {
    const convexMutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('next/server', async () => {
      const orig = await vi.importActual<typeof import('next/server')>('next/server');
      return { ...orig, after: (fn: () => Promise<void>) => capturedAfterCallbacks.push(fn) };
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_async3',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false),
          mutation: convexMutation,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl(), projectId: 'pj_fail_test', async: true }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(202);
    const { jobId } = await res.json() as { jobId: string };

    const [afterFn] = capturedAfterCallbacks;
    await afterFn();

    // failBuild must have been called with the user-safe error message.
    expect(convexMutation.mock.calls.some(([, args]) =>
      args?.error === 'Our 3D builder is busy right now. Please try again in a few minutes.' &&
      args?.jobId === jobId &&
      args?.projectId === 'pj_fail_test'
    )).toBe(true);

    // The user-safe message must not contain any upstream detail.
    const failArgs = convexMutation.mock.calls
      .map(([, args]) => args)
      .find((args) => args?.error && args?.jobId === jobId);
    expect(failArgs?.error).not.toMatch(/connection refused/i);
  });

  test('getToken is called again inside the after() callback before completion mutations', async () => {
    const getToken = vi.fn().mockResolvedValue('convex.jwt');
    const convexMutation = vi.fn().mockResolvedValue(undefined);
    vi.doMock('next/server', async () => {
      const orig = await vi.importActual<typeof import('next/server')>('next/server');
      return { ...orig, after: (fn: () => Promise<void>) => capturedAfterCallbacks.push(fn) };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      splat_s3_key: 'facelifts/refresh_job/output.splat',
    }), { status: 200 })));
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({ userId: 'user_refresh', getToken }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          query: vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false),
          mutation: convexMutation,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl(), projectId: 'pj_refresh_test', async: true }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(202);
    const getTokenCallsBeforeAfter = getToken.mock.calls.length;

    const [afterFn] = capturedAfterCallbacks;
    await afterFn();

    // getToken must have been called at least once more inside the after() callback.
    expect(getToken.mock.calls.length).toBeGreaterThan(getTokenCallsBeforeAfter);
  });
});

describe('S3 upload and image-model routes', () => {
  const unauthed = () => ({
    response: Response.json({ error: 'Unauthenticated' }, { status: 401 }),
    session: null,
  });
  const signedIn = () => ({ response: null, session: { userId: 'user_123' } });
  const forbidden = () => ({
    response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    session: null,
  });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  let uploadToS3: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    uploadToS3 = vi.fn();
    vi.doMock('@/lib/s3', () => ({
      uploadToS3,
      getSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example/thumb.jpg'),
    }));
  });

  test.each(['upload-edit-image', 'upload-thumbnail'])('/api/%s rejects unauthenticated callers before writing to S3', async (route) => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(unauthed()) }));

    const { POST } = await import(`./${route}/route`);
    const res = await POST(new NextRequest(`https://shapeup.test/api/${route}`, {
      method: 'POST',
      body: jpeg,
      headers: { 'content-type': 'image/jpeg' },
    }));

    expect(res.status).toBe(401);
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  test.each(['upload-edit-image', 'upload-thumbnail'])('/api/%s rejects non-image bodies even with an image Content-Type', async (route) => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(signedIn()) }));

    const { POST } = await import(`./${route}/route`);
    const res = await POST(new NextRequest(`https://shapeup.test/api/${route}`, {
      method: 'POST',
      body: '<html><script>alert(1)</script></html>',
      headers: { 'content-type': 'image/jpeg' },
    }));

    expect(res.status).toBe(400);
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  test('/api/upload-edit-image stores signed-in uploads under the sniffed MIME type', async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(signedIn()) }));

    const { POST } = await import('./upload-edit-image/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/upload-edit-image', {
      method: 'POST',
      body: Buffer.from(pngDataUrl(4, 4).split(',')[1], 'base64'),
      headers: { 'content-type': 'image/jpeg' },
    }));

    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key).toMatch(/^edit-images\/[0-9a-f-]+\.png$/);
    expect(uploadToS3).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/png');
  });

  const sessionWithToken = () => ({ response: null, session: { userId: 'user_123', getToken: vi.fn().mockResolvedValue('convex-jwt') } });
  const mockOwnsSplat = (owns: boolean) => {
    const query = vi.fn().mockResolvedValue(owns);
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() { return { setAuth: vi.fn(), query }; }),
    }));
    return query;
  };

  test('/api/proxy-ply refuses facelift keys to signed-out callers', async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(unauthed()) }));
    const query = mockOwnsSplat(true);
    const { GET } = await import('./proxy-ply/route');
    const res = await GET(new NextRequest('https://shapeup.test/api/proxy-ply?key=facelifts%2Fjob1%2Foutput.splat'));

    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  test("/api/proxy-ply refuses a facelift key the caller doesn't own", async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(sessionWithToken()) }));
    const query = mockOwnsSplat(false);
    const { GET } = await import('./proxy-ply/route');
    const res = await GET(new NextRequest('https://shapeup.test/api/proxy-ply?key=facelifts%2Fjob1%2Foutput.splat'));

    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
    expect(query).toHaveBeenCalledWith(expect.anything(), { key: 'facelifts/job1/output.splat' });
  });

  test('/api/proxy-ply caches the redirect for immutable facelift keys (repeat opens hit the HTTP cache)', async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(sessionWithToken()) }));
    mockOwnsSplat(true);
    const { GET } = await import('./proxy-ply/route');
    const { KEY_REDIRECT_MAX_AGE_S, SIGNED_URL_TTL_S } = await import('@/lib/proxyPlyCache');
    const res = await GET(new NextRequest('https://shapeup.test/api/proxy-ply?key=facelifts%2Fjob1%2Foutput.splat'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://signed.example/thumb.jpg');
    expect(res.headers.get('cache-control')).toBe(`private, max-age=${KEY_REDIRECT_MAX_AGE_S}, immutable`);
    // Must stay under the signed URL's 7-day lifetime.
    expect(KEY_REDIRECT_MAX_AGE_S).toBeLessThan(SIGNED_URL_TTL_S);
  });

  test('/api/proxy-ply does not cache redirects for arbitrary remote URLs', async () => {
    const { GET } = await import('./proxy-ply/route');
    const res = await GET(new NextRequest(`https://shapeup.test/api/proxy-ply?url=${encodeURIComponent('https://s3.example.com/bucket/some.splat')}`));

    expect(res.status).toBe(307);
    expect(res.headers.get('cache-control')).toBeNull();
  });

  test('/api/upload-thumbnail re-encodes a signed-in PNG as a smaller WebP, keeping transparency', async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(signedIn()) }));
    const { default: sharp } = await import('sharp');
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 120, b: 80, alpha: 0.5 } } }).png().toBuffer();

    const { POST } = await import('./upload-thumbnail/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/upload-thumbnail', {
      method: 'POST',
      body: png,
      headers: { 'content-type': 'image/png' },
    }));

    expect(res.status).toBe(200);
    expect(uploadToS3).toHaveBeenCalledWith(expect.stringMatching(/^thumbnails\/.+\.webp$/), expect.any(Buffer), 'image/webp');
    const stored = vi.mocked(uploadToS3).mock.calls.at(-1)![1] as Buffer;
    expect((await sharp(stored).metadata()).hasAlpha).toBe(true);
  });

  test('/api/upload-thumbnail stores an undecodable-but-sniffed PNG as sent', async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(signedIn()) }));

    const png = Buffer.from(pngDataUrl(16, 16).split(',')[1], 'base64'); // header only
    const { POST } = await import('./upload-thumbnail/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/upload-thumbnail', {
      method: 'POST',
      body: png,
      headers: { 'content-type': 'image/png' },
    }));

    expect(res.status).toBe(200);
    expect(uploadToS3).toHaveBeenCalledWith(expect.stringMatching(/^thumbnails\/.+\.png$/), expect.any(Buffer), 'image/png');
  });

  test('/api/upload-thumbnail stores a signed-in JPEG', async () => {
    vi.doMock('@/lib/serverAuth', () => ({ requireSignedIn: vi.fn().mockResolvedValue(signedIn()) }));

    const { POST } = await import('./upload-thumbnail/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/upload-thumbnail', {
      method: 'POST',
      body: jpeg,
      headers: { 'content-type': 'image/jpeg' },
    }));

    expect(res.status).toBe(200);
    expect(uploadToS3).toHaveBeenCalledWith(expect.stringMatching(/^thumbnails\/.+\.jpg$/), expect.any(Buffer), 'image/jpeg');
  });

  test('/api/baldify rejects non-admins before spending on the image model', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('@/lib/serverAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue(forbidden()) }));

    const { POST } = await import('./baldify/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/baldify', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: pngDataUrl() }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('/api/baldify never fetches caller-supplied URLs', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('@/lib/serverAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue(signedIn()) }));

    const { POST } = await import('./baldify/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/baldify', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'http://169.254.169.254/latest/meta-data/' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LLM API hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: null,
        session: { userId: 'user_123' },
      }),
    }));
  });

  test('/api/edit rejects oversized prompts before calling the image model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('./edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/edit', {
      method: 'POST',
      body: JSON.stringify({
        instruction: 'x'.repeat(501),
        currentProfile: { currentStyle: { params: {} } },
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('/api/edit rejects malformed image-model outputs instead of returning raw model data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ preset: 'buzz', params: { topLength: 99 } }) } }],
    }), { status: 200 })));

    const { POST } = await import('./edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/edit', {
      method: 'POST',
      body: JSON.stringify({
        instruction: 'shorter sides',
        currentProfile: { currentStyle: { params: { topLength: 1, sideLength: 1, backLength: 1, messiness: 0, taper: 0 } } },
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(422);
  });

  test('/api/summary rejects oversized payloads before calling the image model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('./summary/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/summary', {
      method: 'POST',
      body: JSON.stringify({
        profile: { currentStyle: { hairType: 'straight', preset: 'classic' }, filler: 'x'.repeat(13000) },
        params: { topLength: 1, sideLength: 1, backLength: 1, messiness: 0, taper: 0 },
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
