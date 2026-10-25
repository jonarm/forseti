import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "@/test/pglite";
import type {
  AISystem,
  AIUseCase,
  AssessmentInstance,
  ControlApplicability,
  Evidence,
  Finding,
  Risk,
} from "@/lib/ams/types";
import type { Actor } from "@/lib/audit";

/**
 * Tenant isolation for the AI management system.
 *
 * The same security property `store.test.ts` proves for the older tables, for
 * the seventeen new ones. Every accessor in `ai-store.ts` takes
 * `organizationId` first so that scoping is impossible to forget; these tests
 * are what prove the queries honour it rather than the signature merely
 * implying they do.
 *
 * Runs against real Postgres (PGlite) applying the real migrations, so a missing
 * WHERE clause fails here exactly as it would in production — and the new
 * migration is exercised by `npm test` without anyone remembering to.
 */

let testDb: TestDb;
let close: () => Promise<void>;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
  get schema() {
    return undefined;
  },
}));

const {
  readAiSystems,
  readAiSystem,
  saveAiSystem,
  deleteAiSystem,
  readUseCases,
  readDeletedUseCases,
  deleteUseCase,
  restoreUseCase,
  saveUseCase,
  deleteIntakeRequest,
  purgeExpiredIntakeRequests,
  readIntakeNotes,
  readIntakeRequests,
  saveIntakeNote,
  saveIntakeRequest,
  readFramework,
  readApplicability,
  saveApplicability,
  readAssessments,
  saveAssessment,
  saveAssessmentAnswers,
  readAiRisks,
  readAiRisk,
  saveAiRisk,
  deleteAiFinding,
  deleteAiRisk,
  readAiFinding,
  readAiFindings,
  restoreAiFinding,
  saveAiFinding,
  readAiEvidence,
  saveAiEvidence,
  readReviewAssignments,
  assignReviewer,
  unassignReviewer,
  readActivity,
  readActivityByKind,
  recordActivity,
  writeAudit,
  ConcurrentModificationError,
  readPeople,
  savePerson,
  readRoleGrants,
  saveRoleGrants,
  resetRoleGrants,
  readAccountPeople,
  readActingPersonId,
  linkAccountToPerson,
  unlinkAccountFromPerson,
  readAiPolicies,
  saveAiPolicy,
  readQuestionnaires,
  saveQuestionnaire,
  readSuggestions,
  saveSuggestion,
  readWorkspace,
} = await import("@/lib/ai-store");
const { seedAiManagementSystem } = await import("@/lib/ai-seed");
const { workspace } = await import("@/lib/ams/workspace");
const { fixtureWorkspace } = await import("@/lib/ams/fixture-workspace");
const {
  attentionRequired,
  attentionSummary,
  evidencePosture,
  frameworkReadiness,
  policyPosture,
  readinessByNode,
  systemPosture,
} = await import("@/lib/ams/readiness");
const { packSections, preflight } = await import("@/lib/ams/audit-pack");
const { commitments, houseRules, toolEntries } = await import(
  "@/lib/ams/trust-center"
);
const { organization, user, member, aiActivityEvent, aiSystem } = await import(
  "@/db/schema",
);

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

function makeSystem(id: string, name: string): AISystem {
  return {
    id,
    name,
    vendor: `${name} Vendor`,
    origin: "procured_saas",
    isGenAi: true,
    businessUnit: "Technology",
    ownerId: "p-devi",
    lifecycleStage: "production",
    riskTier: "limited",
    assessmentStatus: "approved",
    purpose: `${name} purpose`,
    deploymentModel: "vendor_multi_tenant",
    hostingRegions: ["EU West"],
    dataResidency: "EU",
    userGroups: ["All staff"],
    approxUsers: 10,
    dataCategories: ["internal"],
    characteristics: ["generative"],
    vendorDetail: {
      name: `${name} Vendor`,
      subProcessors: ["AWS"],
      modelProvider: "OpenAI",
      contractType: "enterprise_agreement",
      dataProcessingAgreement: true,
      certifications: ["ISO 27001"],
      trainsOnCustomerData: false,
      renewalDate: "2027-01-01",
    },
    registeredAt: "2026-01-01",
    nextReviewDate: "2027-01-01",
    discoveredVia: "manual",
  };
}

function makeUseCase(id: string, ...systemIds: string[]): AIUseCase {
  return {
    id,
    systemIds,
    systemOverrides: [],
    name: `${id} use`,
    description: "Description",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "high",
    oversightLevel: "human_on_the_loop",
    oversightSummary: "Monitored",
    facesCustomers: true,
    informsDecisionsAboutPeople: true,
    dataCategories: ["personal"],
    approxUsers: 5,
    status: "active",
    assessmentId: null,
  };
}

/** An assessment part way through its chain, for the blocks that need one. */
function makeAssessmentFor(
  id: string,
  systemId: string,
  useCaseId: string | null,
): AssessmentInstance {
  return {
    id,
    templateId: "tpl-ai-impact-v2",
    systemId,
    useCaseId,
    status: "in_progress" as const,
    answers: {},
    signOff: [
      { stage: "owner_submit", label: "Owner submits", assigneeId: "p-devi", state: "complete" as const, completedAt: "2026-06-04" },
      { stage: "governance_endorse", label: "Governance Lead endorses", assigneeId: "p-anders", state: "complete" as const, completedAt: "2026-06-19" },
      { stage: "approver_approve", label: "Approver accepts residual risk", assigneeId: "p-oyelaran", state: "current" as const, completedAt: null },
    ],
    updatedAt: "2026-06-19",
    dueAt: "2026-09-15",
  };
}

function makeRisk(id: string, residual: [number, number]): Risk {
  return {
    id,
    title: `${id} title`,
    systemId: null,
    useCaseId: null,
    controlIds: ["ctl-a9-2"],
    inherentLikelihood: 4,
    inherentImpact: 4,
    treatment: "mitigate",
    treatmentSummary: "Treated",
    residualLikelihood: residual[0] as Risk["residualLikelihood"],
    residualImpact: residual[1] as Risk["residualImpact"],
    ownerId: "p-devi",
    status: "treated",
    acceptedById: "p-oyelaran",
    acceptedAt: "2026-07-02",
  };
}

function makeFinding(id: string): Finding {
  return {
    id,
    title: `${id} title`,
    severity: "high",
    status: "open",
    source: "internal_audit",
    raisedBy: "Internal Audit",
    raisedAt: "2026-05-14",
    dueAt: "2026-09-30",
    ownerId: "p-anders",
    systemId: null,
    controlId: "ctl-a10-2",
    summary: "Summary",
    rootCause: null,
    correctiveAction: null,
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  };
}

function makeEvidence(id: string, controlIds: string[], systemIds: string[]): Evidence {
  return {
    id,
    title: `${id} title`,
    type: "contract",
    ownerId: "p-larsen",
    source: "Contract repository",
    collectedAt: "2026-01-01",
    expiresAt: "2027-01-01",
    verificationState: "verified",
    linkedControlIds: controlIds,
    linkedSystemIds: systemIds,
    file: null,
  };
}

function makeApplicability(controlId: string, systemIds: string[]): ControlApplicability {
  return {
    frameworkId: "iso-42001",
    controlId,
    applicability: "yes",
    justification: "Applicable",
    implementationStatus: "implemented",
    ownerId: "p-anders",
    linkedPolicyId: "pol-ai-use",
    linkedEvidenceIds: [],
    appliesToSystemIds: systemIds,
    lastReviewedAt: "2026-06-25",
  };
}

beforeAll(async () => {
  ({ db: testDb, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await testDb.delete(member);
  await testDb.delete(organization);
  await testDb.delete(user);

  for (const [id, slug] of [
    [ORG_A, "org-a"],
    [ORG_B, "org-b"],
  ]) {
    await testDb
      .insert(organization)
      .values({ id, name: id, slug, createdAt: new Date() });
  }
});

/**
 * The actor every write in this suite passes.
 *
 * Not a fixture detail — it is the second half of the signature under test. The
 * store cannot be called without one, which is the whole point of threading it
 * through, so a test that wants to write has to name somebody the same way a
 * route does.
 */
const ACTOR: Actor = { userId: "user-tester" };

/* ------------------------------------------------------------------ systems */

describe("ai systems", () => {
  it("round-trips every field, including the nullable ones", async () => {
    const system = makeSystem("sys-1", "Copilot");
    system.discoveredVia = null;
    system.ownerId = "";
    await saveAiSystem(ORG_A, system, ACTOR);

    const [read] = await readAiSystems(ORG_A);
    expect(read.name).toBe("Copilot");
    expect(read.discoveredVia).toBeNull();
    expect(read.ownerId).toBe("");
    expect(read.hostingRegions).toEqual(["EU West"]);
    expect(read.vendorDetail.subProcessors).toEqual(["AWS"]);
    expect(read.vendorDetail.trainsOnCustomerData).toBe(false);
  });

  it("never lets one organization read another's rows", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);

    expect((await readAiSystems(ORG_A)).map((s) => s.id)).toEqual(["sys-a"]);
    expect((await readAiSystems(ORG_B)).map((s) => s.id)).toEqual(["sys-b"]);
    // Knowing the id is not enough.
    expect(await readAiSystem(ORG_A, "sys-b")).toBeNull();
  });

  it("refuses to delete another organization's rows", async () => {
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);
    await deleteAiSystem(ORG_A, "sys-b", ACTOR);
    expect(await readAiSystems(ORG_B)).toHaveLength(1);
  });

  it("upserts on a re-import rather than duplicating", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "First"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Renamed"), ACTOR);

    const rows = await readAiSystems(ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Renamed");
  });
});

/* ---------------------------------------------------------------- use cases */

