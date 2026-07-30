// The reference-sheet email, tested as content: what the shop reads must name
// the right person, show the right shots, and never let client text break the
// markup. Same approach as barberEmail.test.ts — pure input → subject/html.

import { describe, expect, test } from "vitest";
import { buildReferenceEmail } from "./referenceEmail";

const base = {
  displayName: "Fades & Co",
  clientName: "Dre",
  cutLabel: "low taper",
  shots: [
    { key: "front", url: "https://storage.test/front.jpg" },
    { key: "leftThreeQuarter", url: "https://storage.test/ltq.jpg" },
  ],
};

describe("buildReferenceEmail", () => {
  test("names the client and the cut where the shop will read them first", () => {
    const { subject, html } = buildReferenceEmail(base);
    expect(subject).toBe('Style references: Dre — "low taper"');
    expect(html).toContain("Fades &amp; Co");
    expect(html).toContain("Dre");
  });

  test("every shot lands with a readable caption", () => {
    const { html } = buildReferenceEmail(base);
    expect(html).toContain("https://storage.test/front.jpg");
    expect(html).toContain("https://storage.test/ltq.jpg");
    expect(html).toContain("Left three quarter");
  });

  test("the final ask is quoted; the cut label stands in when there is none", () => {
    expect(buildReferenceEmail({ ...base, finalPrompt: "shorter on the sides" }).html).toContain(
      "shorter on the sides",
    );
    expect(buildReferenceEmail(base).html).toContain("“low taper”");
  });

  test("client text cannot break the markup", () => {
    const { html } = buildReferenceEmail({
      ...base,
      clientName: '<img src=x onerror=alert(1)>',
      finalPrompt: '"quotes" & <tags>',
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&quot;quotes&quot; &amp; &lt;tags&gt;");
  });

  test("the video button appears only when there is a clip to watch", () => {
    expect(buildReferenceEmail({ ...base, videoUrl: "https://storage.test/take.mp4" }).html).toContain(
      "Watch the full take",
    );
    expect(buildReferenceEmail(base).html).not.toContain("Watch the full take");
  });

  test("an odd shot count still renders a complete table row", () => {
    const { html } = buildReferenceEmail({
      ...base,
      shots: [{ key: "front", url: "https://storage.test/front.jpg" }],
    });
    expect(html).toContain("<td></td>");
  });
});
