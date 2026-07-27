// ============================================================
// Composing a haircut instruction for the realtime video model.
//
// This is the "tuned toward barbers" half of chair mode. The model is a general
// video editor — ask it for "a fade" and it will happily also restyle the
// beard, warm the lighting, and swap the cape. In a chair that's not a quirky
// output, it's a client who no longer trusts the mirror.
//
// So every instruction is built from three parts, in this order:
//
//   1. SCOPE   — what may change and, explicitly, what may not. The identity
//                lock is first because it's the rule the model is most likely
//                to drop under a long prompt. Facial hair enters scope only
//                when the request actually mentions it — the model can't be
//                trusted with a conditional ("only when asked"), because it
//                follows the content words, not the logic around them: name
//                "beard" in the changeable clause and every take grows one.
//   2. CUT     — the catalog's own `desc` (src/data/hairstyles.ts), which is
//                already written in barbering language: fade heights, weight
//                lines, where the length sits. Reusing it means the live take
//                and the still preview bubbles describe the same haircut.
//   3. TWEAK   — the barber's free text ("tighter on the sides", "leave the
//                fringe"), last so it overrides the catalog rather than
//                competing with it.
//
// The barber's text is UNTRUSTED INPUT INSIDE OUR PROMPT. It's capped, stripped
// of line breaks, and delimited so an injected "ignore the above" can't reach
// past its fence.
//
// Pure and browser-free so the whole thing is unit-testable.
// ============================================================

import type { Hairstyle } from '@/data/hairstyles';
import { MAX_PROMPT_LENGTH } from '@convex/lib/chair';

// Each part is bounded on its own, so the composed instruction is bounded by
// construction rather than by a blunt slice at the end. A final slice would cut
// the TAIL — and the tail is the barber's own adjustment, the one part of the
// prompt that came from a person looking at the client.
/** How much barber free-text survives into the instruction. */
export const MAX_TWEAK_LENGTH = 220;
const MAX_CUT_LABEL_LENGTH = 80;
const MAX_CUT_DESC_LENGTH = 260;

/**
 * Does the typed request explicitly ask for facial-hair work? Only then may
 * the words "facial hair" appear in the prompt AT ALL. The model treats every
 * noun as an attractor, conditionals be damned: "beard" in the changeable
 * clause grows one, and even "keep the beard exactly as it is" grows one on a
 * clean-shaven face, because the word asserts a beard exists. The only prompt
 * that reliably leaves facial hair alone is one that never mentions it.
 */
const FACIAL_HAIR_REQUEST = /beard|m[ou]stache|moustache|stubble|goatee|sideburn|facial hair/i;

/**
 * The non-negotiable part. Stated as what to preserve rather than what to
 * avoid: the model follows "keep X identical" far more reliably than "don't
 * change X", and in a live mirror a drifting face is the one failure a client
 * notices instantly. Two variants — see FACIAL_HAIR_REQUEST for why the
 * default one is silent about facial hair rather than protective of it.
 */
// No "haircut", no "barbershop" anywhere in the boilerplate: on a tweak-only
// ask ("blonde") those would be the strongest style nouns in the prompt, and
// the model's idea of a barbershop result is a fresh fade nobody asked for.
const IDENTITY_LOCK_SHARED =
  'Nothing else may change. Keep the person identical: same face, skin tone, ' +
  'eyebrows, ears, neck, glasses, clothing, cape and background. Keep the ' +
  'current hair colour unless the request names a new one. Keep the lighting, ' +
  'colour and camera framing exactly as they are. Photorealistic result, no ' +
  'stylisation, no hats or head coverings.';

const IDENTITY_LOCK = 'Change ONLY the hair on the head. ' + IDENTITY_LOCK_SHARED;

const IDENTITY_LOCK_WITH_FACIAL_HAIR =
  'Change ONLY the hair: the hair on the head, and the facial hair the ' +
  'request names. ' +
  IDENTITY_LOCK_SHARED;

/**
 * How to read a terse request. Without this, a bare attribute like a colour
 * word is an open invitation — the model may restyle the whole frame to match
 * the vibe of the word. Deliberately names no example colour: any colour
 * written here reads as an instruction, and only rides along with a tweak,
 * because a catalog cut on its own has no terse words to constrain.
 */
