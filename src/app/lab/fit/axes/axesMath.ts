// Pure math for /lab/fit/axes: the poses a FaceLift head goes through on its way to the screen
// in HairScene — drei's load-time flip, then the <Splat> object transform (Euler 'XYZ'
// rotation, scale, position) from lib/splatMeta DEFAULT_VIEWER_TRANSFORM. Every matrix and
// probe vector the page prints is computed here with three.js, so the colocated test can check
// it against THREE.Euler / THREE.Object3D directly.

import * as THREE from 'three';
import { DEFAULT_VIEWER_TRANSFORM } from '@/lib/splatMeta';

/** HairScene.tsx's DEFAULT_CAMERA_POS / fov / DEFAULT_ORBIT_TARGET (file-local constants there, lines 83–84 and the <Canvas camera>). */
export const HAIRSCENE_CAMERA = { position: [0, 0, 7.8] as [number, number, number], fov: 45, target: [0, 0, 0] as [number, number, number] };
export const VIEWER = DEFAULT_VIEWER_TRANSFORM;

/**
 * drei's Splat loader (node_modules/@react-three/drei/core/Splat.js, pushDataBuffer): the centre
 * is built as Vector3(x, y, −z) and stored as (center.x, −center.y, center.z). Net (x, −y, −z),
 * applied to every Gaussian before the <Splat>'s own transform.
 */
export function dreiLoadFlip(x: number, y: number, z: number): [number, number, number] {
  const center = [x, y, -z];
  return [center[0], -center[1], center[2]];
}

export type Axis = 'x' | 'y' | 'z';
const UNIT: Record<Axis, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
export const axisAngle = (axis: Axis, angle: number) => new THREE.Quaternion().setFromAxisAngle(UNIT[axis], angle);

/** A pose: the inner (data) group turned `flip` about x, inside an outer group with q / scale / pos. */
export interface Pose { flip: number; q: THREE.Quaternion; scale: number; pos: THREE.Vector3 }
/** The single intrinsic turn that leads into a step (about the outer group's own, already-turned axis). */
export interface Via { axis: Axis; angle: number }

export type PoseKey = '0' | '1' | '2' | '3' | '4' | '5a' | '5b' | '5c' | '6' | 'wrong' | 'wrong6';

