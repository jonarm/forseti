import { describe, expect, it } from "vitest";

import { APPLICABILITY } from "./fixtures/applicability";
import { EVIDENCE } from "./fixtures/documents";

/**
 * The evidence-to-control relation, held once.
 *
 * The fixtures record it twice — `ControlApplicability.linkedEvidenceIds` and
 * `Evidence.linkedControlIds` — because each screen reads it from the side it
 * happens to be standing on. The database records it once, in `ai_evidence_link`,
 * which is the right shape and also unforgiving: whichever fixture side the seed
 * writes from, the other side's extra pairs are silently dropped and every
 * readiness figure moves.
 *
 * That is not a hypothetical. It is how this test came to exist: the round-trip
 * equality check in `ai-store.test.ts` reported eleven ready controls where the
 * approved design had sixteen, and the missing five were pairs one fixture knew
 * about and the other did not.
 *
 * So the two sides must agree, and this is what says so. When the fixtures
 * eventually stop being the source of truth this test goes with them; until
 * then it is the cheapest place to catch the divergence, because it fails on
 * the edit rather than four screens later.
 */
describe("the evidence relation agrees with itself", () => {
  const fromApplicability = new Set(
    APPLICABILITY.flatMap((row) =>
      row.linkedEvidenceIds.map((evidenceId) => `${evidenceId} -> ${row.controlId}`),
    ),
  );

  const fromEvidence = new Set(
    EVIDENCE.flatMap((doc) =>
      doc.linkedControlIds.map((controlId) => `${doc.id} -> ${controlId}`),
    ),
  );

  it("claims the same pairs from the control side as from the document side", () => {
    const onlyOnControls = [...fromApplicability].filter((p) => !fromEvidence.has(p));
    const onlyOnDocuments = [...fromEvidence].filter((p) => !fromApplicability.has(p));

    expect({ onlyOnControls, onlyOnDocuments }).toEqual({
      onlyOnControls: [],
      onlyOnDocuments: [],
    });
  });

  it("names an evidence id that exists", () => {
    const known = new Set(EVIDENCE.map((doc) => doc.id));
    const dangling = APPLICABILITY.flatMap((row) =>
      row.linkedEvidenceIds.filter((id) => !known.has(id)),
    );
    expect(dangling).toEqual([]);
  });
});
