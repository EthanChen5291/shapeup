// Request body for the admin point-cloud labs (/admin/subtraction,
// /admin/alignment). They work on the raw Gaussian .ply, which FaceLift only
// uploads when asked (needPly — skipped by default since 3e450de to save the
// ~40 MB transfer). Without it /api/facelift returns plyUrl: null and both labs
// failed at the scan step with "missing fields".
export function labFaceliftBody(imageDataUrl: string, outputName: string) {
  return { imageDataUrl, outputName, needPly: true } as const;
}
