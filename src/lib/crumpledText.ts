// A line of text that looks written on crumpled paper: every letter gets a small tilt and nudge,
// and the ink is shaded as if a wide, soft airbrush had passed over parts of the line (a darker
// pinkish red in some places, an orange glow in others). Everything is a pure function of the
// text, so the server and the browser render the same thing and it never shimmers between loads.

type Rgb = [number, number, number];

/** --tomato: the ink itself. */
const INK: Rgb = [217, 78, 58];
/** The darker, pinker red sprayed over some stretches. */
const SHADE: Rgb = [166, 30, 74];
/** The orange glow sprayed over others. */
const GLOW: Rgb = [255, 150, 62];

/** Soft patches along the line: where (0 = start, 1 = end), how wide, and how strong at the centre. */
const SHADE_PATCHES = [
  { at: 0.06, width: 0.055, strength: 0.4 },
  { at: 0.34, width: 0.07, strength: 0.33 },
  { at: 0.61, width: 0.05, strength: 0.41 },
  { at: 0.9, width: 0.06, strength: 0.36 },
];
const GLOW_PATCHES = [
  { at: 0.19, width: 0.06, strength: 0.3 },
  { at: 0.47, width: 0.055, strength: 0.27 },
  { at: 0.76, width: 0.07, strength: 0.3 },
];

/** How far a letter may tilt (degrees) and ride up or down (em). Small: crumpled, still one line. */
export const MAX_TILT_DEG = 3.2;
export const MAX_SHIFT_EM = 0.045;

const spray = (t: number, patches: typeof SHADE_PATCHES) =>
  Math.min(1, patches.reduce((sum, p) => sum + p.strength * Math.exp(-(((t - p.at) / p.width) ** 2)), 0));
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The ink colour at a point along the line (0 = start, 1 = end). */
export function inkAt(t: number): string {
  const [r, g, b] = mix(mix(INK, SHADE, spray(t, SHADE_PATCHES)), GLOW, spray(t, GLOW_PATCHES));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** A steady pseudo-random number in [-1, 1] for a letter position (no Math.random: it must not change between renders). */
function wobble(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export interface CrumpledLetter {
  char: string;
  /** Tilt in degrees. */
  tilt: number;
  /** Vertical shift in em (positive = down). */
  shift: number;
  /** The ink across this letter: it starts where the previous letter's ended, so the spray reads as one pass. */
  from: string;
  to: string;
  /** Direction of the letter's gradient, varied so the patches don't line up as vertical bands. */
  angle: number;
}

/** The text as words (kept whole when the line wraps), each a run of crumpled letters. */
export function crumpleText(text: string): CrumpledLetter[][] {
  const chars = [...text];
  const inked = chars.filter((c) => c !== ' ').length;
  let n = 0; // index among the inked letters
  const words: CrumpledLetter[][] = [];
  let word: CrumpledLetter[] = [];
  for (const char of chars) {
    if (char === ' ') {
      if (word.length) words.push(word);
      word = [];
      continue;
    }
    const t0 = n / inked;
    const t1 = (n + 1) / inked;
    word.push({
      char,
      tilt: +(wobble(n, 1) * MAX_TILT_DEG).toFixed(2),
      shift: +(wobble(n, 2) * MAX_SHIFT_EM).toFixed(3),
      from: inkAt(t0),
      to: inkAt(t1),
      angle: Math.round(120 + wobble(n, 3) * 35),
    });
    n++;
  }
  if (word.length) words.push(word);
  return words;
}
