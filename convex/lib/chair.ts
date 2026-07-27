// ============================================================
// Chair Mode's shared rules — the server is the authority.
//
// Everything here is pure and dependency-free so it can be unit-tested without
// a Convex harness AND re-exported to the browser from src/lib/chair/angles.ts,
// the same split convex/lib/barberLinks.ts ↔ src/lib/barberLinks.ts already
// uses. The chair UI must validate against exactly the code that
// convex/chair.ts will run, or the barber gets a save error after the client
// already stood up.
// ============================================================

/** Hard ceiling on a single live take, in seconds. */
export const MAX_TAKE_SECONDS = 30;

/**
 * What the barber's take is charged at when it starts.
 *
 * The realtime model bills per second of wall clock, and the browser is the
 * only thing that knows when a take actually ended — a closed laptop never
 * reports. So a take is debited the FULL ceiling up front and refunded the
 * unused remainder on `finishTake`. The failure mode is over-counting (the
 * barber loses budget they didn't spend), never a silent overspend.
 */
export const TAKE_CLAIM_SECONDS = MAX_TAKE_SECONDS;

/** Default per-barber daily take cap when LUCY_DAILY_TAKES_PER_BARBER is unset. */
export const DEFAULT_DAILY_TAKES = 20;

/** Bumped when the in-chair consent copy materially changes. */
export const CHAIR_CONSENT_VERSION = "2026-07-chair-v1";

/**
 * The card's own consent stamp. Separate from the chair's because the copy is
 * different and so is the person tapping it: in the chair the barber hands the
 * tablet over, on the card the client is holding their own phone. A consent
 * record that can't say which notice was shown isn't a record.
 */
export const CARD_CONSENT_VERSION = "2026-07-card-v1";

export const MAX_CLIENT_NAME_LENGTH = 60;
export const MAX_CLIENT_NOTE_LENGTH = 300;

// ── visit records ───────────────────────────────────────────────────────────
// A visit is one client × one day in the chair (chairVisits in the schema).
// The note is "for next time" ("went 0.5 lower than usual"); the chips are the
// quick facts a barber taps rather than types (guard lengths, treatments).

export const MAX_VISIT_NOTE_LENGTH = 300;
export const MAX_VISIT_CHIPS = 6;
export const MAX_VISIT_CHIP_LENGTH = 24;
export const MAX_SERVICE_NAME_LENGTH = 60;

/**
 * Ceiling on a stored take prompt.
 *
 * This is NOT a limit on user input — the barber's free text is capped far
 * lower (MAX_TWEAK_LENGTH in src/lib/lucy/barberPrompt.ts, which is where the
 * injection risk lives). This bounds the fully COMPOSED instruction: identity
 * lock + cut description + the barber's adjustment + the rotation lock. It's
 * generous on purpose, because a truncated instruction loses its tail — and
 * the tail is the barber's own words.
 */
export const MAX_PROMPT_LENGTH = 1200;

/**
 * The reference sheet a barber actually cuts from.
 *
 * `targetYawDeg` convention: 0 is dead-on front, and POSITIVE yaw means the head
 * is rotated toward the camera's right — i.e. the client turned to their own
 * left, which presents the client's RIGHT side to the lens. So `rightProfile`
 * (the right side of the client's head, which is what a barber means by "the
 * right side") sits at +80.
 *
 * `back` has no meaningful yaw: it's identified by the absence of a face at the
 * far side of the spin, so its target is recorded as 180 and never compared.
 */
export const ANGLE_KEYS = [
  "leftProfile",
  "leftThreeQuarter",
  "front",
  "rightThreeQuarter",
  "rightProfile",
  "back",
] as const;

export type AngleKey = (typeof ANGLE_KEYS)[number];

export interface AngleSpec {
  key: AngleKey;
  targetYawDeg: number;
  /**
   * Source-language (EN) label — render through t(). May carry a `##context`
   * suffix where the bare word collides with another string in the UI (the
   * English fallback strips it; see src/lib/i18n).
   */
  label: string;
  /** Why a barber wants this frame. Source-language (EN). */
  hint: string;
}

/** Ordered the way the contact sheet reads: left side → front → right side → back. */
export const ANGLE_SPECS: readonly AngleSpec[] = [
  { key: "leftProfile", targetYawDeg: -80, label: "Left profile", hint: "Sideburn, ear line, left temple" },
  { key: "leftThreeQuarter", targetYawDeg: -35, label: "Left ¾", hint: "How the fade reads walking up" },
  { key: "front", targetYawDeg: 0, label: "Front", hint: "Fringe, part, hairline" },
  { key: "rightThreeQuarter", targetYawDeg: 35, label: "Right ¾", hint: "How the fade reads walking up" },
  { key: "rightProfile", targetYawDeg: 80, label: "Right profile", hint: "Sideburn, ear line, right temple" },
  // "Back##angle": the bare word "Back" is the nav/back-button string elsewhere,
  // which translates differently from the back of someone's head.
  { key: "back", targetYawDeg: 180, label: "Back##angle", hint: "Neckline, crown, weight line" },
];

export function isAngleKey(value: string): value is AngleKey {
  return (ANGLE_KEYS as readonly string[]).includes(value);
}

/**
 * The lookup key for "is this the same person walking back in?" — lowercased
 * with runs of whitespace collapsed, so "Marcus  T." and "marcus t." are one
 * client rather than two rows the barber has to reconcile later.
 */
export function clientNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type NameCheck =
  | { ok: true; name: string; nameKey: string }
  | { ok: false; reason: "empty" | "too_long" };

/** Validate + normalize a walk-in's name. Called on both sides of the wire. */
export function normalizeClientName(raw: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, reason: "empty" };
  if (name.length > MAX_CLIENT_NAME_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, name, nameKey: clientNameKey(name) };
}

/** "YYYY-MM-DD" (UTC) — the per-barber daily take bucket. */
export function dayBucket(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * "lucy:YYYY-MM" — the global monthly seconds bucket.
 *
 * Deliberately prefixed so it shares the `gpuUsage` table with the primary
 * worker's budget (convex/gpuUsage.ts) without the two counters ever colliding:
 * they meter different vendors with different ceilings.
 */
export function lucyMonthBucket(nowMs: number): string {
  return `lucy:${new Date(nowMs).toISOString().slice(0, 7)}`;
}
