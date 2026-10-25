import { describe, expect, it } from "vitest";

import { fixtureWorkspace } from "../ams/fixture-workspace";
import { draftAnswer } from "./answer";
import { draftJustification } from "./justification";
import { controlSupport, evidenceStanding, policyStanding } from "./grounding";
import type { Evidence, Policy } from "../ams/types";

/**
 * What the drafting features must never do, however the prose is generated.
 *
 * These are deliberately not tests of the wording. The prose is stubbed today
 * and a model writes it tomorrow, so asserting on sentences would pin the one
 * thing that is meant to change and pin nothing that matters. What is pinned
 * here is the behaviour that has to survive that swap:
 *
 *   - a question the register cannot answer gets a **refusal**, not a paragraph;
 *   - a document that has expired is **cited and marked unsound**, never dropped;
 *   - confidence tracks the evidence rather than the fluency;
 *   - an applicable control is not offered an exclusion justification.
 *
 * Each is a failure that passes review and a build. A refusal path that quietly
 * stops refusing produces confident, well-formatted, wrong statements to
 * customers — indistinguishable from correct ones until somebody checks.
 */

const ws = fixtureWorkspace();

/** A question with nothing behind it — no control, no policy, no document. */
const UNSUPPORTED = {
  id: "q-test-unsupported",
  number: "T.1",
  text: "Are you certified to ISO 42001?",
  controlIds: [],
  policyIds: [],
  evidenceIds: [],
};

describe("evidenceStanding", () => {
  const base: Evidence = {
    id: "ev-test",
    title: "Test export",
    type: "configuration_export",
    ownerId: "p-anders",
    source: "manual",
    collectedAt: "2026-01-05",
    expiresAt: null,
    verificationState: "verified",
    linkedControlIds: [],
    linkedSystemIds: [],
    file: { name: "x.pdf", kind: "pdf", mime: "application/pdf", sizeKb: 10, href: "/x.pdf" },
  };

  it("treats a verified document with a file as sound", () => {
    expect(evidenceStanding(base).sound).toBe(true);
  });

  it("refuses to count a document nobody attached", () => {
    // The register looks full and proves nothing — the failure that hides.
    expect(evidenceStanding({ ...base, file: null }).sound).toBe(false);
  });

  it("refuses to count an expired document, and says so", () => {
    const result = evidenceStanding({ ...base, verificationState: "expired" });
    expect(result.sound).toBe(false);
    expect(result.detail).toMatch(/expired/i);
  });

  it("refuses to count one that lapsed by date even when marked verified", () => {
    expect(evidenceStanding({ ...base, expiresAt: "2026-01-01" }).sound).toBe(false);
  });

  it("refuses to count one that was never verified", () => {
    expect(evidenceStanding({ ...base, verificationState: "unverified" }).sound).toBe(false);
  });
});

describe("policyStanding", () => {
  const base: Policy = {
    id: "pol-test",
    title: "Test policy",
    status: "approved",
    ownerId: "p-anders",
    version: "1.0",
    approvedAt: "2026-01-01",
    nextReviewDate: "2027-01-01",
    summary: "",
  };

  it("counts only an approved policy", () => {
    expect(policyStanding(base).sound).toBe(true);
    expect(policyStanding({ ...base, status: "draft" }).sound).toBe(false);
    expect(policyStanding({ ...base, status: "in_review" }).sound).toBe(false);
    expect(policyStanding({ ...base, status: "expired" }).sound).toBe(false);
  });

  it("stops counting an approved policy once its review is overdue", () => {
    // Nobody has confirmed it still describes what the company does.
    const stale = policyStanding({ ...base, nextReviewDate: "2026-01-01" });
    expect(stale.sound).toBe(false);
    expect(stale.detail).toMatch(/overdue/i);
  });
});

describe("controlSupport", () => {
  it("carries the stored applicability rather than its label", () => {
    // The refusal gate compares this. If it ever becomes a display string, a
    // copy edit silently inverts the gate — see the comment on the field.
    const support = controlSupport(ws, ws.controls[0].id);
    expect(support).not.toBeNull();
    expect(["yes", "no", "na", null]).toContain(support!.applicability);
  });

  it("returns null for a control this organisation does not have", () => {
    expect(controlSupport(ws, "ctl-does-not-exist")).toBeNull();
  });
});

