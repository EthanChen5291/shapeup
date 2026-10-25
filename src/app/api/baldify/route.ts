import { NextRequest, NextResponse } from 'next/server';
import { parseImageDataUrl } from '@/lib/imageDataUrl';
import { requireAdmin } from '@/lib/serverAuth';

const PROMPT = `Remove all scalp hair from this person so they appear completely bald. Make the head slightly smaller and more compact than in the original — reduce the overall head size by roughly 8–12%, as if the hair volume was the only thing adding to it. Shrink the skull dome so it sits lower and tighter.

Render the scalp as smooth, natural skin — matching the exact skin tone, texture, and lighting of the face. Preserve the natural skull contour but with a smaller, tighter profile.

Do NOT change anything else. Keep identical:
- facial features, expression, and proportions
- skin tone and texture on the face
- eyebrows and any facial hair (beard, stubble, mustache)
- ears, neck, shoulders
- pose, camera angle, framing
- lighting direction, shadows, and color grading
- background

Output must be photorealistic. No stylization, no hats, no head coverings, no added hair. Match the original photo's resolution and quality.`;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Admin-only: called from /admin/alignment and /admin/subtraction, and every
// call spends image-model money.
export async function POST(req: NextRequest) {
  const authResult = await requireAdmin();
  if (authResult.response) return authResult.response;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 503 });
  }

  let body: { imageDataUrl?: unknown; currentProfile?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const currentProfile = body.currentProfile ?? null;

  // Data URLs only — the server never fetches caller-supplied URLs (SSRF).
  const parsed = parseImageDataUrl(body.imageDataUrl, { maxBytes: MAX_IMAGE_BYTES });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const mimeType = parsed.mimeType;
  const base64 = parsed.buffer.toString('base64');

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64 } },
              {
                text: currentProfile == null
                  ? PROMPT
                  : `${PROMPT}\n\nCURRENT_PROFILE: ${JSON.stringify(currentProfile, null, 2)}`,
              },
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    }
  );

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    console.error('[/api/baldify] image model error', upstream.status, text);
    return NextResponse.json({ error: `image model error: ${text}` }, { status: 502 });
  }

  const data = await upstream.json();

  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData) {
      const { mimeType: outMime, data: outData } = part.inlineData;
      return NextResponse.json({ baldifiedDataUrl: `data:${outMime};base64,${outData}` });
    }
  }

  return NextResponse.json({ error: 'image model returned no image' }, { status: 500 });
}
