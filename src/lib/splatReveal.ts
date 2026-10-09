// Bottom-to-top reveal for drei's Gaussian-splat material.
//
// A CSS mask over the <canvas> would also hide the scene background, and the
// user wants the backdrop to stay put while only the render fades in. So the
// fade lives in the splat's own fragment shader: a `uReveal` uniform in
// normalised screen space (0 = bottom edge, 1 = top) with a feathered
// smoothstep edge. Fragments above the edge get alpha 0 and are dropped by
// drei's alphatest include, so a half-streamed cloud is invisible at 0.
//
// drei's SplatMaterial already carries a `viewport` uniform (device pixels,
// refreshed every frame), which is what gl_FragCoord is measured in.

import type * as THREE from 'three';

export const REVEAL_FEATHER = 0.14;
// Drive uReveal past 1 so the feather clears the top edge at progress 1.
const REVEAL_OVERSHOOT = 1 + REVEAL_FEATHER + 0.02;
const FULLY_VISIBLE = 2;

const ANCHOR = 'float B = exp(A) * vColor.a;';
const INJECT = `${ANCHOR}
      B *= 1.0 - smoothstep(uReveal - ${REVEAL_FEATHER.toFixed(2)}, uReveal, gl_FragCoord.y / viewport.y);`;
const DECL_ANCHOR = 'in vec3 vPosition;';
const DECL = `${DECL_ANCHOR}
    uniform float uReveal;
    uniform vec2 viewport;`;

type RevealableMaterial = THREE.ShaderMaterial & { userData: { splatRevealPatched?: boolean } };

export function isSplatMaterial(mat: unknown): mat is RevealableMaterial {
  const m = mat as Partial<THREE.ShaderMaterial> | null | undefined;
  return !!m && typeof m.fragmentShader === 'string' && !!m.uniforms && 'centerAndScaleTexture' in m.uniforms;
}

/** Maps reveal progress (0..1, or null for "no reveal") to the uniform value. */
export function revealUniformValue(progress: number | null): number {
  if (progress === null) return FULLY_VISIBLE;
  return Math.min(1, Math.max(0, progress)) * REVEAL_OVERSHOOT;
}

/** Injects the reveal uniform into the material once; later calls are no-ops. */
export function patchSplatMaterialForReveal(mat: RevealableMaterial): boolean {
  if (mat.userData.splatRevealPatched) return false;
  const fs = mat.fragmentShader;
  if (!fs.includes(ANCHOR) || !fs.includes(DECL_ANCHOR)) {
    // drei changed its shader; fail open (render normally) rather than break.
    mat.userData.splatRevealPatched = true;
    return false;
  }
  mat.fragmentShader = fs.replace(DECL_ANCHOR, DECL).replace(ANCHOR, INJECT);
  mat.uniforms.uReveal = { value: FULLY_VISIBLE };
  mat.userData.splatRevealPatched = true;
  mat.needsUpdate = true;
  return true;
}

export function applySplatReveal(mat: RevealableMaterial, progress: number | null): void {
  patchSplatMaterialForReveal(mat);
  const u = mat.uniforms.uReveal;
  if (u) u.value = revealUniformValue(progress);
}

/** Ease for the reveal animation (ease-in-out cubic). */
export function revealEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
