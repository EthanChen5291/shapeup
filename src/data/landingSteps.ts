// The landing page's "how it works" demo: one guy, from his selfie (step 1), through the cuts he
// texts for (step 2), to his head wearing each one in 3D (step 3).
//
// The clips are real renders of the product: his selfie built into a head, then the try-on
// catalog's own cuts fitted on it (scripts/landing-step-clips.mjs). Every clip is the same length
// and turns on the same schedule, so step 3 can swap one for another in the middle of a turn.

export const FACE1_SELFIE = '/face1_selfie.webp';

/** His own hair: what step 3 shows before the first message is sent. */
export const FACE1_IDLE_VID = '/landing_face1/face1.mp4';

/** One request per clip, in the order the send button goes through them. */
export const FACE1_LOOKS = [
  { video: '/landing_face1/face1a.mp4', message: 'Give me a middle part',      reply: '✂ Snip snip — check step 3 →' }, // m-middlepart_darkbrown
  { video: '/landing_face1/face1b.mp4', message: 'Messy, platinum blonde',     reply: 'Bleached it. Look right →' },    // m-messytextured_platinum
  { video: '/landing_face1/face1c.mp4', message: 'Curly mop on top',           reply: 'Curls are in →' },               // m-curlymop_lightbrown
  { video: '/landing_face1/face1d.mp4', message: 'Slick it back, go silver',   reply: 'Full silver. Bold. →' },         // m-slickedback_silver
  { video: '/landing_face1/face1e.mp4', message: 'Mullet, jet black',          reply: 'Party in the back →' },          // m-mullet_jetblack
  { video: '/landing_face1/face1f.mp4', message: 'Long curls, shoulder length', reply: 'Grew it out for you →' },       // m-longcurls_darkbrown
  { video: '/landing_face1/face1g.mp4', message: 'Man bun, tied up',           reply: 'Tied it up for you →' },         // m-manbun_jetblack
  { video: '/landing_face1/face1h.mp4', message: 'Locs, past my shoulders',    reply: 'Locs, rendered →' },             // m-locs_darkbrown
] as const;

export const FACE1_VIDS = FACE1_LOOKS.map((l) => l.video);
export const FACE1_MESSAGES = FACE1_LOOKS.map((l) => l.message);
export const FACE1_REPLIES = FACE1_LOOKS.map((l) => l.reply);

/**
 * Whether a clip already holds second `t`, so it can be moved there at once. Asking a video for
 * a moment it has not downloaded snaps it back to the start instead.
 */
export function holdsMoment(buffered: Pick<TimeRanges, 'length' | 'start' | 'end'>, t: number): boolean {
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= t && t <= buffered.end(i)) return true;
  }
  return false;
}
