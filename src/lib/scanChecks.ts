// The live scan's quality checks: names, labels and display order. Kept out of
// LiveScanCamera so the dashboard can render the checklist without pulling the
// camera module (MediaPipe wiring and all) into its main bundle.

export type CheckKey = 'face' | 'distance' | 'facing' | 'light' | 'still';
export type CheckState = 'idle' | 'fail' | 'pass';
export type ChecksMap = Record<CheckKey, CheckState>;

export const CHECK_META: Record<CheckKey, { label: string; coach: string }> = {
  face:     { label: 'One face in frame',      coach: 'step into the frame…' },
  distance: { label: 'Arm\u2019s length away', coach: 'a touch closer…' },
  facing:   { label: 'Facing forward',         coach: 'look straight at yourself' },
  light:    { label: 'Good, even light',       coach: 'find some light' },
  still:    { label: 'Holding still',          coach: 'hold it right there…' },
};

export const CHECK_ORDER: CheckKey[] = ['face', 'distance', 'facing', 'light', 'still'];
