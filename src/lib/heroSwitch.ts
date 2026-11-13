// The landing hero's switch between its two renders, as a function of time since the arrow
// was pressed. The head shrinks while its video speeds up; at the smallest, fastest point the
// other render takes over at that same speed, then grows back and slows to normal. Both loops
// turn on the same schedule, so the swap lands on the same head angle.

/** Shrinking and speeding up, with the outgoing render still showing. */
export const SWITCH_OUT_MS = 260;
/** Growing back and slowing down, with the incoming render showing. */
export const SWITCH_IN_MS = 460;
/** "Smaller by about 15%". */
export const SWITCH_MIN_SCALE = 0.85;
/** Playback speed at the swap. */
export const SWITCH_MAX_RATE = 4;

export interface SwitchFrame {
  /** Scale of the head, 1 = resting size. */
  scale: number;
  /** Playback rate for both videos, 1 = normal. */
  rate: number;
  /** The incoming render is the one on screen. */
  swapped: boolean;
  /** The switch is over: scale and rate are back at 1. */
  done: boolean;
}

// "Back" easings overshoot by BACK: a small wind-up before shrinking, a small bounce on landing.
const BACK = 2;
const easeInBack = (p: number) => (BACK + 1) * p * p * p - BACK * p * p;
const easeOutBack = (p: number) => 1 + (BACK + 1) * (p - 1) ** 3 + BACK * (p - 1) ** 2;

export function switchFrame(elapsedMs: number): SwitchFrame {
  if (!(elapsedMs > 0)) return { scale: 1, rate: 1, swapped: false, done: false };
  if (elapsedMs < SWITCH_OUT_MS) {
    const p = elapsedMs / SWITCH_OUT_MS;
    return {
      scale: 1 - (1 - SWITCH_MIN_SCALE) * easeInBack(p),
      rate: 1 + (SWITCH_MAX_RATE - 1) * p * p, // eases in: the speed-up starts gently
      swapped: false,
      done: false,
    };
  }
  if (elapsedMs < SWITCH_OUT_MS + SWITCH_IN_MS) {
    const p = (elapsedMs - SWITCH_OUT_MS) / SWITCH_IN_MS;
    return {
      scale: SWITCH_MIN_SCALE + (1 - SWITCH_MIN_SCALE) * easeOutBack(p),
      rate: 1 + (SWITCH_MAX_RATE - 1) * (1 - p) ** 2, // eases out: it settles into normal speed
      swapped: true,
      done: false,
    };
  }
  return { scale: 1, rate: 1, swapped: true, done: true };
}