const LITERAL_EDIT_RULE =
  'Apply the smallest hair edit that satisfies the request: a colour word ' +
  'means recolour the existing hair and keep the current cut, length and ' +
  'everything else identical; anything the request does not name stays ' +
  'exactly as it is.';

/**
 * Holds the cut steady while the client turns. The take is a rotation — the
 * whole point is harvesting reference angles from it — so the model has to be
 * told the haircut is a property of the head, not of the current pose.
 */
const ROTATION_LOCK =
  'The head will rotate through profile and back views: keep the hair exactly ' +
  'the same from every angle, including the neckline and crown when the back ' +
  'of the head faces the camera.';

/** Strip anything that could break out of the tweak's fence. */
function sanitizeTweak(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    // Backticks would close the delimiter below.
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TWEAK_LENGTH);
}

export interface BarberPromptInput {
  /** The catalog cut, when the barber picked one off the menu. */
  cut?: Pick<Hairstyle, 'label' | 'desc'> | null;
  /** The free text — a tweak on top of the cut, or the whole ask. */
  tweak?: string;
  /**
   * Who typed the tweak. The chair's tablet is the barber; the live mirror on a
   * public card is the client themselves. The prompt says which, because a
   * stored take has to be readable a week later by someone deciding whether the
   * words in it were a professional's or the person in the chair's — and
   * because "the barber's adjustment" is simply false on the card.
   */
  voice?: 'barber' | 'client';
}

/**
 * Build the instruction sent to the realtime model.
 *
 * At least one of `cut` / `tweak` must carry something; with neither, this
 * returns null rather than sending the model an identity lock and no
 * instruction (which produces a passthrough take that still costs money).
 */
export function buildBarberPrompt({
  cut,
  tweak = '',
  voice = 'barber',
}: BarberPromptInput): string | null {
  const cleanTweak = sanitizeTweak(tweak);
  const cutLabel = cut?.label?.trim().slice(0, MAX_CUT_LABEL_LENGTH);
  if (!cutLabel && !cleanTweak) return null;

  const desc = cut?.desc?.trim().slice(0, MAX_CUT_DESC_LENGTH);

  // Only the TYPED words can put facial hair in scope. The catalog is head
  // hair by definition, so a cut pick alone must never open the beard up.
  const asksForFacialHair = FACIAL_HAIR_REQUEST.test(cleanTweak);

  const parts: string[] = [asksForFacialHair ? IDENTITY_LOCK_WITH_FACIAL_HAIR : IDENTITY_LOCK];
  if (cleanTweak) parts.push(LITERAL_EDIT_RULE);

  if (cutLabel) {
    parts.push(
      desc
        ? `Give this person a ${cutLabel}. ${desc}`
        : `Give this person a ${cutLabel}.`,
    );
  }

  if (cleanTweak) {
    const who = voice === 'client' ? "The client's request" : "The barber's adjustment";
    parts.push(
      cutLabel
        ? `${who}, which takes priority over the description above: \`${cleanTweak}\``
        : `${who}: \`${cleanTweak}\``,
    );
  }

  parts.push(ROTATION_LOCK);

  // Every part above is already bounded, so this can only bite on a pathological
  // catalog entry. It stays as a belt-and-braces guarantee that the prompt we
  // SEND is byte-identical to the one convex/chair.ts PERSISTS — otherwise a
  // take couldn't be reproduced from its own row.
  return parts.join(' ').slice(0, MAX_PROMPT_LENGTH);
}

/**
 * The short human label for a take — what shows on the review screen and in the
 * dashboard. The full instruction is machine copy; nobody wants to read the
 * identity lock to find out which cut this was.
 */
export function takeLabel({ cut, tweak = '' }: BarberPromptInput): string {
  const cutLabel = cut?.label?.trim();
  const cleanTweak = sanitizeTweak(tweak);
  if (cutLabel && cleanTweak) return `${cutLabel} — ${cleanTweak}`;
  if (cutLabel) return cutLabel;
  return cleanTweak || 'Custom';
}