describe("use cases", () => {
  it("never lets one organization read another's rows", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await saveUseCase(ORG_B, makeUseCase("uc-b", "sys-b"), ACTOR);

    expect((await readUseCases(ORG_A)).map((u) => u.id)).toEqual(["uc-a"]);
    // Filtering by another tenant's system id returns nothing rather than theirs.
    expect(await readUseCases(ORG_A, "sys-b")).toEqual([]);
  });

  it("round-trips several systems, and replaces links rather than merging them", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-b", "Beta"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-c", "Gamma"), ACTOR);

    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a", "sys-b"), ACTOR);
    let [read] = await readUseCases(ORG_A);
    expect(read.systemIds.sort()).toEqual(["sys-a", "sys-b"]);

    /* The caller sends the complete set it wants, the same contract every other
     * link table here has. A merge would make removing a system impossible. */
    await saveUseCase(
      ORG_A,
      { ...makeUseCase("uc-a", "sys-c"), version: read.version },
      ACTOR,
    );
    [read] = await readUseCases(ORG_A);
    expect(read.systemIds).toEqual(["sys-c"]);
  });

  it("round-trips a pair-level override, and keeps it through an unrelated save", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-b", "Beta"), ACTOR);

    await saveUseCase(
      ORG_A,
      {
        ...makeUseCase("uc-a", "sys-a", "sys-b"),
        riskTier: "limited",
        systemOverrides: [
          {
            systemId: "sys-b",
            riskTier: "high",
            oversightLevel: "none",
            oversightSummary: "Nobody reviews it here",
          },
        ],
      },
      ACTOR,
    );

    let [read] = await readUseCases(ORG_A);
    expect(read.systemOverrides).toEqual([
      {
        systemId: "sys-b",
        riskTier: "high",
        oversightLevel: "none",
        oversightSummary: "Nobody reviews it here",
      },
    ]);

    /* The links are replaced wholesale on every save, so an override not
     * carried through is an override silently discarded by an edit that had
     * nothing to do with it. */
    await saveUseCase(ORG_A, { ...read, name: "Renamed" }, ACTOR, {
      expectedVersion: read.version,
    });
    [read] = await readUseCases(ORG_A);
    expect(read.name).toBe("Renamed");
    expect(read.systemOverrides).toHaveLength(1);
  });

  it("lists no override for a pairing that does not differ", async () => {
    /* Sparse on purpose: a row of nulls for every link would make "does this
     * pairing differ" a question about field contents rather than membership. */
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);

    const [read] = await readUseCases(ORG_A);
    expect(read.systemIds).toEqual(["sys-a"]);
    expect(read.systemOverrides).toEqual([]);
  });

  it("finds a shared use case from either system", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-b", "Beta"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a", "sys-b"), ACTOR);

    // The by-system read narrows the list without narrowing the rows: each one
    // still carries every system it reaches.
    for (const systemId of ["sys-a", "sys-b"]) {
      const rows = await readUseCases(ORG_A, systemId);
      expect(rows.map((u) => u.id)).toEqual(["uc-a"]);
      expect(rows[0].systemIds.sort()).toEqual(["sys-a", "sys-b"]);
    }
  });

  it("drops a link naming another organization's system", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);

    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a", "sys-b"), ACTOR);

    // Filtered through the org's own inventory, so the forged link never lands
    // — and the legitimate one still does.
    const [read] = await readUseCases(ORG_A);
    expect(read.systemIds).toEqual(["sys-a"]);
  });

  it("keeps a use case alive while any one of its systems is", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-b", "Beta"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a", "sys-b"), ACTOR);

    await deleteAiSystem(ORG_A, "sys-a", ACTOR);

    /* A purpose two tools serve does not stop being a governed purpose because
     * one of them was retired. The dead system is stripped from the row rather
     * than the row being dropped. */
    const stillThere = (await readWorkspace(ORG_A, {})).useCases;
    expect(stillThere.map((u) => u.id)).toEqual(["uc-a"]);
    expect(stillThere[0].systemIds).toEqual(["sys-b"]);

    await deleteAiSystem(ORG_A, "sys-b", ACTOR);
    expect((await readWorkspace(ORG_A, {})).useCases).toEqual([]);
  });

  it("carries the two questions that drive the assessment", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);

    const [read] = await readUseCases(ORG_A);
    expect(read.facesCustomers).toBe(true);
    expect(read.informsDecisionsAboutPeople).toBe(true);
    expect(read.oversightLevel).toBe("human_on_the_loop");
  });

  it("round-trips every field, including the nullable ones", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(
      ORG_A,
      {
        ...makeUseCase("uc-a", "sys-a"),
        // The two the column allows to be empty: an unowned use case is a real
        // state, and no data category is not the same as not asked.
        ownerId: "",
        dataCategories: [],
      },
      ACTOR,
    );

    const [read] = await readUseCases(ORG_A);
    expect(read.ownerId).toBe("");
    expect(read.dataCategories).toEqual([]);
    // Derived from the assessment side, so it is null until one names this row.
    expect(read.assessmentId).toBeNull();
    expect(read.version).toBe(1);
  });

  it("hides a removed use case from every read", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-b", "sys-a"), ACTOR);

    await deleteUseCase(ORG_A, "uc-a", ACTOR);

    expect((await readUseCases(ORG_A)).map((u) => u.id)).toEqual(["uc-b"]);
    // The by-system read filters the tombstone too, not just the unfiltered one.
    expect((await readUseCases(ORG_A, "sys-a")).map((u) => u.id)).toEqual(["uc-b"]);
    expect((await readDeletedUseCases(ORG_A)).map((u) => u.id)).toEqual(["uc-a"]);
  });

  it("refuses to delete another organization's rows", async () => {
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);
    await saveUseCase(ORG_B, makeUseCase("uc-b", "sys-b"), ACTOR);

    // The id is right and the organisation is not, which is the only shape this
    // failure ever takes.
    await deleteUseCase(ORG_A, "uc-b", ACTOR);

    expect((await readUseCases(ORG_B)).map((u) => u.id)).toEqual(["uc-b"]);
    expect(await readDeletedUseCases(ORG_B)).toEqual([]);
  });

  it("upserts on a re-import rather than duplicating", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await saveUseCase(
      ORG_A,
      { ...makeUseCase("uc-a", "sys-a"), riskTier: "minimal" },
      ACTOR,
    );

    const rows = await readUseCases(ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].riskTier).toBe("minimal");
    expect(rows[0].version).toBe(2);
  });

  it("clears the tombstone when a removed row is saved again", async () => {
    /* An upsert onto a soft-deleted row is an ordinary update, so without the
     * explicit clear the save appears to succeed and the row stays invisible. */
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await deleteUseCase(ORG_A, "uc-a", ACTOR);

    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);

    expect((await readUseCases(ORG_A)).map((u) => u.id)).toEqual(["uc-a"]);
    expect(await readDeletedUseCases(ORG_A)).toEqual([]);
  });

  it("restores without counting as an edit", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await deleteUseCase(ORG_A, "uc-a", ACTOR);

    expect(await restoreUseCase(ORG_A, "uc-a", ACTOR)).toBe(true);
    // A restore is not an edit, so the version it was read at still saves.
    expect((await readUseCases(ORG_A))[0].version).toBe(2);
    // Nothing to restore twice.
    expect(await restoreUseCase(ORG_A, "uc-a", ACTOR)).toBe(false);
  });

  it("refuses a save against a version somebody else has moved past", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);

    await expect(
      saveUseCase(
        ORG_A,
        { ...makeUseCase("uc-a", "sys-a"), riskTier: "minimal" },
        ACTOR,
        { expectedVersion: 1 },
      ),
    ).rejects.toThrow(/changed by somebody else/i);

    expect((await readUseCases(ORG_A))[0].riskTier).toBe("high");
  });

  it("leaves a signed assessment alone when the tier moves", async () => {
    /*
     * The invalidation this write deliberately does *not* make. Raising the tier
     * arguably ought to disturb an assessment signed against the old one, and
     * every invalidation in the store is same-record — so the honest form is a
     * staleness mark on the assessment, not a silent reset from over here.
     * Asserted against a real assessment with real signatures, because an
     * assertion made in a tenant with no assessment in it would pass whatever
     * this write did.
     */
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(
      ORG_A,
      { ...makeUseCase("uc-a", "sys-a"), riskTier: "minimal" },
      ACTOR,
    );
    await saveAssessment(ORG_A, makeAssessmentFor("asmt-uc", "sys-a", "uc-a"), ACTOR);

    // Opening it wrote its own row; what matters is that nothing is added after.
    const before = (await readActivityByKind(ORG_A, "assessment")).length;

    await saveUseCase(
      ORG_A,
      { ...makeUseCase("uc-a", "sys-a"), riskTier: "unacceptable" },
      ACTOR,
    );

    const [assessment] = await readAssessments(ORG_A);
    expect(assessment.id).toBe("asmt-uc");
    // The two signatures already given are still given.
    expect(assessment.signOff[0].state).toBe("complete");
    expect(assessment.signOff[1].state).toBe("complete");
    expect(await readActivityByKind(ORG_A, "assessment")).toHaveLength(before);
  });

  it("keeps the assessment that names a use case when the use case is removed", async () => {
    /*
     * A removal is not a reset either. The assessment is a record in its own
     * right with its own tombstone; it stays on its register, and the sign-off
     * chain it earned stays with it. `assessment-register.tsx` is what makes the
     * dangling id readable — it names the removal rather than falling through to
     * "System-level assessment", which would be the screen asserting the
     * assessment covers the whole system when it covers one removed use of it.
     */
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-a", "sys-a"), ACTOR);
    await saveAssessment(ORG_A, makeAssessmentFor("asmt-uc", "sys-a", "uc-a"), ACTOR);

    await deleteUseCase(ORG_A, "uc-a", ACTOR);

    const data = await readWorkspace(ORG_A, {});
    expect(data.useCases.map((u) => u.id)).not.toContain("uc-a");
    // Still on the register, still pointing at the use case it was opened for.
    const assessment = data.assessments.find((a) => a.id === "asmt-uc");
    expect(assessment).toBeDefined();
    expect(assessment?.useCaseId).toBe("uc-a");
    expect(assessment?.signOff[1].state).toBe("complete");
  });
});

/* ------------------------------------------------------------------ intake */

describe("intake requests", () => {
  it("never lets one organization read another's rows", async () => {
    const base = {
      submission: {
        name: "Tool",
        description: "d",
        businessUnit: "Legal",
        origin: "procured_saas" as const,
        isGenAi: true,
        vendor: "V",
        dataCategories: [],
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        originAnswers: {},
      },
      submittedById: "p-devi",
      submittedAt: "2026-08-01",
      status: "awaiting_decision" as const,
      reviewerId: "p-anders",
      reviewType: null,
      overrideJustification: null,
      decision: null,
      decidedById: null,
      decidedAt: null,
      comments: "",
      createdSystemId: null,
    };

    await saveIntakeRequest(ORG_A, { id: "req-a", reference: "REQ-1", ...base }, ACTOR);
    await saveIntakeRequest(ORG_B, { id: "req-b", reference: "REQ-1", ...base }, ACTOR);

    // The same reference in two tenants is legal — the unique index is scoped.
    expect((await readIntakeRequests(ORG_A)).map((r) => r.id)).toEqual(["req-a"]);
    expect((await readIntakeRequests(ORG_B)).map((r) => r.id)).toEqual(["req-b"]);
  });
});

/* ------------------------------------------------------------ intake notes */