const [RX, RY, RZ] = VIEWER.rotation;
const eulerQ = (rx: number, ry: number, rz: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
const ZERO = () => new THREE.Vector3();
const VPOS = () => new THREE.Vector3(...VIEWER.position);

const q2 = axisAngle('x', RX);
const q3 = q2.clone().multiply(axisAngle('y', RY));
const q4 = q3.clone().multiply(axisAngle('z', RZ));

export const POSES: Record<PoseKey, Pose> = {
  '0': { flip: 0, q: new THREE.Quaternion(), scale: 1, pos: ZERO() },
  '1': { flip: Math.PI, q: new THREE.Quaternion(), scale: 1, pos: ZERO() },
  '2': { flip: Math.PI, q: q2, scale: 1, pos: ZERO() },
  '3': { flip: Math.PI, q: q3, scale: 1, pos: ZERO() },
  '4': { flip: Math.PI, q: q4, scale: 1, pos: ZERO() },
  '5a': { flip: Math.PI, q: eulerQ(RX, RY, RZ), scale: 1, pos: ZERO() },
  '5b': { flip: Math.PI, q: axisAngle('x', Math.PI / 2), scale: 1, pos: ZERO() },
  '5c': { flip: 0, q: axisAngle('x', -Math.PI / 2), scale: 1, pos: ZERO() },
  '6': { flip: Math.PI, q: eulerQ(RX, RY, RZ), scale: VIEWER.scale, pos: VPOS() },
  wrong: { flip: Math.PI, q: eulerQ(RX, 0, 0), scale: 1, pos: ZERO() },
  wrong6: { flip: Math.PI, q: eulerQ(RX, 0, 0), scale: VIEWER.scale, pos: VPOS() },
};

/** The intrinsic turn that takes step k−1 to step k (steps 2–4 only). */
export const VIA: Partial<Record<PoseKey, Via>> = { '2': { axis: 'x', angle: RX }, '3': { axis: 'y', angle: RY }, '4': { axis: 'z', angle: RZ } };
export const PREV: Partial<Record<PoseKey, PoseKey>> = { '2': '1', '3': '2', '4': '3' };

/** The pose part-way (u in 0..1) from `from` to `to`: about one intrinsic axis when `via` is given, else a slerp. */
export function transition(from: Pose, to: Pose, u: number, via?: Via): Pose {
  const q = via ? from.q.clone().multiply(axisAngle(via.axis, via.angle * u)) : from.q.clone().slerp(to.q, u);
  return {
    flip: from.flip + (to.flip - from.flip) * u,
    q,
    scale: from.scale + (to.scale - from.scale) * u,
    pos: from.pos.clone().lerp(to.pos, u),
  };
}

/** World matrix of a data-frame point: M = T · R(q) · S · Rx(flip). */
export function matrixOf(p: Pose): THREE.Matrix4 {
  const outer = new THREE.Matrix4().compose(p.pos, p.q, new THREE.Vector3(p.scale, p.scale, p.scale));
  return outer.multiply(new THREE.Matrix4().makeRotationX(p.flip));
}

/** The 4×4 as rows (three.js stores column-major), with −0 and float dust cleaned. */
export function rows4(m: THREE.Matrix4, dp = 3): number[][] {
  const e = m.elements;
  const c = (v: number) => { const r = Math.round(v * 10 ** dp) / 10 ** dp; return r === 0 ? 0 : r; };
  return [0, 1, 2, 3].map((r) => [c(e[r]), c(e[4 + r]), c(e[8 + r]), c(e[12 + r])]);
}

export const PROBES = {
  up: { label: 'FaceLift up (0, 0, 1)', v: new THREE.Vector3(0, 0, 1) },
  face: { label: 'face direction (0, −1, 0)', v: new THREE.Vector3(0, -1, 0) },
  right: { label: 'FaceLift +x (1, 0, 0)', v: new THREE.Vector3(1, 0, 0) },
} as const;
export type ProbeId = keyof typeof PROBES;

/** Where a data-frame direction points in the world (unit length, float dust cleaned). */
export function probe(m: THREE.Matrix4, v: THREE.Vector3): [number, number, number] {
  const d = v.clone().transformDirection(m);
  const c = (x: number) => { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; };
  return [c(d.x), c(d.y), c(d.z)];
}

const WORDS: Array<[number, number, string]> = [
  [0, 1, 'screen right (+x)'], [0, -1, 'screen left (−x)'],
  [1, 1, 'up the screen (+y)'], [1, -1, 'down the screen (−y)'],
  [2, 1, 'toward the default camera (+z)'], [2, -1, 'away from the default camera (−z)'],
];
/** Plain words for a world direction as seen from HairScene's default camera (at +z looking −z). */
export function dirWords(d: [number, number, number]): string {
  for (const [i, s, w] of WORDS) if (Math.abs(d[i] - s) < 0.02) return w;
  return `oblique (${d.map((x) => x.toFixed(2)).join(', ')})`;
}

/** What a viewer at the default camera sees, from where the up and face probes point. Computed, never asserted. */
export function verdict(up: [number, number, number], face: [number, number, number]): { ok: boolean; text: string } {
  const is = (d: [number, number, number], i: number, s: number) => Math.abs(d[i] - s) < 0.02;
  const parts: string[] = [];
  if (is(up, 1, 1)) parts.push('upright');
  else if (is(up, 1, -1)) parts.push('upside down');
  else if (is(up, 2, 1)) parts.push('the crown points at the camera (you look down onto the top of the head)');
  else if (is(up, 2, -1)) parts.push('the crown points away (you look up at the neck from below)');
  else parts.push(`the head is tipped sideways (up → ${dirWords(up)})`);
  if (is(face, 2, 1)) parts.push('facing the camera');
  else if (is(face, 2, -1)) parts.push('facing away (you see the back of the head)');
  else parts.push(`the face points ${dirWords(face)}`);
  return { ok: is(up, 1, 1) && is(face, 2, 1), text: parts.join(', ') };
}

/** Front-most point (smallest y) near the midline below the eye line: the nose tip, in data coords. */
export function findNose(x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): [number, number, number] | null {
  let best = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) >= 0.04 || z[i] > 0 || z[i] < -0.4) continue;
    if (best < 0 || y[i] < y[best]) best = i;
  }
  return best < 0 ? null : [x[best], y[best], z[best]];
}

/** sRGB byte-space 0..1 → linear, so THREE's output conversion shows the true colour. */
export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Smoothstep. */
export const ease = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
