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
//                competing with it. A tweak that names a whole NEW haircut
//                ("buzz") doesn't override the catalog desc — it replaces it;
//                see resolveCut.
//
// The barber's text is UNTRUSTED INPUT INSIDE OUR PROMPT. It's capped, stripped
// of line breaks, and delimited so an injected "ignore the above" can't reach
// past its fence.
//
// Pure and browser-free so the whole thing is unit-testable.
// ============================================================

import { HAIRSTYLES, type Hairstyle } from '@/data/hairstyles';
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
 * How to read a terse ATTRIBUTE request. Without this, a bare attribute like a
 * colour word is an open invitation — the model may restyle the whole frame to
 * match the vibe of the word. Deliberately names no example colour: any colour
 * written here reads as an instruction, and only rides along with a tweak,
 * because a catalog cut on its own has no terse words to constrain. A tweak
 * that names a STYLE gets RESTYLE_EDIT_RULE instead — pointed at "mullet",
 * this rule's "keep the current cut" does the opposite of its job.
 */
const LITERAL_EDIT_RULE =
  'Apply the smallest hair edit that satisfies the request: a colour word ' +
  'means recolour the existing hair and keep the current cut, length and ' +
  'everything else identical; anything the request does not name stays ' +
  'exactly as it is.';

/**
 * Does the typed request name a hairstyle rather than an attribute? A named
 * style needs the opposite reading from a colour word — see RESTYLE_EDIT_RULE.
 * Like the facial-hair and length gates, this rides on the content words the
 * request actually typed, never on a conditional inside the prompt; and like
 * the colour rule, the rule text itself names no example style, because any
 * style written there would attract every take toward it. Gated on the TWEAK
 * only: a catalog cut already commands its style via its own desc.
 */
// Two groups because they gate different behaviour. A SILHOUETTE is a whole
// haircut and REPLACES a picked catalog cut (resolveCut below); a MODIFIER
// (structure or texture) rides on top of it. Both flip the reading from
// smallest-edit to commitment. Kept as sources, one per style, so the same
// pattern — inflections and all — can test the typed tweak AND a catalog
// label when resolving.
const SILHOUETTE_SOURCES: readonly string[] = [
  'mullet', 'mohawk', 'fauxhawk', 'pompadour', 'quiff', 'undercut',
  'bowl\\s*cut', 'buzz(?:ed|\\s*cut)?', 'crew\\s*cut', 'flat\\s*top',
  'caesar', 'edgar', 'crop(?:ped)?', 'shag(?:gy)?', 'pixie', 'bob', 'lob',
  'wolf\\s*cut', 'two[\\s-]*block', 'blowout', 'comb[\\s-]*over',
  'slick(?:ed)?[\\s-]*back', 'bro\\s*flow', 'e-?boy',
  // worn styles and all-off asks — nothing of the current cut survives them.
  // "bald fade" is the exception: that's a fade depth, not an all-off ask.
  'ponytail', 'pigtails?', 'bun', 'top\\s*knot', 'updo', 'chignon',
  'bald(?!\\s*(?:fade|taper))',
];

const MODIFIER_SOURCES: readonly string[] = [
  // structure the request can rebuild
  'fade', 'taper(?:ed)?', 'layer(?:s|ed)?', 'fringe', 'bangs',
  'part(?:ing|ed)?', 'curtains?', 'line[\\s-]*up', 'spik(?:y|es?)',
  // texture-defining styles
  'perm(?:ed)?', 'afro', 'braid(?:s|ed)?', 'cornrows?',
  'dread(?:lock)?s?', 'locs', 'twist(?:s|\\s*out)?', 'waves?', 'wavy',
  'curl(?:s|y|ed)?', 'coil(?:s|y)?', 'straight(?:en(?:ed)?)?',
  'bald\\s*(?:fade|taper)', 'shaved?',
];

const STYLE_REQUEST = new RegExp(
  '\\b(?:' + [...SILHOUETTE_SOURCES, ...MODIFIER_SOURCES].join('|') + ')\\b',
  'i',
);

