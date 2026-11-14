import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACE1_IDLE_VID, FACE1_LOOKS, FACE1_MESSAGES, FACE1_REPLIES, FACE1_SELFIE, FACE1_VIDS, holdsMoment } from './landingSteps';

const inPublic = (url: string) => join(process.cwd(), 'public', url);

/** Frames and frame length of an .mp4's video track, read from its 'stts' box (one run when every frame is the same length). */
function timing(url: string): { frames: number; delta: number; runs: number } {
  const buf = readFileSync(inPublic(url));
  const at = buf.indexOf('stts', 0, 'latin1');
  return { runs: buf.readUInt32BE(at + 8), frames: buf.readUInt32BE(at + 12), delta: buf.readUInt32BE(at + 16) };
}

describe('landing "how it works" demo', () => {
  it('has a clip, a request and a reply for every look', () => {
    expect(FACE1_LOOKS.length).toBe(8);
    expect(new Set(FACE1_VIDS).size).toBe(FACE1_LOOKS.length);
    expect(new Set(FACE1_MESSAGES).size).toBe(FACE1_LOOKS.length);
    for (const look of FACE1_LOOKS) {
      expect(look.message.trim()).not.toBe('');
      expect(look.reply.trim()).not.toBe('');
    }
    expect(FACE1_REPLIES).toHaveLength(FACE1_LOOKS.length);
  });

  it('ships every file it names', () => {
    for (const url of [FACE1_SELFIE, FACE1_IDLE_VID, ...FACE1_VIDS]) {
      expect(existsSync(inPublic(url)), url).toBe(true);
    }
  });

  // Step 3 swaps clips in the middle of a turn by moving the next one to the same second. That
  // only lines up if every clip has the same frames at the same times.
  it('gives every clip the same number of frames at the same rate', () => {
    const idle = timing(FACE1_IDLE_VID);
    expect(idle.runs).toBe(1);
    expect(idle.frames).toBe(72); // 1.2 s at 60 fps
    for (const url of FACE1_VIDS) expect(timing(url), url).toEqual(idle);
  });
});

describe('holdsMoment', () => {
  const ranges = (...r: [number, number][]) => ({ length: r.length, start: (i: number) => r[i][0], end: (i: number) => r[i][1] });

  it('is true inside a downloaded range, ends included', () => {
    expect(holdsMoment(ranges([0, 1.2]), 0.6)).toBe(true);
    expect(holdsMoment(ranges([0, 1.2]), 0)).toBe(true);
    expect(holdsMoment(ranges([0, 1.2]), 1.2)).toBe(true);
    expect(holdsMoment(ranges([0, 0.2], [0.5, 1.2]), 0.7)).toBe(true);
  });

  it('is false in a gap, past the end, and when nothing has downloaded', () => {
    expect(holdsMoment(ranges([0, 0.2], [0.5, 1.2]), 0.3)).toBe(false);
    expect(holdsMoment(ranges([0, 0.4]), 0.9)).toBe(false);
    expect(holdsMoment(ranges(), 0)).toBe(false);
  });
});
