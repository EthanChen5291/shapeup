// ============================================================
// The reference-sheet email a shop gets when a chair take is approved: the
// best snapshots of the look the client settled on, plus what they asked for,
// so the person doing the cutting has the pictures in hand before the cape
// goes on.
//
// Kept pure (no fetch, no Convex imports) so the content can be unit tested
// without a network call — convex/chair.ts does the actual sending. Same
// split as convex/lib/barberEmail.ts.
// ============================================================

export interface ReferenceEmailInput {
  /** The shop/account display name, for the greeting. */
  displayName: string;
  /** Who sat in the chair — the name the barber typed at the start. */
  clientName: string;
  /** The hairstyle label the take ran with. */
  cutLabel: string;
  /** The final instruction the model was working from, if it was re-steered. */
  finalPrompt?: string;
  /** The approved reference shots, in the order they were picked. */
  shots: { key: string; url: string }[];
  /** Stable URL for the full take clip, when it survived. */
  videoUrl?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "leftThreeQuarter" → "Left three quarter" — good enough for a caption. */
function angleCaption(key: string): string {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function buildReferenceEmail(input: ReferenceEmailInput): { subject: string; html: string } {
  const subject = `Style references: ${input.clientName} — "${input.cutLabel}"`;
  const ask = input.finalPrompt?.trim() || input.cutLabel;

  const cells = input.shots.map(
    (shot) => `
        <td style="padding:6px;width:50%;vertical-align:top;">
          <img src="${escapeHtml(shot.url)}" alt="${escapeHtml(angleCaption(shot.key))}" style="display:block;width:100%;border-radius:11px;" />
          <div style="margin-top:6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8a796c;font-weight:800;text-align:center;">${escapeHtml(angleCaption(shot.key))}</div>
        </td>`,
  );
  // Two shots per row; an odd last row gets an empty cell so nothing stretches.
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(`<tr>${cells[i]}${cells[i + 1] ?? "<td></td>"}</tr>`);
  }

  const videoButton = input.videoUrl
    ? `<a href="${escapeHtml(input.videoUrl)}" style="display:block;background:#ef6b55;color:#170a07;text-decoration:none;text-align:center;font-weight:800;font-size:15px;padding:15px 20px;border-radius:12px;margin:18px 0 0;">Watch the full take</a>`
    : "";

  const html = `<!doctype html>
  <html><body style="margin:0;background:#f3eee7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#211914;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf9;border:1px solid #e8ded4;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(55,38,27,.10);">
      <div style="background:#151416;padding:22px 26px;border-bottom:3px solid #ef6b55;">
        <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#ef6b55;font-weight:800;">ShapeUp · chair reference</div>
        <div style="margin-top:8px;color:#fffaf3;font-size:24px;line-height:1.15;font-weight:800;">${escapeHtml(input.clientName)} picked a look.</div>
      </div>
      <div style="padding:26px;">
        <p style="margin:0 0 8px;font-size:16px;">Hi ${escapeHtml(input.displayName)},</p>
        <p style="margin:0 0 22px;color:#6f6258;font-size:14px;line-height:1.6;"><strong style="color:#211914;">${escapeHtml(input.clientName)}</strong> approved <strong style="color:#211914;">${escapeHtml(input.cutLabel)}</strong> in the chair. These are the reference shots of the final look.</p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#19181a;border-radius:16px;padding:6px;">${rows.join("")}</table>
        ${videoButton}

        <div style="margin-top:18px;background:#fff4e8;border-left:4px solid #ef6b55;border-radius:0 12px 12px 0;padding:16px 18px;">
          <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9b4c3c;font-weight:800;">What they asked for</div>
          <div style="margin-top:7px;font-family:Georgia,serif;font-size:17px;line-height:1.45;color:#2c211b;">“${escapeHtml(ask)}”</div>
        </div>

        <p style="color:#94867a;font-size:11px;line-height:1.55;margin:24px 0 0;">Sent automatically from your shop’s ShapeUp chair. Confirm the final cut and any adjustments with your client before you start.</p>
      </div>
    </div>
  </body></html>`;

  return { subject, html };
}
