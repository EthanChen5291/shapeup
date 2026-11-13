'use client';

// Small three.js pieces for /lab/fit/anim: a point cloud that tweens between two vertex
// attributes in its vertex shader (so a 100k-point move costs one uniform per frame), a
// translucent labelled plane that tweens its position, arrows for sample points, and an
// fps meter.

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { easeInOut, objToThree } from './animMath';

export const TWEEN_SECONDS = 1.2;

const VERT = /* glsl */ `
  attribute vec3 after;
  attribute vec3 col;
  attribute float bright;
  uniform float t;
  uniform float size;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vec3 p = mix(position, after, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * mix(0.75, 1.0, bright);
    vColor = col;
    vBright = bright;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor * mix(0.3, 1.0, vBright), mix(0.5, 1.0, vBright));
  }
`;

export interface TweenCloudProps {
  /** target positions, three.js xyz, flat */
  target: Float32Array;
  colors: Float32Array;
  /** 0..1 per point: dimmed … full */
  bright: Float32Array;
  /** CSS px */
  size?: number;
  seconds?: number;
  /** seconds to hold the current state before the tween starts */
  delay?: number;
}

/**
 * THREE.Points whose vertex shader mixes `position` (where the points were) into `after`
 * (where they are going) by a uniform t. When `target` changes, the currently displayed
 * position is baked into `position`, `after` takes the new target, and t eases 0 → 1.
 */
export function TweenCloud({ target, colors, bright, size = 3, seconds = TWEEN_SECONDS, delay = 0 }: TweenCloudProps) {
  const dpr = useThree((s) => s.gl.getPixelRatio());
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { t: { value: 1 }, size: { value: 3 } },
  }), []);
  const anim = useRef({ start: 0, seconds: 1, running: false, ready: false });
  useEffect(() => { mat.uniforms.size.value = size * dpr; }, [mat, size, dpr]);
  useEffect(() => () => { geom.dispose(); mat.dispose(); }, [geom, mat]);

  useEffect(() => {
    const a = anim.current;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!a.ready || !pos || pos.count !== target.length / 3) {
      geom.setAttribute('position', new THREE.BufferAttribute(target.slice(), 3));
      geom.setAttribute('after', new THREE.BufferAttribute(target.slice(), 3));
      mat.uniforms.t.value = 1;
      a.ready = true; a.running = false;
      return;
    }
    const aft = geom.getAttribute('after') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array, aa = aft.array as Float32Array;
    const t = mat.uniforms.t.value as number;
    for (let i = 0; i < pa.length; i++) pa[i] += (aa[i] - pa[i]) * t; // bake what is on screen now
    aa.set(target);
    pos.needsUpdate = true; aft.needsUpdate = true;
    mat.uniforms.t.value = 0;
    a.start = performance.now() + delay * 1000; a.seconds = seconds; a.running = true;
  }, [geom, mat, target, seconds, delay]);

  useEffect(() => { geom.setAttribute('col', new THREE.BufferAttribute(colors, 3)); }, [geom, colors]);
  useEffect(() => { geom.setAttribute('bright', new THREE.BufferAttribute(bright, 1)); }, [geom, bright]);

  useFrame(() => {
    const a = anim.current;
    if (!a.running) return;
    const u = (performance.now() - a.start) / (a.seconds * 1000);
    mat.uniforms.t.value = easeInOut(u);
    if (u >= 1) a.running = false;
  });

  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

export type PlaneAxis = 'z' | 'x' | 'y';

export interface PlaneProps {
  /** which object axis the plane is perpendicular to */
  axis: PlaneAxis;
  /** object coordinate along that axis (tweens when it changes) */
  at: number;
  color: string;
  label?: ReactNode;
  opacity?: number;
  size?: number;
  /** centre of the plane along the other two object axes */
  centre?: [number, number, number];
  seconds?: number;
  /** where the plane is when it first mounts (it then tweens to `at`); default: already at `at` */
  initial?: number;
  /** label anchor in the plane's own (x, y) units, as a fraction of size: [-0.5, -0.5] = front-left corner for a z plane */
  labelAt?: [number, number];
}

