// Config for the control-first lab viewer (HairStep strands over a FaceLift head).
// Defaults are the hackathon constants from the Apr 19 HairScene; everything is
// overridable from the URL so a fit can be shared as a link.

export interface LabParams {
  head: string;      // .splat URL (bald or buzz-cut FaceLift head)
  strands: string;   // LineSet .ply URL (HairStep strands)
  hairScale: number;
  hairPos: [number, number, number];
  hairColor: string;
  lineWidth: number;
  specular: number;  // 0..1 multiplier on the strand shader's highlight
}

// Fit found by hand on 2026-10-30 for Ethan's photo (HairStep strands over the
// buzz-cut FaceLift head). The Apr 19 hackathon constants were 13.109 / [0, -23.349, 0.714].
export const LAB_DEFAULTS: LabParams = {
  head: '/lab/head.splat',
  strands: '/lab/strands.ply',
  hairScale: 11.5,
  hairPos: [0.04, -20.14, 0.55],
  hairColor: '#0a0a0a',
  lineWidth: 1.0,
  specular: 0.35,
};

/** Hair layers the bottom bar can switch between, in the hackathon demo's order. */
export const LAB_LAYERS: { id: string; label: string; url: string; color: string }[] = [
  { id: 'hairstep', label: 'Top Hair', url: '/lab/strands.ply', color: '#0a0a0a' },
  { id: 'apr', label: 'Ethan (Apr)', url: '/lab/strands_apr.ply', color: '#0a0a0a' },
  { id: 'strands_1', label: 'Strands 1', url: '/lab/strands_1.ply', color: '#3b1f0a' },
  { id: 'depth_1', label: 'Depth 1', url: '/lab/depth_1.ply', color: '#3b1f0a' },
  { id: 'bruno', label: 'Bruno', url: '/lab/brunohair.ply', color: '#0f0d0c' },
];

function num(v: string | null, fallback: number): number {
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeUrl(v: string | null, fallback: string): string {
  // Only same-origin paths: this page loads whatever it is pointed at.
  return v && v.startsWith('/') && !v.startsWith('//') ? v : fallback;
}

export function parseLabParams(search: URLSearchParams): LabParams {
  const d = LAB_DEFAULTS;
  const color = search.get('color');
  return {
    head: safeUrl(search.get('head'), d.head),
    strands: safeUrl(search.get('strands'), d.strands),
    hairScale: num(search.get('s'), d.hairScale),
    hairPos: [num(search.get('x'), d.hairPos[0]), num(search.get('y'), d.hairPos[1]), num(search.get('z'), d.hairPos[2])],
    hairColor: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : d.hairColor,
    lineWidth: num(search.get('w'), d.lineWidth),
    specular: Math.min(1, Math.max(0, num(search.get('sp'), d.specular))),
  };
}

export function labParamsToSearch(p: LabParams): string {
  const q = new URLSearchParams();
  if (p.head !== LAB_DEFAULTS.head) q.set('head', p.head);
  if (p.strands !== LAB_DEFAULTS.strands) q.set('strands', p.strands);
  q.set('s', p.hairScale.toFixed(3));
  q.set('x', p.hairPos[0].toFixed(3));
  q.set('y', p.hairPos[1].toFixed(3));
  q.set('z', p.hairPos[2].toFixed(3));
  q.set('color', p.hairColor);
  q.set('w', p.lineWidth.toFixed(2));
  q.set('sp', p.specular.toFixed(2));
  return q.toString();
}