/**
 * A silhouette word aimed at part of the head ("buzz the sides") is a tweak on
 * the current cut, not a new haircut — replacing the whole cut would take the
 * top off a client who asked for tighter sides. 'back' and 'top' are absent
 * deliberately: "slicked back" and "top knot" would trip them.
 */
const AREA_SCOPED = /\bsides?\b|\btemples?\b|\bnape\b|\bfront\b/i;

/**
 * The whole-haircut style the tweak names, if any, as a pattern that can also
 * test catalog labels. First source to hit wins — the sources are one style
 * each, so overlap is only ever an inflection, not a real ambiguity.
 */
function silhouetteNamed(tweak: string): RegExp | null {
  if (!tweak || AREA_SCOPED.test(tweak)) return null;
  for (const source of SILHOUETTE_SOURCES) {
    const style = new RegExp(`\\b(?:${source})\\b`, 'i');
    if (style.test(tweak)) return style;
  }
  return null;
}

/**
 * How to read a named style. The smallest-edit rule above is written for
 * attribute words; pointed at a style name it suffocates the change — the
 * model keeps the current cut and hands back a token gesture at the new
 * style. So when the typed words name a style, commitment replaces caution:
 * the named style is the destination, however far that is from the current
 * hair. Colour and the person's natural texture still hold unless the
 * request itself moves them — a client with coils asking for a middle part
 * gets a middle part in coils, not silked hair nobody asked for.
 */
const RESTYLE_EDIT_RULE =
  'The request names a hairstyle: make the hair that style, completely. ' +
  'Change the cut, length, parting, volume and overall silhouette as much as ' +
  'the named style requires, even when that is a dramatic change from the ' +
  'current hair — the style must be clearly recognisable at a glance, not ' +
  'hinted at. Render the style in the current hair colour and the ' +
  "person's natural hair texture unless the request names a different " +
  'colour or texture.';

/**
 * Does the typed request ask for a length change? Only then does the length
 * rule enter the prompt — like facial hair, it rides on the content words the
 * request actually used, not on a conditional the model would ignore. Gated on
 * the TWEAK only: a catalog desc may talk about where the length sits, but the
 * catalog already fully specifies the cut, so it needs no reading rule.
 */
const LENGTH_REQUEST =
  /\b(?:shorter|longer|inch(?:es)?|centimet(?:er|re)s?|cm)\b|\btake\b.{0,24}\boff\b/i;

/**
 * How to read "two inches shorter". Relative length is the model's weakest
 * instruction: left to itself it either rounds the change away (the same
 * length handed back) or reaches for a different style that happens to be
 * shorter. So a length ask is pinned from both sides — the style is a keep,
 * the reach of the hair is the only mover, and the move must be visible.
 */
const LENGTH_EDIT_RULE =
  'When the request changes how long the hair is, length is the entire edit: ' +
  'change only how far the hair reaches, by roughly the amount named, and ' +
  'keep the same style, shape, parting and texture — the same style at a ' +
  'clearly different length, never a new style.';

/**
 * Does the typed request take the head bare? Deliberately tight: "shave the
 * sides" is an undercut and "shave the beard" is facial hair, so a lone
 * "shave" never qualifies — only "bald" or a shave aimed at the whole head.
 * A miss just means the default prompt, which is what every take got before.
 */
const BALD_REQUEST =
  /\bbald\b|\bshaved?\s+(?:my|the|his|her|their|your)?\s*head\b|\bhead\s+shaved?\b|\bshave\s+it\s+all\s+off\b/i;

/**
 * How to read "bald". The model never sees the skull under the hair, and left
 * to guess it erodes the head toward the visible hairline — the hair region is
 * treated as content to delete, not volume to reveal, and the head comes back
 * unnaturally small. Stated as a keep of the head's size and shape, never as
 * "don't shrink" — see FACIAL_HAIR_REQUEST for why a negation's noun is an
 * attractor.
 */
