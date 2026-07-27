// ============================================================
// The angle vocabulary, and the coaching script that produces the angles.
//
// The rules themselves live server-side (convex/lib/chair.ts) and are
// re-exported here so the chair validates against exactly the code that
// `chair.approveTake` will run — the same split src/lib/barberLinks.ts uses.
//
// What's new here is the COACH SCRIPT, and it's load-bearing rather than
// decorative. A barber chair spins; that's the natural way to see the back of
// someone's head, and it's a motion every client already understands. So a take
// is: hold the front for five seconds, then one slow full rotation.
//
// The consequence for extraction is the useful part — because the script tells
// the client when to turn, every timestamp carries an EXPECTED angle before any
// face detection runs. Detection refines that prior; it isn't required for it.
// When the landmarker fails to load (or the client is wearing a mask, or the
// shop is backlit), the script alone still yields a sensible contact sheet.
// See angleSelection.ts.
// ============================================================

export {
  ANGLE_KEYS,
  ANGLE_SPECS,
  CHAIR_CONSENT_VERSION,
  MAX_CLIENT_NAME_LENGTH,
  MAX_CLIENT_NOTE_LENGTH,
  MAX_TAKE_SECONDS,
  MAX_VISIT_CHIPS,
  MAX_VISIT_NOTE_LENGTH,
  clientNameKey,
  isAngleKey,
  normalizeClientName,
} from '@convex/lib/chair';

/**
 * The quick facts a barber taps instead of types after a cut: guard lengths
 * and the treatments that recur every day. Stored verbatim (EN) on the visit;
 * word chips render through t(). Selection is capped at MAX_VISIT_CHIPS.
 */
export const DECISION_CHIPS: readonly string[] = [
  '#0',
  '#1',
  '#2',
  '#3',
  '#4',
  'Skin fade',
  'Taper',
  'Line up',
  'Beard trim',
  'Scissors',
];

export type { AngleKey, AngleSpec, NameCheck } from '@convex/lib/chair';

/** Where the front-facing hold ends and the rotation begins, in ms. */
export const SPIN_STARTS_AT_MS = 5_000;

export interface CoachCue {
  fromMs: number;
  toMs: number;
  /** Source-language (EN) — render through t(). */
  line: string;
}

/**
 * What the client is told, and when. Timed against the recording clock, not the
 * connection clock, so the countdown and the coaching can never disagree.
 */
export const COACH_SCRIPT: readonly CoachCue[] = [
  { fromMs: 0, toMs: SPIN_STARTS_AT_MS, line: 'Look straight into the camera' },
  { fromMs: SPIN_STARTS_AT_MS, toMs: 14_000, line: 'Now start turning — slow and steady' },
  { fromMs: 14_000, toMs: 48_000, line: 'Keep going, all the way around' },
  { fromMs: 48_000, toMs: 60_000, line: 'And back to the front' },
];

export function coachLineAt(elapsedMs: number): string {
  const cue = COACH_SCRIPT.find((c) => elapsedMs >= c.fromMs && elapsedMs < c.toMs);
  return cue?.line ?? COACH_SCRIPT[COACH_SCRIPT.length - 1].line;
}
