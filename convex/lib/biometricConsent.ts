// Biometric notice versions, shared by the Convex functions and the consent UI
// (dashboard dialog, scan camera checkbox). No Convex functions live here.

/** The notice users accept today. Bump it whenever the notice's purposes change. */
export const BIOMETRIC_CONSENT_VERSION = "biometric-notice-2026-11-02";

/**
 * First notice that discloses the edit identity check (selfie vs edited image,
 * score kept, embeddings discarded). Users who accepted an older notice keep
 * their 3D-preview consent, but the check is skipped for them.
 */
export const IDENTITY_CHECK_NOTICE_VERSION = "biometric-notice-2026-11-02";

/** Versions are "biometric-notice-YYYY-MM-DD", so later dates sort later. */
export function coversIdentityCheck(version: string | undefined | null): boolean {
  return typeof version === "string" && version >= IDENTITY_CHECK_NOTICE_VERSION;
}