describe("intake notes", () => {
  function makeRequest(id: string) {
    return {
      id,
      reference: `REQ-${id}`,
      submission: {
        name: "Otter",
        description: "",
        businessUnit: "Sales",
        origin: "procured_saas" as const,
        isGenAi: true,
        vendor: "V",
        dataCategories: [],
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        originAnswers: {},
      },
      submittedById: "p-devi",
      submittedAt: "2026-08-01",
      status: "noted" as const,
      reviewerId: "p-anders",
      reviewType: "noting" as const,
      overrideJustification: null,
      decision: "note",
      decidedById: "p-anders",
      decidedAt: "2026-08-02",
      comments: "Recorded.",
      createdSystemId: null,
    };
  }

  const note = (id: string, requestId: string, body: string, at: string) => ({
    id,
    requestId,
    authorId: "p-anders",
    body,
    createdAt: at,
  });

  beforeEach(async () => {
    await saveIntakeRequest(ORG_A, makeRequest("req-a"), ACTOR);
    await saveIntakeRequest(ORG_B, makeRequest("req-b"), ACTOR);
  });

  it("round-trips every field, including the nullable ones", async () => {
    await saveIntakeNote(
      ORG_A,
      { ...note("note-1", "req-a", "DPA came back signed.", "2026-08-10T09:00:00.000Z"), authorId: null },
      ACTOR,
    );

    const [row] = await readIntakeNotes(ORG_A, "req-a");
    expect(row.body).toBe("DPA came back signed.");
    // An account with nobody behind it records nobody, never a guess.
    expect(row.authorId).toBeNull();
    expect(row.createdAt).toBe("2026-08-10T09:00:00.000Z");
  });

  it("reads oldest first, because it is a conversation", async () => {
    await saveIntakeNote(ORG_A, note("note-2", "req-a", "Second", "2026-08-11T09:00:00.000Z"), ACTOR);
    await saveIntakeNote(ORG_A, note("note-1", "req-a", "First", "2026-08-10T09:00:00.000Z"), ACTOR);

    expect((await readIntakeNotes(ORG_A, "req-a")).map((n) => n.body)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("never lets one organization read another's rows", async () => {
    await saveIntakeNote(ORG_A, note("note-1", "req-a", "Ours", "2026-08-10T09:00:00.000Z"), ACTOR);
    await saveIntakeNote(ORG_B, note("note-2", "req-b", "Theirs", "2026-08-10T09:00:00.000Z"), ACTOR);

    expect((await readIntakeNotes(ORG_A, "req-a")).map((n) => n.body)).toEqual(["Ours"]);
    expect((await readIntakeNotes(ORG_B, "req-b")).map((n) => n.body)).toEqual(["Theirs"]);
    // And the id alone is not enough to reach across.
    expect(await readIntakeNotes(ORG_A, "req-b")).toEqual([]);
  });

  it("refuses a note aimed at another organization's request", async () => {
    const added = await saveIntakeNote(
      ORG_A,
      note("note-1", "req-b", "Not yours", "2026-08-10T09:00:00.000Z"),
      ACTOR,
    );

    /* The composite foreign key would refuse this as a constraint violation;
     * resolving the parent inside the caller's organisation first turns it into
     * an answer the route can return as a 404. */
    expect(added).toBe(false);
    expect(await readIntakeNotes(ORG_B, "req-b")).toEqual([]);
  });

  it("refuses a note on a request that is in the trash", async () => {
    await deleteIntakeRequest(ORG_A, "req-a", ACTOR);

    const added = await saveIntakeNote(
      ORG_A,
      note("note-1", "req-a", "Too late", "2026-08-10T09:00:00.000Z"),
      ACTOR,
    );

    // A soft-deleted request is gone as far as every read is concerned, and the
    // foreign key cannot see the tombstone — this is the half that can.
    expect(added).toBe(false);
  });

  it("cannot rewrite a note by resending its id", async () => {
    await saveIntakeNote(ORG_A, note("note-1", "req-a", "As written", "2026-08-10T09:00:00.000Z"), ACTOR);

    /* An insert, not an upsert. Every other write in this file corrects a row
     * by id; a note has nothing to correct, and being unable to is the property
     * the whole table exists for. */
    await expect(
      saveIntakeNote(ORG_A, note("note-1", "req-a", "Rewritten", "2026-08-11T09:00:00.000Z"), ACTOR),
    ).rejects.toThrow();

    expect((await readIntakeNotes(ORG_A, "req-a")).map((n) => n.body)).toEqual([
      "As written",
    ]);
  });

  it("goes when the purge finally removes the request", async () => {
    await saveIntakeNote(ORG_A, note("note-1", "req-a", "Kept until then", "2026-08-10T09:00:00.000Z"), ACTOR);
    await deleteIntakeRequest(ORG_A, "req-a", ACTOR);

    // Far enough past the retention window that the request is collected.
    const later = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    await purgeExpiredIntakeRequests(ORG_A, later);

    /* The composite foreign key cascades, which is what clears these — the
     * retention window is the one thing that removes a note, and it removes the
     * request with it. */
    expect(await readIntakeNotes(ORG_A, "req-a")).toEqual([]);
  });
});

/* ----------------------------------------------------- framework and the SoA */

describe("framework and applicability", () => {
  beforeEach(async () => {
    await seedAiManagementSystem(ORG_A);
  });

  it("reads a framework with its tree in one call", async () => {
    const bundle = await readFramework(ORG_A, "iso-42001");
    expect(bundle.framework?.shortName).toBe("ISO 42001");
    expect(bundle.nodes.length).toBeGreaterThan(10);
    expect(bundle.controls.length).toBeGreaterThan(40);
    // The prohibition the schema encodes: no clause text, only our own prose.
    expect(bundle.controls[0]).not.toHaveProperty("officialText");
  });

  it("never lets one organization read another's framework", async () => {
    const bundle = await readFramework(ORG_B, "iso-42001");
    expect(bundle.framework).toBeNull();
    expect(bundle.controls).toEqual([]);
    expect(await readApplicability(ORG_B, "iso-42001")).toEqual([]);
  });

  it("replaces system claims rather than merging them", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-x", "X"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-y", "Y"), ACTOR);

    await saveApplicability(ORG_A, makeApplicability("ctl-5-2", ["sys-x", "sys-y"]), ACTOR);
    let row = (await readApplicability(ORG_A, "iso-42001")).find(
      (r) => r.controlId === "ctl-5-2",
    );
    expect(row?.appliesToSystemIds.sort()).toEqual(["sys-x", "sys-y"]);

    await saveApplicability(ORG_A, makeApplicability("ctl-5-2", ["sys-x"]), ACTOR);
    row = (await readApplicability(ORG_A, "iso-42001")).find(
      (r) => r.controlId === "ctl-5-2",
    );
    expect(row?.appliesToSystemIds).toEqual(["sys-x"]);
  });

  it("drops a claim naming another organization's system", async () => {
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);
    await saveApplicability(ORG_A, makeApplicability("ctl-5-2", ["sys-b"]), ACTOR);

    const row = (await readApplicability(ORG_A, "iso-42001")).find(
      (r) => r.controlId === "ctl-5-2",
    );
    // Filtered through the org's own systems, so the forged link never lands.
    expect(row?.appliesToSystemIds).toEqual([]);
  });
});

/* ------------------------------------------------------------- assessments */

describe("assessments", () => {
  beforeEach(async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAssessment(ORG_A, {
      id: "asmt-1",
      templateId: "tpl-ai-impact-v2",
      systemId: "sys-a",
      useCaseId: null,
      status: "in_progress",
      answers: {},
      signOff: [
        { stage: "owner_submit", label: "Owner submits", assigneeId: "p-devi", state: "complete", completedAt: "2026-06-04" },
        { stage: "governance_endorse", label: "Governance Lead endorses", assigneeId: "p-anders", state: "complete", completedAt: "2026-06-19" },
        { stage: "approver_approve", label: "Approver accepts residual risk", assigneeId: "p-oyelaran", state: "current", completedAt: null },
      ],
      updatedAt: "2026-06-19",
      dueAt: "2026-09-15",
    },
      ACTOR,
    );
  });

  it("stores answers as rows and reads them back as one bag", async () => {
    await saveAssessmentAnswers(ORG_A, "asmt-1", {
      intended_use: "Drafting",
      informs_decisions_about_people: false,
      affected_groups: ["applicants"],
    },
      ACTOR,
    );

    const [read] = await readAssessments(ORG_A);
    expect(read.answers.intended_use).toBe("Drafting");
    expect(read.answers.informs_decisions_about_people).toBe(false);
    expect(read.answers.affected_groups).toEqual(["applicants"]);
  });

  it("a material change resets the reviews, and a plain edit does not", async () => {
    await saveAssessmentAnswers(ORG_A, "asmt-1", { intended_use: "Typo fixed" }, ACTOR);
    let [read] = await readAssessments(ORG_A);
    expect(read.signOff[1].state).toBe("complete");

    await saveAssessmentAnswers(
      ORG_A,
      "asmt-1",
      { informs_decisions_about_people: true },
      ACTOR,
      { materialChange: true },
    );
    [read] = await readAssessments(ORG_A);
    // The endorser reviewed a document with a different set of questions in it.
    expect(read.signOff[0].state).toBe("current");
    expect(read.signOff[1].state).toBe("pending");
    expect(read.signOff[1].completedAt).toBeNull();
  });

  it("refuses to write answers into another organization's assessment", async () => {
    await saveAssessmentAnswers(ORG_B, "asmt-1", { intended_use: "Injected" }, ACTOR);

    const [read] = await readAssessments(ORG_A);
    expect(read.answers.intended_use).toBeUndefined();
    expect(await readAssessments(ORG_B)).toEqual([]);
  });
});

/* -------------------------------------------------------------------- risks */

describe("ai risks", () => {
  it("round-trips the 5x5 rating and the acceptance", async () => {
    await saveAiRisk(ORG_A, makeRisk("risk-1", [2, 4]), ACTOR);

    const [read] = await readAiRisks(ORG_A);
    expect(read.inherentLikelihood).toBe(4);
    expect(read.residualImpact).toBe(4);
    expect(read.acceptedById).toBe("p-oyelaran");
    expect(read.controlIds).toEqual(["ctl-a9-2"]);
  });

  it("voids the acceptance when the residual it was given against moves", async () => {
    await saveAiRisk(ORG_A, makeRisk("risk-1", [2, 4]), ACTOR);

    const moved = makeRisk("risk-1", [5, 5]);
    await saveAiRisk(ORG_A, moved, ACTOR);

    const [read] = await readAiRisks(ORG_A);
    expect(read.residualLikelihood).toBe(5);
    // A signature belongs to the number it was given against.
    expect(read.acceptedById).toBeNull();
    expect(read.acceptedAt).toBeNull();
  });

  it("leaves the acceptance alone when the residual has not moved", async () => {
    await saveAiRisk(ORG_A, makeRisk("risk-1", [2, 4]), ACTOR);
    const edited = { ...makeRisk("risk-1", [2, 4]), treatmentSummary: "Reworded" };
    await saveAiRisk(ORG_A, edited, ACTOR);

    const [read] = await readAiRisks(ORG_A);
    expect(read.acceptedById).toBe("p-oyelaran");
    expect(read.treatmentSummary).toBe("Reworded");
  });

  it("never lets one organization read another's rows", async () => {
    await saveAiRisk(ORG_A, makeRisk("risk-a", [2, 2]), ACTOR);
    await saveAiRisk(ORG_B, makeRisk("risk-b", [3, 3]), ACTOR);

    expect((await readAiRisks(ORG_A)).map((r) => r.id)).toEqual(["risk-a"]);
    expect((await readAiRisks(ORG_B)).map((r) => r.id)).toEqual(["risk-b"]);
  });

  it("refuses to delete another organization's rows", async () => {
    await saveAiRisk(ORG_B, makeRisk("risk-b", [2, 2]), ACTOR);
    await deleteAiRisk(ORG_A, "risk-b", ACTOR);
    expect(await readAiRisks(ORG_B)).toHaveLength(1);
  });
});

/* ----------------------------------------------------------------- findings */

describe("ai findings", () => {
  it("round-trips the closure fields, including the nullable ones", async () => {
    await saveAiFinding(ORG_A, makeFinding("fnd-1"), ACTOR);

    const [read] = await readAiFindings(ORG_A);
    expect(read.source).toBe("internal_audit");
    expect(read.rootCause).toBeNull();
    expect(read.verifiedById).toBeNull();
    expect(read.closedAt).toBeNull();
  });

  it("never lets one organization read another's rows", async () => {
    await saveAiFinding(ORG_A, makeFinding("fnd-a"), ACTOR);
    await saveAiFinding(ORG_B, makeFinding("fnd-b"), ACTOR);

    expect((await readAiFindings(ORG_A)).map((f) => f.id)).toEqual(["fnd-a"]);
    expect((await readAiFindings(ORG_B)).map((f) => f.id)).toEqual(["fnd-b"]);
  });
});

/* ----------------------------------------------------------------- evidence */

