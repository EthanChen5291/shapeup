// Shared inline styles for the /lab/fit explainer (dark, big, plain).
import type { CSSProperties } from 'react';

export const MONO = 'ui-monospace, Menlo, monospace';

export const page: CSSProperties = { background: '#0b0b10', color: '#f2f2f7', minHeight: '100vh', padding: '32px clamp(16px, 3vw, 48px) 80px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 18 };
export const card: CSSProperties = { background: '#15151c', border: '1px solid #26262f', borderRadius: 14, padding: '24px 28px', marginBottom: 28 };
export const h2: CSSProperties = { fontSize: 30, margin: '0 0 16px' };
export const h3: CSSProperties = { fontSize: 22, margin: '0 0 10px', color: '#dcdce6' };
export const h4: CSSProperties = { fontSize: 19, margin: '14px 0 6px', color: '#dcdce6' };
export const small: CSSProperties = { fontSize: 16, color: '#a0a0ae', lineHeight: 1.5 };
export const dim: CSSProperties = { color: '#8a8a98' };
export const code: CSSProperties = { fontFamily: MONO, background: '#22222c', padding: '1px 6px', borderRadius: 4, margin: '0 3px' };
export const mono: CSSProperties = { fontFamily: MONO };
export const mathBox: CSSProperties = { background: '#0f0f14', border: '1px solid #26262f', borderRadius: 10, padding: '8px 16px' };
export const table: CSSProperties = { borderCollapse: 'collapse', width: '100%', fontSize: 17, fontFamily: MONO };
export const th: CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #3a3a48', color: '#a0a0ae', fontWeight: 600 };
export const td: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #26262f' };
export const btn: CSSProperties = { fontSize: 18, padding: '8px 16px', borderRadius: 8, border: '1px solid #3a3a48', background: '#1d1d26', color: '#fff', cursor: 'pointer' };
export const btnActive: CSSProperties = { background: '#ff4d6d', border: '1px solid #ff4d6d', color: '#fff' };
export const canvasStyle: CSSProperties = { borderRadius: 10, border: '1px solid #26262f', background: '#15151c' };
export const ok: CSSProperties = { color: '#8ef0a8' };
export const warn: CSSProperties = { color: '#ffd166' };
export const bad: CSSProperties = { color: '#ff6b6b' };

export const f3 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(3));
export const f4 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(4));
