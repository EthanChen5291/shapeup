// Sidecar meta.json written by the GPU worker next to each head's .splat
// (facelifts/<jobId>/meta.json). It carries the viewer transform that used to
// be hard-coded in HairScene.tsx and the provenance of the head (model commit,
// seed, GPU, timings), so the data describes itself. Heads built before the
// sidecar existed have none; every consumer must treat it as optional.

export interface SplatMeta {
  schemaVersion: number;
  jobId: string;
  createdAt: string | null;
  model: { name: string; commit: string; seed: number | null };
  gpu: { name: string | null };
  // splatBytes + sha256 describe the exact file the worker uploaded (newer heads only).
  output: { gaussianCount: number | null; splatS3Key: string | null; splatBytes: number | null; sha256: string | null };
  viewer: ViewerTransform;
}

export interface ViewerTransform {
  rotation: [number, number, number]; // three.js Euler XYZ, radians
  scale: number;
  position: [number, number, number];
}

// The constants HairScene has always used; also the fallback when a sidecar
// is missing a field.
export const DEFAULT_VIEWER_TRANSFORM: ViewerTransform = {
  rotation: [-Math.PI / 2, Math.PI, Math.PI],
  scale: 2.772,
  position: [0, -0.07, 0.48],
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function vec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) return fallback;
  const [a, b, c] = v.map(num);
  return a === null || b === null || c === null ? fallback : [a, b, c];
}

/** Parse an untrusted meta.json body. Returns null unless it is a recognizable sidecar. */
export function parseSplatMeta(input: unknown): SplatMeta | null {
  if (!input || typeof input !== 'object') return null;
  const m = input as Record<string, unknown>;
  const schemaVersion = num(m.schema_version);
  const jobId = str(m.job_id);
  if (schemaVersion !== 1 || !jobId) return null;

  const model = (m.model ?? {}) as Record<string, unknown>;
  const gpu = (m.gpu ?? {}) as Record<string, unknown>;
  const output = (m.output ?? {}) as Record<string, unknown>;
  const viewer = (m.viewer ?? {}) as Record<string, unknown>;

  return {
    schemaVersion,
    jobId,
    createdAt: str(m.created_at),
    model: { name: str(model.name) ?? 'facelift', commit: str(model.commit) ?? 'unknown', seed: num(model.seed) },
    gpu: { name: str(gpu.name) },
    output: {
      gaussianCount: num(output.gaussian_count),
      splatS3Key: str(output.splat_s3_key),
      splatBytes: num(output.splat_bytes),
      sha256: typeof output.sha256 === 'string' && /^[0-9a-f]{64}$/.test(output.sha256) ? output.sha256 : null,
    },
    viewer: {
      rotation: vec3(viewer.rotation_euler_xyz, DEFAULT_VIEWER_TRANSFORM.rotation),
      scale: num(viewer.scale) ?? DEFAULT_VIEWER_TRANSFORM.scale,
      position: vec3(viewer.position, DEFAULT_VIEWER_TRANSFORM.position),
    },
  };
}

/** The transform the viewer should apply: from the sidecar when present, else the constants. */
export function viewerTransform(meta: SplatMeta | null | undefined): ViewerTransform {
  return meta ? meta.viewer : DEFAULT_VIEWER_TRANSFORM;
}

/**
 * Whether downloaded splat bytes match what the worker uploaded. Heads whose
 * sidecar predates splat_bytes (or have no sidecar) can't be checked and pass.
 */
export function splatSizeMatches(meta: SplatMeta | null | undefined, byteLength: number): boolean {
  const expected = meta?.output.splatBytes;
  return expected == null || expected === byteLength;
}
