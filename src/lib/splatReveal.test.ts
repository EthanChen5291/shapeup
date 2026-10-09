import { describe, expect, it } from 'vitest';
import {
  applySplatReveal,
  isSplatMaterial,
  patchSplatMaterialForReveal,
  revealEase,
  revealUniformValue,
} from './splatReveal';

// Mirrors the relevant lines of drei's SplatMaterial fragment shader.
const DREI_FRAGMENT = `
    in vec4 vColor;
    in vec3 vPosition;
    void main () {
      float A = -dot(vPosition.xy, vPosition.xy);
      if (A < -4.0) discard;
      float B = exp(A) * vColor.a;
      vec4 diffuseColor = vec4(vColor.rgb, B);
      gl_FragColor = diffuseColor;
    }`;

function fakeMaterial(fragmentShader = DREI_FRAGMENT) {
  return {
    fragmentShader,
    uniforms: { centerAndScaleTexture: { value: null }, viewport: { value: [1, 1] } } as Record<string, { value: unknown }>,
    userData: {} as { splatRevealPatched?: boolean },
    needsUpdate: false,
  };
}

describe('isSplatMaterial', () => {
  it('recognises drei splat materials by their uniform', () => {
    expect(isSplatMaterial(fakeMaterial())).toBe(true);
    expect(isSplatMaterial({ fragmentShader: 'x', uniforms: {} })).toBe(false);
    expect(isSplatMaterial(undefined)).toBe(false);
  });
});

describe('patchSplatMaterialForReveal', () => {
  it('injects the uniform and feathered fade once, and recompiles', () => {
    const mat = fakeMaterial();
    expect(patchSplatMaterialForReveal(mat as never)).toBe(true);
    expect(mat.fragmentShader).toContain('uniform float uReveal;');
    expect(mat.fragmentShader).toContain('smoothstep(uReveal - 0.14, uReveal, gl_FragCoord.y / viewport.y)');
    expect(mat.uniforms.uReveal.value).toBe(2);
    expect(mat.needsUpdate).toBe(true);

    mat.needsUpdate = false;
    expect(patchSplatMaterialForReveal(mat as never)).toBe(false);
    expect(mat.fragmentShader.match(/uniform float uReveal;/g)).toHaveLength(1);
    expect(mat.needsUpdate).toBe(false);
  });

  it('fails open if drei changed its shader', () => {
    const mat = fakeMaterial('void main () { gl_FragColor = vec4(1.0); }');
    expect(patchSplatMaterialForReveal(mat as never)).toBe(false);
    expect(mat.uniforms.uReveal).toBeUndefined();
    expect(mat.needsUpdate).toBe(false);
  });
});

describe('revealUniformValue', () => {
  it('hides everything at 0, overshoots the feather at 1, and is fully visible for null', () => {
    expect(revealUniformValue(0)).toBe(0);
    expect(revealUniformValue(1)).toBeGreaterThan(1.14);
    expect(revealUniformValue(1)).toBeLessThan(1.5);
    expect(revealUniformValue(2)).toBe(revealUniformValue(1));
    expect(revealUniformValue(-1)).toBe(0);
    expect(revealUniformValue(null)).toBe(2);
  });
});

describe('applySplatReveal', () => {
  it('patches then sets the uniform', () => {
    const mat = fakeMaterial();
    applySplatReveal(mat as never, 0);
    expect(mat.uniforms.uReveal.value).toBe(0);
    applySplatReveal(mat as never, null);
    expect(mat.uniforms.uReveal.value).toBe(2);
  });
});

describe('revealEase', () => {
  it('is monotonic from 0 to 1', () => {
    expect(revealEase(0)).toBe(0);
    expect(revealEase(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = revealEase(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
