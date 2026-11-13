import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { axisAngle, dirWords, dreiLoadFlip, ease, findNose, matrixOf, POSES, probe, PROBES, rows4, srgbToLinear, transition, VIA, VIEWER, verdict } from './axesMath';

const close = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.forEach((v, i) => expect(v).toBeCloseTo(b.elements[i], 9));
const F = new THREE.Matrix4().makeScale(1, -1, -1);
const EULER = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, Math.PI, 'XYZ'));

describe('drei load flip', () => {
  it('(x, y, z) → (x, −y, −z), which is a 180° turn about x (not a mirror)', () => {
    expect(dreiLoadFlip(0.1, 0.2, 0.3)).toEqual([0.1, -0.2, -0.3]);
    const v = new THREE.Vector3(0.1, 0.2, 0.3).applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
    expect(v.x).toBeCloseTo(0.1, 12); expect(v.y).toBeCloseTo(-0.2, 12); expect(v.z).toBeCloseTo(-0.3, 12);
    close(new THREE.Matrix4().makeRotationX(Math.PI), F);
    expect(F.determinant()).toBe(1);
  });
});

describe('the step sequence', () => {
  it('uses the viewer transform HairScene uses', () => {
    expect(VIEWER.rotation).toEqual([-Math.PI / 2, Math.PI, Math.PI]);
    expect(VIEWER.scale).toBe(2.772);
    expect(VIEWER.position).toEqual([0, -0.07, 0.48]);
  });
  it('Euler XYZ [−π/2, π, π] is +90° about x', () => {
    close(EULER, new THREE.Matrix4().makeRotationX(Math.PI / 2));
  });
  it('intrinsic X then Y then Z (steps 2–4) ends at makeRotationFromEuler(...) · flip, which is −90° about x', () => {
    close(matrixOf(POSES['4']), EULER.clone().multiply(F));
    close(matrixOf(POSES['4']), new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    close(matrixOf(POSES['5a']), matrixOf(POSES['4']));
  });
  it('steps 2/3/4 are Rx·F, Rx·Ry·F, Rx·Ry·Rz·F; read right-to-left that is Z, Y, X about the world axes', () => {
    const Rx = new THREE.Matrix4().makeRotationX(-Math.PI / 2), Ry = new THREE.Matrix4().makeRotationY(Math.PI), Rz = new THREE.Matrix4().makeRotationZ(Math.PI);
    close(matrixOf(POSES['2']), Rx.clone().multiply(F));
    close(matrixOf(POSES['3']), Rx.clone().multiply(Ry).multiply(F));
    close(matrixOf(POSES['4']), Rx.clone().multiply(Ry).multiply(Rz).multiply(F));
    // extrinsic reading: Z about world, then Y about world, then X about world
    const ext = new THREE.Matrix4().premultiply(Rz).premultiply(Ry).premultiply(Rx);
    close(ext.multiply(F), matrixOf(POSES['4']));
  });
  it('the single-rotation equivalents land on the same pose', () => {
    close(matrixOf(POSES['5b']), matrixOf(POSES['4']));
    close(matrixOf(POSES['5c']), matrixOf(POSES['4']));
  });
  it('step 6 equals what a THREE.Object3D with the <Splat> props does to the flipped data', () => {
    const o = new THREE.Object3D();
    o.position.set(...VIEWER.position); o.rotation.set(...VIEWER.rotation); o.scale.setScalar(VIEWER.scale);
    o.updateMatrix();
    close(matrixOf(POSES['6']), o.matrix.clone().multiply(F));
  });
});

describe('probes after each step (computed)', () => {
  const p = (k: keyof typeof POSES) => ({ up: probe(matrixOf(POSES[k]), PROBES.up.v), face: probe(matrixOf(POSES[k]), PROBES.face.v), right: probe(matrixOf(POSES[k]), PROBES.right.v) });
  it('walks from lying to upright and facing the camera', () => {
    expect(p('0')).toEqual({ up: [0, 0, 1], face: [0, -1, 0], right: [1, 0, 0] });
    expect(p('1')).toEqual({ up: [0, 0, -1], face: [0, 1, 0], right: [1, 0, 0] });
    expect(p('2')).toEqual({ up: [0, -1, 0], face: [0, 0, -1], right: [1, 0, 0] });
    expect(p('3')).toEqual({ up: [0, 1, 0], face: [0, 0, -1], right: [-1, 0, 0] });
    expect(p('4')).toEqual({ up: [0, 1, 0], face: [0, 0, 1], right: [1, 0, 0] });
    expect(p('6')).toEqual(p('4'));
  });
  it('rotation [−π/2, 0, 0] alone is upside down and facing away', () => {
    const w = p('wrong');
    expect(w).toEqual({ up: [0, -1, 0], face: [0, 0, -1], right: [1, 0, 0] });
    expect(verdict(w.up, w.face)).toEqual({ ok: false, text: 'upside down, facing away (you see the back of the head)' });
    expect(verdict(p('4').up, p('4').face)).toEqual({ ok: true, text: 'upright, facing the camera' });
  });
  it('dirWords names the axis directions', () => {
    expect(dirWords([0, 0, 1])).toBe('toward the default camera (+z)');
    expect(dirWords([0, -1, 0])).toBe('down the screen (−y)');
    expect(dirWords([0.7, 0.7, 0])).toMatch(/^oblique/);
  });
});

describe('transition', () => {
  it('ends where it says, and an intrinsic via turns about the current local axis', () => {
    const half = transition(POSES['2'], POSES['3'], 0.5, VIA['3']);
    const expected = POSES['2'].q.clone().multiply(axisAngle('y', Math.PI / 2));
    expect(half.q.angleTo(expected)).toBeLessThan(1e-9);
    const end = transition(POSES['2'], POSES['3'], 1, VIA['3']);
    expect(end.q.angleTo(POSES['3'].q)).toBeLessThan(1e-9);
    const mid = transition(POSES['4'], POSES['6'], 0.5);
    expect(mid.scale).toBeCloseTo((1 + 2.772) / 2, 9);
    expect(mid.pos.z).toBeCloseTo(0.24, 9);
    expect(transition(POSES['0'], POSES['1'], 0.5).flip).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('small helpers', () => {
  it('rows4 is row-major and clean', () => {
    expect(rows4(matrixOf(POSES['4']))).toEqual([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]]);
  });
  it('findNose takes the front-most midline point below the eye line', () => {
    expect(findNose([0, 0.01, 0.2, 0], [-0.4, -0.5, -0.9, -0.95], [-0.2, -0.25, -0.2, 0.3])).toEqual([0.01, -0.5, -0.25]);
    expect(findNose([1], [0], [0])).toBeNull();
  });
  it('srgbToLinear and ease', () => {
    expect(srgbToLinear(0)).toBe(0); expect(srgbToLinear(1)).toBeCloseTo(1, 9);
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(2)).toBe(1);
  });
});