/** A translucent plane across the head at object z (horizontal), x (vertical, side) or y (vertical, front). */
export function Plane({ axis, at, color, label, opacity = 0.16, size = 1.7, centre = [0, 0.05, 0.2], seconds = TWEEN_SECONDS, initial, labelAt = [-0.5, -0.5] }: PlaneProps) {
  const group = useRef<THREE.Group>(null);
  const tween = useRef({ from: initial ?? at, to: initial ?? at, start: 0, shown: initial ?? at });
  useEffect(() => {
    const tw = tween.current;
    tw.from = tw.shown; tw.to = at; tw.start = performance.now();
  }, [at]);
  const place = (v: number) => {
    const g = group.current; if (!g) return;
    const c = centre;
    if (axis === 'z') { const [x, y, z] = objToThree(c[0], c[1], v); g.position.set(x, y, z); g.rotation.set(-Math.PI / 2, 0, 0); }
    else if (axis === 'x') { const [x, y, z] = objToThree(v, c[1], c[2]); g.position.set(x, y, z); g.rotation.set(0, Math.PI / 2, 0); }
    else { const [x, y, z] = objToThree(c[0], v, c[2]); g.position.set(x, y, z); g.rotation.set(0, 0, 0); }
  };
  useFrame(() => {
    const tw = tween.current;
    const u = easeInOut((performance.now() - tw.start) / (seconds * 1000));
    tw.shown = tw.from + (tw.to - tw.from) * u;
    place(tw.shown);
  });
  return (
    <group ref={group}>
      <mesh>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(size, size)]} />
        <lineBasicMaterial color={color} transparent opacity={0.9} />
      </lineSegments>
      {label && (
        <Html position={[labelAt[0] * size, labelAt[1] * size, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace', color, background: 'rgba(11,11,16,0.82)', padding: '2px 7px', borderRadius: 4, border: `1px solid ${color}` }}>
          {label}
        </Html>
      )}
    </group>
  );
}

/** Straight arrows (line + head sphere) from `from` to `to` for a few sample points; both tween. */
export function Arrows({ from, to, color = '#ffffff', seconds = TWEEN_SECONDS, delay = 0, labels }: { from: Float32Array; to: Float32Array; color?: string; seconds?: number; delay?: number; labels?: string[] }) {
  const n = from.length / 3;
  const lines = useRef<THREE.LineSegments>(null);
  const heads = useRef<Array<THREE.Mesh | null>>([]);
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const state = useRef({ start: 0 });
  useEffect(() => {
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    state.current.start = performance.now() + delay * 1000;
  }, [geom, from, to, n, delay]);
  useFrame(() => {
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined; if (!pos) return;
    const u = easeInOut((performance.now() - state.current.start) / (seconds * 1000));
    const arr = pos.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const fx = from[i * 3], fy = from[i * 3 + 1], fz = from[i * 3 + 2];
      const tx = fx + (to[i * 3] - fx) * u, ty = fy + (to[i * 3 + 1] - fy) * u, tz = fz + (to[i * 3 + 2] - fz) * u;
      arr[i * 6] = fx; arr[i * 6 + 1] = fy; arr[i * 6 + 2] = fz; arr[i * 6 + 3] = tx; arr[i * 6 + 4] = ty; arr[i * 6 + 5] = tz;
      heads.current[i]?.position.set(tx, ty, tz);
    }
    pos.needsUpdate = true;
  });
  return (
    <group>
      <lineSegments ref={lines} geometry={geom} frustumCulled={false}>
        <lineBasicMaterial color={color} linewidth={2} />
      </lineSegments>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} ref={(m) => { heads.current[i] = m; }}>
          <sphereGeometry args={[0.012, 12, 12]} />
          <meshBasicMaterial color={color} />
          {labels?.[i] && (
            <Html position={[0.02, 0.02, 0]} style={{ pointerEvents: 'none', fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace', color: '#0b0b10', background: color, padding: '0 5px', borderRadius: 8 }}>
              {labels[i]}
            </Html>
          )}
        </mesh>
      ))}
    </group>
  );
}

/** Counts rendered frames and reports the fps once a second. */
export function FpsMeter({ onFps }: { onFps: (fps: number) => void }) {
  const frames = useRef(0), last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (!last.current) last.current = now;
    frames.current++;
    if (now - last.current >= 1000) { onFps(Math.round((frames.current * 1000) / (now - last.current))); frames.current = 0; last.current = now; }
  });
  return null;
}

/** A small floating text label at an object-frame position. */
export function Label({ at, color = '#fff', children }: { at: [number, number, number]; color?: string; children: ReactNode }) {
  return (
    <Html position={objToThree(...at)} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace', color, background: 'rgba(11,11,16,0.85)', padding: '3px 8px', borderRadius: 4, border: `1px solid ${color}` }}>
      {children}
    </Html>
  );
}