describe("ai evidence", () => {
  it("hides a soft-deleted finding from the register and from its own page", async () => {
    await saveAiFinding(ORG_A, makeFinding("fnd-1"), ACTOR);
    await saveAiFinding(ORG_A, makeFinding("fnd-2"), ACTOR);

    await deleteAiFinding(ORG_A, "fnd-1", ACTOR);

    expect((await readAiFindings(ORG_A)).map((f) => f.id)).toEqual(["fnd-2"]);
    /* The single read filters too. Without it a removed finding stays reachable
     * by typing its URL, which is the register saying two different things
     * about one row. */
    expect(await readAiFinding(ORG_A, "fnd-1")).toBeNull();
  });

  it("refuses to delete another organization's rows", async () => {
    await saveAiFinding(ORG_B, makeFinding("fnd-b"), ACTOR);
    await deleteAiFinding(ORG_A, "fnd-b", ACTOR);
    expect(await readAiFindings(ORG_B)).toHaveLength(1);
  });

  it("brings a restored finding back with its fields intact", async () => {
    await saveAiFinding(ORG_A, makeFinding("fnd-1"), ACTOR);
    await deleteAiFinding(ORG_A, "fnd-1", ACTOR);

    expect(await restoreAiFinding(ORG_A, "fnd-1", ACTOR)).toBe(true);
    const [back] = await readAiFindings(ORG_A);
    expect(back.id).toBe("fnd-1");
    expect(back.controlId).toBe("ctl-a10-2");

    // Restoring something that is already there is not an error, and not a
    // second trail entry either.
    expect(await restoreAiFinding(ORG_A, "fnd-1", ACTOR)).toBe(false);
  });

  it("round-trips both kinds of link through one table", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-a", "Alpha"), ACTOR);
    await saveAiEvidence(ORG_A, makeEvidence("ev-1", ["ctl-a10-2", "ctl-a10-3"], ["sys-a"]), ACTOR);

    const [read] = await readAiEvidence(ORG_A);
    expect(read.linkedControlIds.sort()).toEqual(["ctl-a10-2", "ctl-a10-3"]);
    expect(read.linkedSystemIds).toEqual(["sys-a"]);
    expect(read.file).toBeNull();
  });

  it("replaces links rather than merging them", async () => {
    await saveAiEvidence(ORG_A, makeEvidence("ev-1", ["ctl-a", "ctl-b"], []), ACTOR);
    await saveAiEvidence(ORG_A, makeEvidence("ev-1", ["ctl-a"], []), ACTOR);

    const [read] = await readAiEvidence(ORG_A);
    expect(read.linkedControlIds).toEqual(["ctl-a"]);
  });

  it("never lets one organization read another's rows", async () => {
    await saveAiEvidence(ORG_A, makeEvidence("ev-a", ["ctl-x"], []), ACTOR);
    await saveAiEvidence(ORG_B, makeEvidence("ev-b", ["ctl-y"], []), ACTOR);

    expect((await readAiEvidence(ORG_A)).map((e) => e.id)).toEqual(["ev-a"]);
    // The link table is scoped too — otherwise one tenant's control would show
    // another's document against it.
    expect((await readAiEvidence(ORG_A))[0].linkedControlIds).toEqual(["ctl-x"]);
  });
});

/* ----------------------------------------------------------------- activity */

describe("activity", () => {
  it("never lets one organization read another's trail", async () => {
    await recordActivity(ORG_A, {
      id: "act-a",
      subjectKind: "system",
      subjectId: "sys-1",
      actorId: "p-anders",
      action: "changed the risk tier",
      field: "Risk tier",
      before: "Limited",
      after: "High",
      reason: null,
      viaSuggestionId: null,
    });
    await recordActivity(ORG_B, {
      id: "act-b",
      subjectKind: "system",
      subjectId: "sys-1",
      actorId: "p-devi",
      action: "changed the risk tier",
      field: "Risk tier",
      before: "High",
      after: "Minimal",
      reason: null,
      viaSuggestionId: null,
    });

    // Same subject id in both tenants — only the scope separates them.
    const a = await readActivity(ORG_A, "sys-1");
    expect(a).toHaveLength(1);
    expect(a[0].after).toBe("High");
    expect(await readActivity(ORG_B, "sys-1")).toHaveLength(1);
  });

  it("round-trips the reason and the subject kind", async () => {
    await recordActivity(ORG_A, {
      id: "act-reason",
      subjectKind: "risk",
      subjectId: "risk-1",
      actorId: "user-1",
      action: "accepted the residual",
      field: "status",
      before: "open",
      after: "accepted",
      reason: "Accepted for twelve months; compensating review is in place.",
      viaSuggestionId: null,
    });

    const [event] = await readActivity(ORG_A, "risk-1");
    expect(event.subjectKind).toBe("risk");
    expect(event.reason).toMatch(/twelve months/);
  });
});


/**
 * An account with a seat in an organization.
 *
 * At module scope because two properties need it — an assignment names a member
 * and so does an account-to-person link — and a second copy is a second thing to
 * keep in step with `member`'s columns.
 */
async function aMember(userId: string, organizationId = ORG_A) {
  await testDb
    .insert(user)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  await testDb
    .insert(member)
    .values({
      id: `mem-${organizationId}-${userId}`,
      organizationId,
      userId,
      role: "reviewer",
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return userId;
}

/* --------------------------------------------------- review assignments */

/**
 * Legal, Security and the exec sponsor are assignments, not roles.
 *
 * The property that makes that design work rather than merely sound tidy: an
 * assignment names an account inside *this* organization, and any other id is
 * refused. A reviewer from another tenant would render as a perfectly ordinary
 * name on the screen, which is what makes the failure worth a test.
 */
describe("review assignments", () => {
  it("names one reviewer per stage, and reads them back", async () => {
    await aMember("user-legal");
    await aMember("user-security");

    await assignReviewer(
      ORG_A,
      {
        subjectKind: "assessment",
        subjectId: "asmt-1",
        stage: "legal",
        assigneeUserId: "user-legal",
      },
      ACTOR,
    );
    await assignReviewer(
      ORG_A,
      {
        subjectKind: "assessment",
        subjectId: "asmt-1",
        stage: "security",
        assigneeUserId: "user-security",
      },
      ACTOR,
    );

    const rows = await readReviewAssignments(ORG_A, {
      kind: "assessment",
      id: "asmt-1",
    });
    expect(rows.map((r) => [r.stage, r.assigneeUserId])).toEqual([
      ["legal", "user-legal"],
      ["security", "user-security"],
    ]);
  });

  it("treats a second assignment to a stage as a reassignment", async () => {
    // Two people who each think the other is reviewing it is the failure the
    // composite key prevents.
    await aMember("user-a");
    await aMember("user-b");

    const stage = {
      subjectKind: "assessment" as const,
      subjectId: "asmt-1",
      stage: "legal",
    };
    await assignReviewer(ORG_A, { ...stage, assigneeUserId: "user-a" }, ACTOR);
    await assignReviewer(ORG_A, { ...stage, assigneeUserId: "user-b" }, ACTOR);

    const rows = await readReviewAssignments(ORG_A, {
      kind: "assessment",
      id: "asmt-1",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].assigneeUserId).toBe("user-b");
  });

  it("refuses somebody who is not a member of this organization", async () => {
    await aMember("user-elsewhere", ORG_B);

    const landed = await assignReviewer(
      ORG_A,
      {
        subjectKind: "assessment",
        subjectId: "asmt-1",
        stage: "legal",
        assigneeUserId: "user-elsewhere",
      },
      ACTOR,
    );

    expect(landed).toBe(false);
    expect(await readReviewAssignments(ORG_A)).toEqual([]);
  });

  it("never lets one organization read another's assignments", async () => {
    await aMember("user-a");
    await aMember("user-b", ORG_B);

    await assignReviewer(
      ORG_A,
      {
        subjectKind: "assessment",
        subjectId: "asmt-1",
        stage: "legal",
        assigneeUserId: "user-a",
      },
      ACTOR,
    );
    await assignReviewer(
      ORG_B,
      {
        subjectKind: "assessment",
        subjectId: "asmt-1",
        stage: "legal",
        assigneeUserId: "user-b",
      },
      ACTOR,
    );

    // Same subject id and same stage in both tenants — only the scope separates.
    expect((await readReviewAssignments(ORG_A)).map((r) => r.assigneeUserId)).toEqual([
      "user-a",
    ]);
    expect((await readReviewAssignments(ORG_B)).map((r) => r.assigneeUserId)).toEqual([
      "user-b",
    ]);
  });

  it("refuses to clear another organization's assignment", async () => {
    await aMember("user-b", ORG_B);
    await assignReviewer(
      ORG_B,
      {
        subjectKind: "assessment",
        subjectId: "asmt-1",
        stage: "legal",
        assigneeUserId: "user-b",
      },
      ACTOR,
    );

    await unassignReviewer(
      ORG_A,
      { kind: "assessment", id: "asmt-1", stage: "legal" },
      ACTOR,
    );

    expect(await readReviewAssignments(ORG_B)).toHaveLength(1);
  });

  it("leaves a trail naming the stage that moved", async () => {
    // "Reassigned security" and "reassigned legal" are different facts, and an
    // event that said only "assigned a reviewer" would record neither.
    await aMember("user-a");
    await aMember("user-b");

    const stage = {
      subjectKind: "assessment" as const,
      subjectId: "asmt-1",
      stage: "security",
    };
    await assignReviewer(ORG_A, { ...stage, assigneeUserId: "user-a" }, ACTOR);
    await assignReviewer(ORG_A, { ...stage, assigneeUserId: "user-b" }, ACTOR);
    await unassignReviewer(
      ORG_A,
      { kind: "assessment", id: "asmt-1", stage: "security" },
      ACTOR,
    );

    const trail = await readActivity(ORG_A, "asmt-1");
    expect(trail.map((e) => e.action)).toEqual([
      "cleared the security review",
      "assigned the security review",
      "assigned the security review",
    ]);
    // The reassignment records who it moved from as well as to.
    expect(trail[1].before).toBe("user-a");
    expect(trail[1].after).toBe("user-b");
  });

  it("writes nothing when the same person is assigned again", async () => {
    await aMember("user-a");
    const stage = {
      subjectKind: "assessment" as const,
      subjectId: "asmt-1",
      stage: "legal",
      assigneeUserId: "user-a",
    };

    await assignReviewer(ORG_A, stage, ACTOR);
    await assignReviewer(ORG_A, stage, ACTOR);

    expect(await readActivity(ORG_A, "asmt-1")).toHaveLength(1);
  });

  it("degrades to the empty state when the database is broken", async () => {
    const original = testDb;
    // @ts-expect-error — deliberately broken handle.
    testDb = {
      select: () => {
        throw new Error("boom");
      },
    };
    expect(await readReviewAssignments(ORG_A)).toEqual([]);
    testDb = original;
  });
});

/* -------------------------------------------------- soft delete & versions */

/**
 * A deletion is a governed act, not an absence.
 *
 * The property under test is a pair: the row is invisible to every read, *and*
 * it is still there with its trail. Only asserting the first would pass equally
 * for a hard delete, which is the thing being replaced — an auditor asking why
 * March's eleven systems are now ten needs the eleventh to still answer.
 */
describe("soft delete", () => {
  it("hides a deleted system from every read", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);
    await deleteAiSystem(ORG_A, "sys-1", ACTOR);

    expect(await readAiSystems(ORG_A)).toEqual([]);
    expect(await readAiSystem(ORG_A, "sys-1")).toBeNull();
  });

  it("keeps the row, and records who removed it", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);
    await deleteAiSystem(ORG_A, "sys-1", { userId: "user-who-deleted-it" });

    const [row] = await testDb
      .select()
      .from(aiSystem)
      .where(eq(aiSystem.id, "sys-1"));

    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe("user-who-deleted-it");
  });

  it("hides a deleted risk from every read", async () => {
    await saveAiRisk(ORG_A, makeRisk("risk-1", [2, 2]), ACTOR);
    await deleteAiRisk(ORG_A, "risk-1", ACTOR);

    expect(await readAiRisks(ORG_A)).toEqual([]);
    expect(await readAiRisk(ORG_A, "risk-1")).toBeNull();
  });

  it("still refuses to delete another organization's row", async () => {
    // The tenant check has to survive the move from DELETE to UPDATE. An UPDATE
    // missing the organization filter is exactly as bad as a DELETE missing it,
    // and rather harder to notice.
    await saveAiSystem(ORG_B, makeSystem("sys-b", "Beta"), ACTOR);
    await deleteAiSystem(ORG_A, "sys-b", ACTOR);

    expect((await readAiSystems(ORG_B)).map((x) => x.id)).toEqual(["sys-b"]);
  });

  it("lets a deleted id be registered again", async () => {
    // The composite key is still occupied by the deleted row, so this is an
    // upsert over it. Registering a system, removing it and registering it again
    // is ordinary, and it must not fail on a key nobody can see.
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);
    await deleteAiSystem(ORG_A, "sys-1", ACTOR);

    const revived = makeSystem("sys-1", "Copilot");
    await saveAiSystem(ORG_A, revived, ACTOR);

    expect((await readAiSystems(ORG_A)).map((x) => x.id)).toEqual(["sys-1"]);
  });
});

