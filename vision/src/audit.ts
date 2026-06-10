/** The VLM seatbelt (build plan §1.5.4): improv renders only — prep renders
 *  are reviewed by a human on the Bench. The mechanism is the manifest; the
 *  audit is a backstop that asks "does this image contain {hidden-entity
 *  descriptions}?" before display. Real impl (Qwen3-VL) lands with the
 *  Spark behind this interface; the mock judges a caption string so the
 *  pipeline and its tests run anywhere. */

export interface AuditVerdict { pass: boolean; flagged: string[] }

export interface ImageAuditor {
  readonly kind: "mock" | "spark";
  /** `image` is an asset ref (spark) or a caption string (mock/tests). */
  check(image: string, auditNegatives: string[]): Promise<AuditVerdict>;
}

export class MockAuditor implements ImageAuditor {
  readonly kind = "mock" as const;
  async check(caption: string, auditNegatives: string[]): Promise<AuditVerdict> {
    const lower = caption.toLowerCase();
    const flagged = auditNegatives.filter(n =>
      keywords(n).some(k => lower.includes(k)));
    return { pass: flagged.length === 0, flagged };
  }
}

/** Content words of a description — "armed figures in a loft" → figures/loft/armed. */
function keywords(desc: string): string[] {
  return desc.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4);
}

export function createAuditor(kind = process.env.HERMYS_VLM ?? "mock"): ImageAuditor {
  if (kind === "mock") return new MockAuditor();
  throw new Error(`auditor "${kind}" lands with the Spark (docs/spark-day-one.md)`);
}
