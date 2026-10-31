import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { applyKajiyaKay, KK_DEFAULT_SPECULAR_COLOR } from './HairStrandMesh';

describe('applyKajiyaKay', () => {
  test('defaults to the hackathon gold specular at full strength', () => {
    const mat = new LineMaterial({ color: 0x000000 });
    applyKajiyaKay(mat);
    expect(mat.uniforms.uKKSpecStrength.value).toBe(1);
    expect((mat.uniforms.uKKSpecColor.value as THREE.Color).getHexString()).toBe(KK_DEFAULT_SPECULAR_COLOR.slice(1));
  });

  test('honors a custom specular color and strength', () => {
    const mat = new LineMaterial({ color: 0x000000 });
    applyKajiyaKay(mat, { specular: 0.25, specularColor: '#ffffff' });
    expect(mat.uniforms.uKKSpecStrength.value).toBe(0.25);
    expect((mat.uniforms.uKKSpecColor.value as THREE.Color).getHexString()).toBe('ffffff');
  });

  test('forwards the uniforms into the compiled shader', () => {
    const mat = new LineMaterial({ color: 0x000000 });
    applyKajiyaKay(mat, { specular: 0.5 });
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: 'void main() {\nvec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\n}', fragmentShader: 'void main() {\ngl_FragColor = vec4( diffuseColor.rgb, alpha );\n}' };
    (mat.onBeforeCompile as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.uKKSpecStrength).toBe(mat.uniforms.uKKSpecStrength);
    expect(shader.fragmentShader).toContain('uniform float uKKSpecStrength');
    expect(shader.fragmentShader).toContain('spec * 0.09 * uKKSpecStrength');
  });
});