describe("versions", () => {
  it("starts at 1 and rises on every write", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);
    expect((await readAiSystem(ORG_A, "sys-1"))?.version).toBe(1);

    const moved = makeSystem("sys-1", "Copilot");
    moved.riskTier = "high";
    await saveAiSystem(ORG_A, moved, ACTOR);
    expect((await readAiSystem(ORG_A, "sys-1"))?.version).toBe(2);
  });

  it("refuses a save that would overwrite somebody else's edit", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);

    // Two people open the same system. Both hold version 1.
    const mine = await readAiSystem(ORG_A, "sys-1");
    const theirs = await readAiSystem(ORG_A, "sys-1");

    await saveAiSystem(ORG_A, { ...theirs!, riskTier: "high" }, ACTOR, {
      expectedVersion: theirs!.version,
    });

    await expect(
      saveAiSystem(ORG_A, { ...mine!, riskTier: "minimal" }, ACTOR, {
        expectedVersion: mine!.version,
      }),
    ).rejects.toThrow(ConcurrentModificationError);

    // And the winner's value stands rather than being half-overwritten.
    expect((await readAiSystem(ORG_A, "sys-1"))?.riskTier).toBe("high");
  });

  it("lets a caller that does not ask keep last-write-wins", async () => {
    // The seed and any import write without a version, deliberately. Demanding
    // one everywhere would mean inventing versions for records that have none.
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);

    const stale = await readAiSystem(ORG_A, "sys-1");
    await saveAiSystem(ORG_A, { ...stale!, riskTier: "high" }, ACTOR);

    await expect(
      saveAiSystem(ORG_A, { ...stale!, riskTier: "minimal" }, ACTOR),
    ).resolves.toBeUndefined();
  });

  it("does not demand a version for a record that does not exist yet", async () => {
    // A creation has nothing to conflict with.
    await expect(
      saveAiSystem(ORG_A, makeSystem("sys-new", "New"), ACTOR, { expectedVersion: 7 }),
    ).resolves.toBeUndefined();
  });

  it("rises on a risk write too", async () => {
    await saveAiRisk(ORG_A, makeRisk("risk-1", [2, 2]), ACTOR);
    await saveAiRisk(ORG_A, makeRisk("risk-1", [3, 3]), ACTOR);

    expect((await readAiRisk(ORG_A, "risk-1"))?.version).toBe(2);
  });
});

describe("reading the trail by kind", () => {
  /**
   * The query `subject_kind` exists for.
   *
   * "Show me every membership change" is the question an auditor opens with, and
   * without a kind column the only way to answer it is to pattern-match id
   * prefixes — a guess dressed up as a query. The Members page reads this.
   */
  async function anEvent(
    org: string,
    kind: "member" | "system",
    subjectId: string,
    action: string,
  ) {
    await writeAudit(org, ACTOR, [{ subjectKind: kind, subjectId, action }]);
  }

  it("returns only the kind asked for", async () => {
    await anEvent(ORG_A, "member", "user-1", "changed a role");
    await anEvent(ORG_A, "system", "sys-1", "registered the system");

    const members = await readActivityByKind(ORG_A, "member");
    expect(members).toHaveLength(1);
    expect(members[0].action).toBe("changed a role");
  });

  it("never lets one organization read another's", async () => {
    await anEvent(ORG_A, "member", "user-1", "promoted somebody in A");
    await anEvent(ORG_B, "member", "user-1", "promoted somebody in B");

    // Same subject id in both tenants — only the scope separates them.
    expect((await readActivityByKind(ORG_A, "member")).map((e) => e.action)).toEqual([
      "promoted somebody in A",
    ]);
    expect((await readActivityByKind(ORG_B, "member")).map((e) => e.action)).toEqual([
      "promoted somebody in B",
    ]);
  });

  it("returns the newest first, and respects the limit", async () => {
    // A membership history is read from the top; an oldest-first list would put
    // the change somebody is asking about on the last page.
    for (const n of [1, 2, 3]) {
      await anEvent(ORG_A, "member", `user-${n}`, `change ${n}`);
    }

    const all = await readActivityByKind(ORG_A, "member");
    expect(all.map((e) => e.action)).toEqual(["change 3", "change 2", "change 1"]);
    expect(await readActivityByKind(ORG_A, "member", 2)).toHaveLength(2);
  });

  it("degrades to the empty state when the database is broken", async () => {
    const original = testDb;
    // @ts-expect-error — deliberately broken handle.
    testDb = { select: () => { throw new Error("boom"); } };
    expect(await readActivityByKind(ORG_A, "member")).toEqual([]);
    testDb = original;
  });
});

/* ------------------------------------------- what a deleted system takes with it */

/**
 * Soft delete reaches the dependents, and reviving brings them back.
 *
 * The rule that makes this shape the right one: **visibility is derived from the
 * parent, never written down the tree.** `saveAiSystem` clears the system's
 * tombstone, so a tombstone on each use case and claim would have to be cleared
 * by something too — and nothing would. Reviving a system would hand it back
 * empty, which is a worse answer than the shallow delete it replaced. The
 * revival case below is what pins that.
 *
 * The other half is what must *not* disappear: a risk with no system is
 * org-level, and a rule that dropped it would empty the register on the first
 * deletion while looking like it was working.
 */
describe("a deleted system's dependents", () => {
  /*
   * Seeded, because applicability is scoped to a framework and `readWorkspace`
   * returns none without one — an empty applicability list would make the claim
   * assertions below pass for the wrong reason. The estate is added on top, and
   * every assertion is about membership rather than exact contents so the
   * fixtures can grow without rewriting this block.
   */
  beforeEach(async () => {
    await seedAiManagementSystem(ORG_A);

    await saveAiSystem(ORG_A, makeSystem("sys-doomed", "Doomed"), ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-kept", "Survivor"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-doomed", "sys-doomed"), ACTOR);
    await saveUseCase(ORG_A, makeUseCase("uc-kept", "sys-kept"), ACTOR);

    await saveAiRisk(
      ORG_A,
      { ...makeRisk("risk-doomed", [2, 2]), systemId: "sys-doomed" },
      ACTOR,
    );
    // Org-level: names no system, and must survive every deletion.
    await saveAiRisk(ORG_A, { ...makeRisk("risk-org", [2, 2]), systemId: null }, ACTOR);

    await saveApplicability(
      ORG_A,
      makeApplicability("ctl-5-2", ["sys-doomed", "sys-kept"]),
      ACTOR,
    );
  });

  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  const claims = (data: Awaited<ReturnType<typeof readWorkspace>>) =>
    data.applicability.find((row) => row.controlId === "ctl-5-2");

  it("takes its use cases and its risks out of view", async () => {
    await deleteAiSystem(ORG_A, "sys-doomed", ACTOR);

    const data = await readWorkspace(ORG_A, {});
    expect(ids(data.systems)).not.toContain("sys-doomed");
    expect(ids(data.useCases)).not.toContain("uc-doomed");
    expect(ids(data.useCases)).toContain("uc-kept");
    expect(ids(data.risks)).not.toContain("risk-doomed");
  });

  it("keeps a risk whose use case was removed on its own", async () => {
    /*
     * The distinction `stranded()` has to draw, and the one it could not before
     * the use case register grew a soft delete of its own. A risk reaching a
     * *dead system* through a use case is hidden — that is the second hop below.
     * A risk whose use case was simply deleted is not: it is a register row in
     * its own right, and hiding it would make it vanish from a register nobody
     * deleted it from, with no trash entry to find it in.
     */
    await saveAiRisk(
      ORG_A,
      { ...makeRisk("risk-via-uc", [2, 2]), systemId: "sys-kept", useCaseId: "uc-kept" },
      ACTOR,
    );

    await deleteUseCase(ORG_A, "uc-kept", ACTOR);

    const data = await readWorkspace(ORG_A, {});
    expect(ids(data.useCases)).not.toContain("uc-kept");
    expect(ids(data.risks)).toContain("risk-via-uc");
  });

  it("still hides a risk that reaches a dead system through its use case", async () => {
    // The second hop, which must keep working: the use case is not deleted, its
    // system is, and a register still listing the risk has only moved the
    // dangling link one step along.
    await saveAiRisk(
      ORG_A,
      {
        ...makeRisk("risk-second-hop", [2, 2]),
        systemId: null,
        useCaseId: "uc-doomed",
      },
      ACTOR,
    );

    await deleteAiSystem(ORG_A, "sys-doomed", ACTOR);

    const data = await readWorkspace(ORG_A, {});
    expect(ids(data.risks)).not.toContain("risk-second-hop");
  });

  it("keeps a risk that names no system at all", async () => {
    // The failure that would look exactly like the feature working.
    await deleteAiSystem(ORG_A, "sys-doomed", ACTOR);
    await deleteAiSystem(ORG_A, "sys-kept", ACTOR);

    const data = await readWorkspace(ORG_A, {});
    expect(ids(data.risks)).toContain("risk-org");
  });

  it("drops the claim naming it without dropping the control's decision", async () => {
    // An applicability row belongs to a control, not to a system. What goes is
    // the claim — which is what has to stop counting toward coverage.
    await deleteAiSystem(ORG_A, "sys-doomed", ACTOR);

    const row = claims(await readWorkspace(ORG_A, {}));
    expect(row).toBeDefined();
    expect(row?.appliesToSystemIds).toEqual(["sys-kept"]);
    expect(row?.justification).toBe("Applicable");
  });

  it("brings them all back when the system is registered again", async () => {
    // The case a tombstone down the tree would fail: nothing would clear the
    // children's, so the system would come back empty.
    await deleteAiSystem(ORG_A, "sys-doomed", ACTOR);
    await saveAiSystem(ORG_A, makeSystem("sys-doomed", "Doomed"), ACTOR);

    const data = await readWorkspace(ORG_A, {});
    expect(ids(data.systems)).toContain("sys-doomed");
    expect(ids(data.useCases)).toContain("uc-doomed");
    expect(ids(data.risks)).toContain("risk-doomed");
    expect(claims(data)?.appliesToSystemIds.sort()).toEqual(["sys-doomed", "sys-kept"]);
  });

  it("derives without throwing when every system is gone", async () => {
    for (const system of (await readWorkspace(ORG_A, {})).systems) {
      await deleteAiSystem(ORG_A, system.id, ACTOR);
    }

    const ws = workspace(await readWorkspace(ORG_A, {}));
    expect(ws.systems).toEqual([]);
    expect(ws.useCases).toEqual([]);
    expect(() => attentionSummary(ws)).not.toThrow();
  });
});

/* -------------------------------------------------------------------- audit */

/**
 * The trail is evidence, not a report.
 *
 * Two properties make it that, and neither is visible in a typecheck: the
 * database refuses to let the application revise history, and no store write can
 * be expressed without naming who made it. Both are asserted here rather than
 * trusted, because both fail silently — a trail that can be edited still renders
 * perfectly, and a write with a missing event just shows one fewer row.
 */
describe("the audit trail is append-only", () => {
  async function anEvent() {
    await writeAudit(ORG_A, ACTOR, [
      { subjectKind: "system", subjectId: "sys-1", action: "registered the system" },
    ]);
    const [row] = await readActivity(ORG_A, "sys-1");
    return row;
  }

  it("refuses an update, in the database rather than by convention", async () => {
    const row = await anEvent();

    await expect(
      testDb
        .update(aiActivityEvent)
        .set({ action: "did something entirely different" })
        .where(eq(aiActivityEvent.id, row.id)),
    ).rejects.toThrow();

    // The rejection alone is not the property — the row surviving it is. Drizzle
    // wraps the driver error, so the trigger's own message is in the cause
    // rather than the top-level text, and asserting on it would test the ORM.
    expect((await readActivity(ORG_A, "sys-1"))[0].action).toBe("registered the system");
  });

  it("refuses a delete", async () => {
    const row = await anEvent();

    await expect(
      testDb.delete(aiActivityEvent).where(eq(aiActivityEvent.id, row.id)),
    ).rejects.toThrow();

    expect(await readActivity(ORG_A, "sys-1")).toHaveLength(1);
  });

  it("still lets a tenant be deleted, taking its history with it", async () => {
    // The one delete that must work. `organization_id` cascades, and an
    // organization nobody can remove is both a support problem and an erasure
    // problem — so the trigger allows the case where the tenant is already gone.
    await anEvent();

    await testDb.delete(organization).where(eq(organization.id, ORG_A));

    expect(await readActivity(ORG_A, "sys-1")).toHaveLength(0);
  });
});