const FULL_SCALP_RULE =
  'When the request removes all the hair, keep the head its full current size ' +
  'and shape: the bare scalp follows the same complete skull outline the hair ' +
  'covers now, from the forehead over the crown down to the nape, at the same ' +
  'scale in the frame.';

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

/**
 * The cut the instruction actually commands, after the tweak has had its say.
 *
 * A tweak naming a whole silhouette REPLACES the picked cut instead of riding
 * on it. The old desc is a wall of style nouns, and "takes priority over the
 * description above" is exactly the kind of conditional the model ignores (see
 * FACIAL_HAIR_REQUEST) — so "buzz" over a taper-fade desc came back as the
 * taper fade with a nod at the clippers. When the catalog knows the named
 * style, its desc is swapped in and one word of chair slang becomes the same
 * full barbering copy a menu tap would send; when it doesn't, the tweak stands
 * alone rather than fighting a stale desc.
 *
 * A cut that already is the named style stays put ("shorter bob" on a bob),
 * which also makes the swap idempotent. Catalog lookup is same-gender only:
 * a man asking for a bun should not inherit the womens half-up bun's "loose
 * waves falling" — with no gender to match (bare-tweak takes), catalog order
 * decides.
 */
function resolveCut(
  cut: BarberPromptInput['cut'],
  cleanTweak: string,
): { label?: string; desc?: string } {
  const label = cut?.label?.trim().slice(0, MAX_CUT_LABEL_LENGTH) || undefined;
  const desc = cut?.desc?.trim().slice(0, MAX_CUT_DESC_LENGTH) || undefined;
  const style = silhouetteNamed(cleanTweak);
  if (!style || (label && style.test(label))) return { label, desc };
  const match = HAIRSTYLES.find(
    (c) => (!cut?.gender || c.gender === cut.gender) && style.test(c.label),
  );
  if (!match) return {};
  return {
    label: match.label.slice(0, MAX_CUT_LABEL_LENGTH),
    desc: match.desc.slice(0, MAX_CUT_DESC_LENGTH),
  };
}

export interface BarberPromptInput {
  /**
   * The catalog cut, when the barber picked one off the menu. `gender`, when
   * present, keeps silhouette resolution (resolveCut) inside the client's own
   * side of the catalog.
   */
  cut?: (Pick<Hairstyle, 'label' | 'desc'> & Partial<Pick<Hairstyle, 'gender'>>) | null;
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
  if (!cut?.label?.trim() && !cleanTweak) return null;

  // May differ from what was passed in: a silhouette tweak replaces the cut.
  const { label: cutLabel, desc } = resolveCut(cut, cleanTweak);

  // Only the TYPED words can put facial hair in scope. The catalog is head
  // hair by definition, so a cut pick alone must never open the beard up.
  const asksForFacialHair = FACIAL_HAIR_REQUEST.test(cleanTweak);

  // A named style flips the reading from caution to commitment. The length
  // rule sits out on a style ask: its "keep the same style" would fight the
  // restyle, and a style ask carries its own length words ("shorter bob").
  const asksForStyle = STYLE_REQUEST.test(cleanTweak);

  const parts: string[] = [asksForFacialHair ? IDENTITY_LOCK_WITH_FACIAL_HAIR : IDENTITY_LOCK];
  if (cleanTweak) parts.push(asksForStyle ? RESTYLE_EDIT_RULE : LITERAL_EDIT_RULE);
  if (!asksForStyle && LENGTH_REQUEST.test(cleanTweak)) parts.push(LENGTH_EDIT_RULE);
  if (BALD_REQUEST.test(cleanTweak)) parts.push(FULL_SCALP_RULE);

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
  if (cutLabel && cleanTweak) {
    // A silhouette tweak replaced the cut in the prompt (resolveCut), so
    // "taper fade — buzz" would label the take with a haircut it never showed.
    const style = silhouetteNamed(cleanTweak);
    if (style && !style.test(cutLabel)) return cleanTweak;
    return `${cutLabel} — ${cleanTweak}`;
  }
  if (cutLabel) return cutLabel;
  return cleanTweak || 'Custom';
}