describe("draftAnswer", () => {
  it("refuses when nothing in the register stands behind the question", async () => {
    const answer = await draftAnswer(ws, UNSUPPORTED);

    expect(answer.text).toBeNull();
    expect(answer.refusal).toBeTruthy();
    expect(answer.confidence).toBe(0);
  });

  it("names what is missing rather than refusing blankly", async () => {
    // A refusal the owner cannot act on is only marginally better than a
    // fabricated answer: both leave the register exactly as wrong as it was.
    const answer = await draftAnswer(ws, UNSUPPORTED);
    expect(answer.refusal).toMatch(/nothing in the register/i);
  });

  it("refuses when the controls behind a question are not yet implemented", async () => {
    const inFlight = ws.controls.find((c) => {
      const row = ws.applicabilityFor(c.id);
      return row?.applicability === "yes" && row.implementationStatus !== "implemented";
    });
    expect(inFlight, "fixture needs a control that is applicable but unimplemented").toBeDefined();

    const answer = await draftAnswer(ws, {
      ...UNSUPPORTED,
      id: "q-test-inflight",
      controlIds: [inFlight!.id],
    });

    expect(answer.text).toBeNull();
    expect(answer.refusal).toBeTruthy();
  });

  it("answers when an implemented control stands behind the question", async () => {
    const ready = ws.controls.find((c) => {
      const row = ws.applicabilityFor(c.id);
      return row?.applicability === "yes" && row.implementationStatus === "implemented";
    });
    expect(ready, "fixture needs an implemented, applicable control").toBeDefined();

    const answer = await draftAnswer(ws, {
      ...UNSUPPORTED,
      id: "q-test-ready",
      controlIds: [ready!.id],
    });

    expect(answer.refusal).toBeNull();
    expect(answer.text).toBeTruthy();
  });

  it("cites an unsound document rather than dropping it", async () => {
    // Silently omitting the expired DPIA is what makes an answer look better
    // supported than it is — the one output worse than no answer at all.
    const withStale = ws.controls.find((c) => {
      const support = controlSupport(ws, c.id);
      return support !== null && support.evidence.length > support.sound.length;
    });

    if (!withStale) return; // No such control seeded; nothing to assert.

    const answer = await draftAnswer(ws, {
      ...UNSUPPORTED,
      id: "q-test-stale",
      controlIds: [withStale.id],
    });

    expect(answer.citations.some((c) => !c.sound)).toBe(true);
    expect(answer.caveats.length).toBeGreaterThan(0);
  });

  it("never reports full confidence", async () => {
    // A drafted answer is a first pass somebody edits. A number that reads as
    // certainty invites sending it unread.
    for (const q of ws.questionnaires.flatMap((qn) => qn.questions).slice(0, 8)) {
      const answer = await draftAnswer(ws, q);
      expect(answer.confidence).toBeLessThan(1);
      expect(answer.confidence).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("draftJustification", () => {
  it("drafts for a control that is excluded or not applicable", async () => {
    const excluded = ws.controls.find((c) => {
      const row = ws.applicabilityFor(c.id);
      return row?.applicability === "no" || row?.applicability === "na";
    });
    expect(excluded, "fixture needs an excluded control").toBeDefined();

    const result = await draftJustification(ws, excluded!.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.suggestion.status).toBe("pending");
    expect(result.suggestion.decidedById).toBeNull();
    expect(result.suggestion.target).toEqual({ kind: "control", id: excluded!.id });
    expect(result.suggestion.supportingData.length).toBeGreaterThan(0);
  });

  it("refuses to justify a control that is applicable", async () => {
    // An applicable control needs implementing, not explaining away. Drafting
    // an exclusion for one is how a control quietly leaves scope.
    const applicable = ws.controls.find(
      (c) => ws.applicabilityFor(c.id)?.applicability === "yes",
    );
    expect(applicable, "fixture needs an applicable control").toBeDefined();

    const result = await draftJustification(ws, applicable!.id);
    expect(result.ok).toBe(false);
  });

  it("refuses for a control this organisation does not have", async () => {
    const result = await draftJustification(ws, "ctl-does-not-exist");
    expect(result.ok).toBe(false);
  });

  it("never proposes itself as certain", async () => {
    const excluded = ws.controls.filter((c) => {
      const row = ws.applicabilityFor(c.id);
      return row?.applicability === "no" || row?.applicability === "na";
    });

    for (const control of excluded) {
      const result = await draftJustification(ws, control.id);
      if (!result.ok) continue;
      expect(result.suggestion.confidence).toBeLessThanOrEqual(0.88);
      expect(result.suggestion.confidence).toBeGreaterThan(0);
    }
  });

  it("gives each draft its own id, so a rejection is never overwritten", async () => {
    const excluded = ws.controls.find((c) => {
      const row = ws.applicabilityFor(c.id);
      return row?.applicability === "no" || row?.applicability === "na";
    })!;

    const first = await draftJustification(ws, excluded.id);
    await new Promise((r) => setTimeout(r, 2));
    const second = await draftJustification(ws, excluded.id);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.suggestion.id).not.toEqual(second.suggestion.id);
  });
});