describe("every write leaves a trail", () => {
  it("records a creation as one event naming the record", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);

    const trail = await readActivity(ORG_A, "sys-1");
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe("registered the system");
    expect(trail[0].actorId).toBe(ACTOR.userId);
    expect(trail[0].subjectKind).toBe("system");
  });

  it("records an edit as one event per field that actually moved", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);

    const moved = makeSystem("sys-1", "Copilot");
    moved.lifecycleStage = "deprecated";
    moved.riskTier = "high";
    await saveAiSystem(ORG_A, moved, ACTOR);

    const fields = (await readActivity(ORG_A, "sys-1"))
      .filter((e) => e.action === "changed the system")
      .map((e) => e.field)
      .sort();
    expect(fields).toEqual(["lifecycleStage", "riskTier"]);
  });

  it("writes nothing for a save that changes nothing", async () => {
    // A trail padded with no-op saves is a trail nobody skims, and one nobody
    // skims is one nobody reads.
    const system = makeSystem("sys-1", "Copilot");
    await saveAiSystem(ORG_A, system, ACTOR);
    await saveAiSystem(ORG_A, system, ACTOR);

    expect(await readActivity(ORG_A, "sys-1")).toHaveLength(1);
  });

  it("names the actor from the caller, never from the record", async () => {
    // The failure this prevents: recording the *owner* of a system as having
    // made a change somebody else made. They are different sets — an owner
    // frequently has no account at all.
    const system = makeSystem("sys-1", "Copilot");
    system.ownerId = "p-someone-else";
    await saveAiSystem(ORG_A, system, { userId: "user-who-actually-did-it" });

    expect((await readActivity(ORG_A, "sys-1"))[0].actorId).toBe(
      "user-who-actually-did-it",
    );
  });

  it("carries the reason and the suggestion that prompted the change", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);

    const moved = makeSystem("sys-1", "Copilot");
    moved.riskTier = "high";
    await saveAiSystem(ORG_A, moved, {
      userId: "user-1",
      reason: "Now informs shortlisting decisions about candidates.",
      viaSuggestionId: "sug-7",
    });

    const [latest] = await readActivity(ORG_A, "sys-1");
    expect(latest.reason).toMatch(/shortlisting/);
    // "The model did it" and "a person adopted what the model proposed" are
    // different answers, and only the second is defensible.
    expect(latest.viaSuggestionId).toBe("sug-7");
  });

  it("records a deletion, and nothing at all for a delete that hit nothing", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Copilot"), ACTOR);
    await deleteAiSystem(ORG_A, "sys-1", ACTOR);

    const trail = await readActivity(ORG_A, "sys-1");
    expect(trail[0].action).toBe("deleted the system");

    // A delete aimed at another tenant's id changes nothing, so it must not
    // leave an entry claiming it did.
    await deleteAiSystem(ORG_B, "sys-1", ACTOR);
    expect(await readActivity(ORG_B, "sys-1")).toHaveLength(0);
  });

  it("records the voided acceptance separately from the re-rating", async () => {
    // Somebody accepted a specific residual figure. Inferring its disappearance
    // from two rating fields moving is not something a reviewer will do.
    const risk = makeRisk("risk-1", [2, 2]);
    risk.acceptedById = "p-anders";
    risk.acceptedAt = "2026-01-05";
    await saveAiRisk(ORG_A, risk, ACTOR);

    await saveAiRisk(ORG_A, { ...risk, residualLikelihood: 5, residualImpact: 5 }, ACTOR);

    const actions = (await readActivity(ORG_A, "risk-1")).map((e) => e.action);
    expect(actions).toContain("voided the acceptance after a re-rating");
  });

  it("keeps one organization's trail out of another's", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Alpha"), ACTOR);
    await saveAiSystem(ORG_B, makeSystem("sys-1", "Beta"), ACTOR);

    expect(await readActivity(ORG_A, "sys-1")).toHaveLength(1);
    expect(await readActivity(ORG_B, "sys-1")).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------- seed */

describe("the fixture seed", () => {
  it("does not move one organization's rows when another seeds the same ids", async () => {
    // Every organization seeds from the same fixture file, so both use the id
    // "sys-m365-copilot". If that id is unique globally rather than per tenant,
    // the second seed does not create a second row - it takes the first one.
    await seedAiManagementSystem(ORG_A);
    const before = await readAiSystems(ORG_A);
    await seedAiManagementSystem(ORG_B);

    expect(await readAiSystems(ORG_A)).toHaveLength(before.length);
    expect(await readAiSystems(ORG_B)).toHaveLength(before.length);
  });

  it("loads one organization without touching another", async () => {
    await seedAiManagementSystem(ORG_A);

    expect((await readAiSystems(ORG_A)).length).toBeGreaterThan(10);
    expect(await readAiSystems(ORG_B)).toEqual([]);
    expect(await readAiRisks(ORG_B)).toEqual([]);
    expect(await readAiFindings(ORG_B)).toEqual([]);
    expect(await readAiEvidence(ORG_B)).toEqual([]);
  });

  it("is idempotent — a second run replaces rather than duplicating", async () => {
    await seedAiManagementSystem(ORG_A);
    const first = await readAiSystems(ORG_A);
    const firstEvidence = await readAiEvidence(ORG_A);

    await seedAiManagementSystem(ORG_A);
    expect(await readAiSystems(ORG_A)).toHaveLength(first.length);
    const secondEvidence = await readAiEvidence(ORG_A);
    expect(secondEvidence).toHaveLength(firstEvidence.length);
    // Link rows are the ones a naive re-seed doubles.
    expect(secondEvidence[0].linkedControlIds).toEqual(
      firstEvidence[0].linkedControlIds,
    );
  });
});

/* ---------------------------------------------------------------- degrading */

describe("reads never throw", () => {
  it("degrades to the empty state when the database is broken", async () => {
    const original = testDb;
    // Every page calls a read during render; an escaping error 500s the app.
    testDb = { select: () => { throw new Error("boom"); } } as unknown as TestDb;

    expect(await readAiSystems(ORG_A)).toEqual([]);
    expect(await readAiRisks(ORG_A)).toEqual([]);
    expect(await readAiFindings(ORG_A)).toEqual([]);
    expect(await readAiEvidence(ORG_A)).toEqual([]);
    expect(await readIntakeRequests(ORG_A)).toEqual([]);
    expect(await readIntakeNotes(ORG_A, "req-1")).toEqual([]);
    expect(await readAssessments(ORG_A)).toEqual([]);
    expect(await readActivity(ORG_A, "sys-1")).toEqual([]);
    expect(await readAiSystem(ORG_A, "sys-1")).toBeNull();
    expect((await readFramework(ORG_A, "iso-42001")).framework).toBeNull();

    testDb = original;
  });
});

/* ------------------------------------------------------------------- people */

describe("people", () => {
  it("round-trips every field, including the nullable ones", async () => {
    await savePerson(ORG_A, {
      id: "p-1",
      name: "Ada Okonjo",
      role: "Head of Claims",
      businessUnit: "",
    },
      ACTOR,
    );
    const [row] = await readPeople(ORG_A);
    expect(row).toEqual({
      id: "p-1",
      name: "Ada Okonjo",
      role: "Head of Claims",
      businessUnit: "",
    });
  });

  it("never lets one organization read another's rows", async () => {
    await savePerson(ORG_A, { id: "p-1", name: "A", role: "r", businessUnit: "u" }, ACTOR);
    await savePerson(ORG_B, { id: "p-2", name: "B", role: "r", businessUnit: "u" }, ACTOR);

    expect((await readPeople(ORG_A)).map((p) => p.id)).toEqual(["p-1"]);
    expect((await readPeople(ORG_B)).map((p) => p.id)).toEqual(["p-2"]);
  });

  it("upserts on a re-import rather than duplicating", async () => {
    await savePerson(ORG_A, { id: "p-1", name: "A", role: "r", businessUnit: "u" }, ACTOR);
    await savePerson(ORG_A, { id: "p-1", name: "A Renamed", role: "r", businessUnit: "u" }, ACTOR);

    const rows = await readPeople(ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("A Renamed");
  });
});


/** What the reviewer holds out of the box, as the store would be sent it. */
function defaultReviewerGrants(): Record<string, string[]> {
  return {
    // Every register statement a reviewer holds is a read: they may take a
    // register away, not change it. Mirrored here because these tests turn on
    // "the matrix is unchanged", which is only meaningful if this *is* the
    // shipped matrix.
    system: ["export"],
    useCase: ["export"],
    risk: ["export"],
    evidence: ["export"],
    assessment: ["export"],
    questionnaire: ["export"],
    intake: ["export"],
    finding: ["verify", "export"],
    signoff: ["approve", "reject"],
    policy: ["approve"],
  };
}

/* ----------------------------------------------------------- role grants */

/**
 * What the roles mean in one organization, and what no organization may say.
 *
 * The store is where the refusals live rather than the route, because they are
 * facts about the product's segregation of duties and have to hold however the
 * row arrives — a seed, an import, the next client somebody writes. That is the
 * same argument that puts residual-voiding in `saveAiRisk`.
 *
 * The property that carries the most weight here is the *absence* of a row
 * meaning "the code default". A stored copy of the defaults would freeze this
 * build's answer and withhold every statement added afterwards; an empty map
 * would lock everybody out of everything.
 */
describe("role grants", () => {
  it("round-trips a change, and leaves the other roles alone", async () => {
    expect(
      await saveRoleGrants(ORG_A, "reviewer", { answer: ["update"] }, ACTOR),
    ).toEqual({ ok: true });

    const grants = await readRoleGrants(ORG_A);
    expect(grants.reviewer?.answer).toEqual(["update"]);
    // Untouched roles have no row at all, which is what "the default" is.
    expect(grants.system_owner).toBeUndefined();
  });

  it("never lets one organization read another's rows", async () => {
    await saveRoleGrants(ORG_A, "reviewer", { answer: ["update"] }, ACTOR);
    await saveRoleGrants(ORG_B, "reviewer", { risk: ["update"] }, ACTOR);

    expect((await readRoleGrants(ORG_A)).reviewer?.answer).toEqual(["update"]);
    expect((await readRoleGrants(ORG_A)).reviewer?.risk ?? []).toEqual([]);
    expect((await readRoleGrants(ORG_B)).reviewer?.risk).toEqual(["update"]);
  });

  it("refuses to reset another organization's rows", async () => {
    await saveRoleGrants(ORG_B, "reviewer", { answer: ["update"] }, ACTOR);

    await resetRoleGrants(ORG_A, "reviewer", ACTOR);

    expect((await readRoleGrants(ORG_B)).reviewer?.answer).toEqual(["update"]);
  });

  it("puts a role back by removing the row, not by storing the defaults", async () => {
    // A stored copy would freeze this build's answer and quietly withhold every
    // statement a later release adds.
    await saveRoleGrants(ORG_A, "reviewer", { answer: ["update"] }, ACTOR);
    await resetRoleGrants(ORG_A, "reviewer", ACTOR);

    expect((await readRoleGrants(ORG_A)).reviewer).toBeUndefined();
  });

  it("refuses every segregation-of-duties grant, in the store", async () => {
    const refused = await saveRoleGrants(
      ORG_A,
      "system_owner",
      { signoff: ["approve"] },
      ACTOR,
    );
    expect(refused.ok).toBe(false);
    expect((await readRoleGrants(ORG_A)).system_owner).toBeUndefined();

    expect(
      (await saveRoleGrants(ORG_A, "system_owner", { finding: ["verify"] }, ACTOR)).ok,
    ).toBe(false);
    expect(
      (await saveRoleGrants(ORG_A, "reviewer", { review: ["assign"] }, ACTOR)).ok,
    ).toBe(false);
  });

  it("refuses to edit the role that runs the tenant", async () => {
    const refused = await saveRoleGrants(ORG_A, "platform_admin", { control: [] }, ACTOR);
    expect(refused.ok).toBe(false);
    expect((await readRoleGrants(ORG_A)).platform_admin).toBeUndefined();
  });

  it("refuses to let a caller change what their own role means", async () => {
    // Nothing can reach this today — `role: ["update"]` is held only by the
    // fixed role, which is itself uneditable — but the day a second role gains
    // the statement is the day that stops being true, and nothing would say so.
    const refused = await saveRoleGrants(
      ORG_A,
      "governance_lead",
      { risk: ["update"] },
      ACTOR,
      "governance_lead",
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/your own role/i);
  });

  it("refuses a resource the auth library enforces", async () => {
    const refused = await saveRoleGrants(
      ORG_A,
      "reviewer",
      { member: ["update"] },
      ACTOR,
    );
    expect(refused.ok).toBe(false);
  });

  it("records what moved, one entry per permission", async () => {
    await saveRoleGrants(
      ORG_A,
      "reviewer",
      { ...defaultReviewerGrants(), answer: ["update"] },
      ACTOR,
    );

    const trail = await readActivityByKind(ORG_A, "organization", 50);
    const entry = trail.find((e) => e.field === "answer");
    expect(entry?.action).toBe("changed what reviewer may do");
    expect(entry?.before).toBe("nothing");
    expect(entry?.after).toBe("update");
    // Only what moved: the resources that did not change leave no row.
    expect(trail.some((e) => e.field === "risk")).toBe(false);
  });

  it("writes nothing when the matrix is unchanged", async () => {
    await saveRoleGrants(ORG_A, "reviewer", defaultReviewerGrants(), ACTOR);
    expect(await readActivityByKind(ORG_A, "organization", 50)).toHaveLength(0);
  });

  it("degrades to the shipped matrix when the database is broken", async () => {
    // The one read in this file whose empty state is wrong: an empty map would
    // mean every role holds nothing. No overrides means the code defaults.
    await testDb.execute("DROP TABLE ai_role_grant CASCADE");
    expect(await readRoleGrants(ORG_A)).toEqual({});
  });
});

/* -------------------------------------------------- accounts and people */

/**
 * Which account is which person.
 *
 * The one crossing between Better Auth's users and `ai_person`, and therefore
 * the one place a wrong row puts somebody else's name on a decision. Three
 * properties carry that weight and each has a test below: it is scoped to the
 * organization like everything else; **one person belongs to at most one
 * account**, which is what keeps an identity check from passing for two
 * different callers; and an unmatched account resolves to nothing rather than
 * to a plausible guess.
 */
describe("accounts and people", () => {
  async function aPerson(id: string, organizationId = ORG_A) {
    await savePerson(
      organizationId,
      { id, name: `Person ${id}`, role: "Head of Something", businessUnit: "Technology" },
      ACTOR,
    );
    return id;
  }

  it("round-trips every field, including the nullable ones", async () => {
    await aMember("user-1");
    await aPerson("p-1");

    expect(
      await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR),
    ).toEqual({ ok: true });

    const [row] = await readAccountPeople(ORG_A);
    expect(row.userId).toBe("user-1");
    expect(row.personId).toBe("p-1");
    expect(row.linkedBy).toBe(ACTOR.userId);
    expect(typeof row.linkedAt).toBe("string");

    // `linkedBy` is nullable, and an actor with no account behind it is what
    // writes the null.
    await aMember("user-2");
    await aPerson("p-2");
    await linkAccountToPerson(ORG_A, { userId: "user-2", personId: "p-2" }, { userId: "" });
    expect(
      (await readAccountPeople(ORG_A)).find((r) => r.userId === "user-2")?.linkedBy,
    ).toBeNull();
  });

  it("resolves the acting person, and answers null for an account nobody matched", async () => {
    await aMember("user-1");
    await aMember("user-2");
    await aPerson("p-1");
    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);

    expect(await readActingPersonId(ORG_A, "user-1")).toBe("p-1");
    // The ordinary state of a new seat, not an error — and the reason
    // `UNATTRIBUTED` still exists.
    expect(await readActingPersonId(ORG_A, "user-2")).toBeNull();
  });

  it("never lets one organization read another's rows", async () => {
    await aMember("user-a");
    await aMember("user-b", ORG_B);
    await aPerson("p-1");
    await aPerson("p-1", ORG_B);

    await linkAccountToPerson(ORG_A, { userId: "user-a", personId: "p-1" }, ACTOR);
    await linkAccountToPerson(ORG_B, { userId: "user-b", personId: "p-1" }, ACTOR);

    expect((await readAccountPeople(ORG_A)).map((r) => r.userId)).toEqual(["user-a"]);
    expect((await readAccountPeople(ORG_B)).map((r) => r.userId)).toEqual(["user-b"]);

    // Both tenants hold a person called `p-1` — every organization seeds the
    // same fixture ids — so scoping the read is what keeps them apart.
    expect(await readActingPersonId(ORG_A, "user-b")).toBeNull();
    expect(await readActingPersonId(ORG_B, "user-a")).toBeNull();
  });

  it("refuses to delete another organization's rows", async () => {
    await aMember("user-b", ORG_B);
    await aPerson("p-1", ORG_B);
    await linkAccountToPerson(ORG_B, { userId: "user-b", personId: "p-1" }, ACTOR);

    await unlinkAccountFromPerson(ORG_A, "user-b", ACTOR);

    expect((await readAccountPeople(ORG_B)).map((r) => r.userId)).toEqual(["user-b"]);
  });

  it("refuses a second account for one person", async () => {
    // The direction the primary key does not cover, and the one that matters
    // most: two accounts acting as one person would make every "is the caller
    // the assignee?" check pass for both.
    await aMember("user-1");
    await aMember("user-2");
    await aPerson("p-1");

    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);
    expect(
      await linkAccountToPerson(ORG_A, { userId: "user-2", personId: "p-1" }, ACTOR),
    ).toEqual({ ok: false, reason: "person_taken" });

    expect((await readAccountPeople(ORG_A)).map((r) => r.userId)).toEqual(["user-1"]);
  });

  it("releases a person whose account has left the organization", async () => {
    // Nothing cascades this table when a seat goes, so without the release a
    // departure would lock that person forever: the replacement refused as
    // `person_taken`, and the account holding them no longer on the members
    // screen for anybody to clear.
    await aMember("user-gone");
    await aMember("user-new");
    await aPerson("p-1");
    await linkAccountToPerson(ORG_A, { userId: "user-gone", personId: "p-1" }, ACTOR);

    await testDb.delete(member).where(eq(member.userId, "user-gone"));

    expect(
      await linkAccountToPerson(ORG_A, { userId: "user-new", personId: "p-1" }, ACTOR),
    ).toEqual({ ok: true });

    const rows = await readAccountPeople(ORG_A);
    expect(rows.map((r) => r.userId)).toEqual(["user-new"]);

    // Two events, not one silent overwrite: a person changing hands is a fact
    // somebody may later have to account for.
    const trail = (await readActivityByKind(ORG_A, "member", 50)).map((e) => e.action);
    expect(trail).toContain("cleared which person user-gone@example.test acts as");
    expect(trail).toContain("matched user-new@example.test to a person");
  });

  it("still refuses a person held by an account that is still here", async () => {
    await aMember("user-1");
    await aMember("user-2");
    await aPerson("p-1");
    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);

    expect(
      await linkAccountToPerson(ORG_A, { userId: "user-2", personId: "p-1" }, ACTOR),
    ).toEqual({ ok: false, reason: "person_taken" });
  });

  it("refuses a second person for one account", async () => {
    // The other direction, enforced by the primary key: the write upserts
    // rather than adding a row, because an account is one person and not a list.
    await aMember("user-1");
    await aPerson("p-1");
    await aPerson("p-2");

    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);
    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-2" }, ACTOR);

    const rows = await readAccountPeople(ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].personId).toBe("p-2");
  });

  it("drops a claim naming another organization's person", async () => {
    await aMember("user-1");
    await aPerson("p-elsewhere", ORG_B);

    expect(
      await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-elsewhere" }, ACTOR),
    ).toEqual({ ok: false, reason: "unknown_person" });
    expect(await readAccountPeople(ORG_A)).toEqual([]);
  });

  it("refuses somebody who is not a member of this organization", async () => {
    await aMember("user-elsewhere", ORG_B);
    await aPerson("p-1");

    expect(
      await linkAccountToPerson(ORG_A, { userId: "user-elsewhere", personId: "p-1" }, ACTOR),
    ).toEqual({ ok: false, reason: "not_a_member" });
    expect(await readAccountPeople(ORG_A)).toEqual([]);
  });

  it("records who said so, and what it was before", async () => {
    await aMember("user-1");
    await aPerson("p-1");
    await aPerson("p-2");

    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);
    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-2" }, ACTOR);
    await unlinkAccountFromPerson(ORG_A, "user-1", ACTOR);

    /* Names, not ids, in both halves — these rows sit on the access history
     * beside `membership-audit.ts`'s, and a trail that prints `p-2` makes the
     * reader go and look it up. */
    const trail = (await readActivityByKind(ORG_A, "member", 50)).reverse();
    expect(trail.map((e) => [e.action, e.before, e.after])).toEqual([
      ["matched user-1@example.test to a person", null, "Person p-1"],
      ["changed which person user-1@example.test acts as", "Person p-1", "Person p-2"],
      ["cleared which person user-1@example.test acts as", "Person p-2", null],
    ]);
    expect(trail.every((e) => e.subjectId === "user-1")).toBe(true);
    expect(trail.every((e) => e.actorId === ACTOR.userId)).toBe(true);
  });

  it("writes nothing when the same pair is claimed twice", async () => {
    // Re-seeding must not grow the trail by a row per run.
    await aMember("user-1");
    await aPerson("p-1");

    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);
    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);

    expect(await readActivityByKind(ORG_A, "member", 50)).toHaveLength(1);
  });

  it("leaves what was already decided alone when a link is withdrawn", async () => {
    // The rule `acting-person.ts` states: a decision recorded while its caller
    // was matched keeps the person it named. Unlinking is not a retraction, and
    // history is never rewritten in either direction.
    await aMember("user-1");
    await aPerson("p-1");
    await linkAccountToPerson(ORG_A, { userId: "user-1", personId: "p-1" }, ACTOR);

    await saveSuggestion(
      ORG_A,
      {
        id: "sug-1",
        target: { kind: "control", id: "ctl-a9-2" },
        recommendation: "Text",
        reasoning: "Because",
        supportingData: [],
        confidence: 0.9,
        status: "accepted",
        decidedById: "p-1",
        decidedAt: "2026-08-01",
        editedText: null,
      },
      ACTOR,
    );

    await unlinkAccountFromPerson(ORG_A, "user-1", ACTOR);

    expect((await readSuggestions(ORG_A))[0].decidedById).toBe("p-1");
  });

  it("degrades to the empty state when the database is broken", async () => {
    await testDb.execute("DROP TABLE ai_account_person CASCADE");

    expect(await readAccountPeople(ORG_A)).toEqual([]);
    expect(await readActingPersonId(ORG_A, "user-1")).toBeNull();
  });
});

/* ----------------------------------------------------------------- policies */

describe("ai policies", () => {
  it("round-trips every field, including the nullable ones", async () => {
    await saveAiPolicy(ORG_A, {
      id: "pol-1",
      title: "AI Use Policy",
      status: "draft",
      ownerId: "",
      version: "0.9",
      approvedAt: null,
      nextReviewDate: "2027-01-01",
      summary: "",
    },
      ACTOR,
    );
    const [row] = await readAiPolicies(ORG_A);
    expect(row.approvedAt).toBeNull();
    expect(row.ownerId).toBe("");
    expect(row.status).toBe("draft");
  });

  it("never lets one organization read another's rows", async () => {
    await saveAiPolicy(ORG_A, {
      id: "pol-1",
      title: "Ours",
      status: "approved",
      ownerId: "p-anders",
      version: "1.0",
      approvedAt: "2026-01-01",
      nextReviewDate: "2027-01-01",
      summary: "s",
    },
      ACTOR,
    );
    expect(await readAiPolicies(ORG_B)).toEqual([]);
  });
});

/* ----------------------------------------------------------- questionnaires */

function makeQuestionnaire(id: string, title: string) {
  return {
    id,
    title,
    requester: "Northwind",
    requesterType: "customer" as const,
    receivedAt: "2026-07-01",
    dueAt: "2026-08-20",
    ownerId: "p-larsen",
    status: "in_progress" as const,
    note: "",
    questions: [
      {
        id: `${id}-q1`,
        number: "1.1",
        text: "Do you maintain an AI inventory?",
        controlIds: ["ctl-1"],
        policyIds: ["pol-1"],
        evidenceIds: [],
      },
      {
        id: `${id}-q2`,
        number: "1.2",
        text: "Are you certified?",
        controlIds: [],
        policyIds: [],
        evidenceIds: [],
      },
    ],
  };
}

describe("questionnaires", () => {
  it("round-trips every field, including the nullable ones", async () => {
    const q = makeQuestionnaire("qn-1", "Northwind DDQ");
    q.ownerId = "";
    await saveQuestionnaire(ORG_A, q, ACTOR);

    const [row] = await readQuestionnaires(ORG_A);
    expect(row.ownerId).toBe("");
    expect(row.questions.map((x) => x.number)).toEqual(["1.1", "1.2"]);
    expect(row.questions[0].controlIds).toEqual(["ctl-1"]);
  });

  it("never lets one organization read another's rows", async () => {
    await saveQuestionnaire(ORG_A, makeQuestionnaire("qn-1", "Ours"), ACTOR);
    await saveQuestionnaire(ORG_B, makeQuestionnaire("qn-2", "Theirs"), ACTOR);

    expect((await readQuestionnaires(ORG_A)).map((q) => q.id)).toEqual(["qn-1"]);
    expect((await readQuestionnaires(ORG_B)).map((q) => q.id)).toEqual(["qn-2"]);
  });

  it("replaces the question set rather than merging it", async () => {
    await saveQuestionnaire(ORG_A, makeQuestionnaire("qn-1", "Ours"), ACTOR);
    const trimmed = makeQuestionnaire("qn-1", "Ours");
    trimmed.questions = [trimmed.questions[0]];
    await saveQuestionnaire(ORG_A, trimmed, ACTOR);

    const [row] = await readQuestionnaires(ORG_A);
    expect(row.questions).toHaveLength(1);
  });

  it("refuses to clear another organization's questions", async () => {
    await saveQuestionnaire(ORG_A, makeQuestionnaire("qn-1", "Ours"), ACTOR);
    // Same id, different tenant: the delete inside the save is scoped by both,
    // so writing B's copy must not empty A's.
    await saveQuestionnaire(ORG_B, makeQuestionnaire("qn-1", "Theirs"), ACTOR);

    const [ours] = await readQuestionnaires(ORG_A);
    expect(ours.questions).toHaveLength(2);
  });
});

/* ------------------------------------------------------------- suggestions */

describe("ai suggestions", () => {
  it("round-trips every field, including the nullable ones", async () => {
    await saveSuggestion(ORG_A, {
      id: "sug-1",
      target: { kind: "control", id: "ctl-1" },
      recommendation: "Exclude, with this justification.",
      reasoning: "No supplier model is trained in house.",
      supportingData: [{ label: "Inventory", detail: "0 internal models" }],
      confidence: 0.82,
      status: "pending",
      decidedById: null,
      decidedAt: null,
      editedText: null,
    },
      ACTOR,
    );

    const [row] = await readSuggestions(ORG_A);
    expect(row.decidedById).toBeNull();
    expect(row.editedText).toBeNull();
    expect(row.target).toEqual({ kind: "control", id: "ctl-1" });
    // Stored as whole percent, so the fraction survives to two decimal places.
    expect(row.confidence).toBeCloseTo(0.82, 2);
  });

  it("never lets one organization read another's rows", async () => {
    await saveSuggestion(ORG_A, {
      id: "sug-1",
      target: { kind: "field", id: "f-1" },
      recommendation: "r",
      reasoning: "",
      supportingData: [],
      confidence: 0.5,
      status: "pending",
      decidedById: null,
      decidedAt: null,
      editedText: null,
    },
      ACTOR,
    );
    expect(await readSuggestions(ORG_B)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ workspace */

describe("the workspace", () => {
  it("never lets one organization read another's records", async () => {
    await seedAiManagementSystem(ORG_A);

    const theirs = await readWorkspace(ORG_B);
    expect(theirs.systems).toEqual([]);
    expect(theirs.people).toEqual([]);
    expect(theirs.policies).toEqual([]);
    expect(theirs.questionnaires).toEqual([]);
    expect(theirs.suggestions).toEqual([]);
    expect(theirs.applicability).toEqual([]);
    expect(theirs.framework).toBeNull();
  });

  it("falls back to the first framework in scope when the id is unknown", async () => {
    await seedAiManagementSystem(ORG_A);

    const asked = await readWorkspace(ORG_A, { frameworkId: "iso-9001" });
    // An id arrives from a URL a person can edit, so it resolves rather than 404s.
    expect(asked.framework?.id).toBe("iso-42001");
    expect(asked.applicability.length).toBeGreaterThan(0);
  });

  it("derives business units from its own people, with no duplicates", async () => {
    await savePerson(ORG_A, { id: "p-1", name: "A", role: "r", businessUnit: "Legal" }, ACTOR);
    await savePerson(ORG_A, { id: "p-2", name: "B", role: "r", businessUnit: "Legal" }, ACTOR);
    await savePerson(ORG_A, { id: "p-3", name: "C", role: "r", businessUnit: "" }, ACTOR);

    const ws = await readWorkspace(ORG_A);
    expect(ws.businessUnits).toEqual(["Legal"]);
  });

  it("carries an audit trail only for the subject a page asked for", async () => {
    await seedAiManagementSystem(ORG_A);

    const unscoped = await readWorkspace(ORG_A);
    expect(unscoped.activity).toEqual([]);

    const scoped = await readWorkspace(ORG_A, { activitySubjectId: "sys-m365-copilot" });
    expect(scoped.activity.length).toBeGreaterThan(0);
    expect(scoped.activity.every((e) => e.subjectId === "sys-m365-copilot")).toBe(true);
  });
});

/* ------------------------------------------------- the derived layer, on real rows */

describe("the seeded workspace matches the design it was approved as", () => {
  /*
   * The acceptance criterion for the whole slice. The screens were signed off
   * against the fixtures; the seed writes those fixtures to Postgres; so every
   * figure derived from a seeded organization must equal the figure derived
   * from the fixtures directly. Anything the round trip through the database
   * loses — a dropped link row, a coerced null, a column that quietly truncates
   * — shows up here as a different number rather than as a screen nobody
   * rechecked.
   */
  it("derives the same readiness from the database as from the fixtures", async () => {
    await seedAiManagementSystem(ORG_A);
    // Both organizations seed the same fixture ids. Each must still be its own
    // management system, deriving its own figures from its own rows.
    await seedAiManagementSystem(ORG_B);
    const stored = workspace(await readWorkspace(ORG_A));
    const designed = fixtureWorkspace();

    expect(frameworkReadiness(stored)).toEqual(frameworkReadiness(designed));
    expect(frameworkReadiness(workspace(await readWorkspace(ORG_B)))).toEqual(
      frameworkReadiness(designed),
    );
    expect(evidencePosture(stored).percent).toBe(evidencePosture(designed).percent);
    expect(policyPosture(stored).percent).toBe(policyPosture(designed).percent);
    expect(systemPosture(stored).percent).toBe(systemPosture(designed).percent);
  });

  it("raises the same attention items, and the same ones critically", async () => {
    await seedAiManagementSystem(ORG_A);
    const stored = attentionRequired(workspace(await readWorkspace(ORG_A)));
    const designed = attentionRequired(fixtureWorkspace());

    /* Worst-first is a product decision and is asserted; the order *within* a
     * severity band came from the order the fixture arrays happened to be
     * written in, and the database sorts by name and control id instead. That
     * is the better order, so what has to match is the membership of each band
     * rather than the sequence. */
    const band = (items: typeof stored, severity: string) =>
      items.filter((i) => i.severity === severity).map((i) => i.id).sort();

    expect(band(stored, "critical")).toEqual(band(designed, "critical"));
    expect(band(stored, "warn")).toEqual(band(designed, "warn"));
    expect(stored.findIndex((i) => i.severity === "warn")).toBe(
      band(stored, "critical").length,
    );
  });

  it("finds the same audit blockers", async () => {
    await seedAiManagementSystem(ORG_A);
    const stored = workspace(await readWorkspace(ORG_A));

    expect(preflight(stored).map((i) => [i.id, i.count])).toEqual(
      preflight(fixtureWorkspace()).map((i) => [i.id, i.count]),
    );
  });

  it("reports the same per-system coverage", async () => {
    await seedAiManagementSystem(ORG_A);
    const stored = workspace(await readWorkspace(ORG_A));
    const designed = fixtureWorkspace();

    for (const system of designed.systems) {
      const a = stored.coverageForSystem(system.id);
      const b = designed.coverageForSystem(system.id);
      expect({ ...a, rows: a.rows.map((r) => r.controlId).sort() }).toEqual({
        ...b,
        rows: b.rows.map((r) => r.controlId).sort(),
      });
    }
  });

  it("publishes the same trust centre", async () => {
    await seedAiManagementSystem(ORG_A);
    const stored = workspace(await readWorkspace(ORG_A));
    const designed = fixtureWorkspace();

    const byId = (entries: ReturnType<typeof toolEntries>) =>
      [...entries].sort((a, b) => a.systemId.localeCompare(b.systemId));

    expect(byId(toolEntries(stored))).toEqual(byId(toolEntries(designed)));
    expect(commitments(stored)).toEqual(commitments(designed));
  });
});

/* ------------------------------------------------------- a brand new organization */

describe("an organization with nothing in it", () => {
  /*
   * The state the mockup never had. Fixtures were never empty and a fresh
   * tenant always is, so every derived figure meets a division by zero, an
   * absent framework or an empty array here for the first time. A `NaN%` on a
   * dashboard is the kind of defect that ships.
   */
  it("derives every figure without throwing, and none of them is NaN", async () => {
    const ws = workspace(await readWorkspace(ORG_B));

    const readiness = frameworkReadiness(ws);
    expect(readiness.ready.percent).toBe(0);
    expect(Number.isNaN(readiness.ready.percent)).toBe(false);
    expect(Number.isNaN(evidencePosture(ws).percent)).toBe(false);
    expect(Number.isNaN(policyPosture(ws).percent)).toBe(false);
    expect(Number.isNaN(systemPosture(ws).percent)).toBe(false);

    expect(readinessByNode(ws)).toEqual([]);
    expect(attentionRequired(ws)).toEqual([]);
    expect(attentionSummary(ws).total).toBe(0);
    expect(preflight(ws)).toEqual([]);
    expect(packSections(ws).every((s) => s.rows === 0 || s.rows === 1)).toBe(true);
    expect(toolEntries(ws)).toEqual([]);
    expect(houseRules(ws).policy).toBeUndefined();
  });

  it("says which standard it governs against without inventing one", async () => {
    const ws = workspace(await readWorkspace(ORG_B));
    const framework = commitments(ws).find((c) => c.id === "framework");

    expect(framework?.claim).toContain("no standard yet");
  });
});
