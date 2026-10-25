import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";

/**
 * The three registers that grew a create button, exercised against real Postgres.
 *
 * `permissions.test.ts` proves the roles are right and `route-guards.test.ts`
 * proves the checks are reached. What is left is what only these routes can get
 * wrong, and it is the same shape in all three: **the body must not be able to
 * carry a record past the gate the register exists to enforce.**
 *
 *   - a risk cannot arrive **accepted**, because accepting a residual names
 *     somebody senior enough to carry it and demands a written reason — a rule
 *     that lives in `POST /api/risks` and would be walked around entirely by a
 *     create route that took an `acceptedById`;
 *   - a finding cannot arrive **closed**, because closure needs a root cause, a
 *     corrective action and a dated verification by somebody other than the
 *     owner, and a self-verified finding posted straight to closed is
 *     indistinguishable afterwards from one that earned it;
 *   - an assessment cannot arrive **approved or signed**, because that would
 *     make the system it covers read as assessed on the inventory, which is the
 *     one column the register cannot afford to have lying.
 *
 * The rest is the argument `system-create-route.test.ts` already makes about the
 * inventory: the row has to actually persist, it has to land in one tenant, and
 * the id has to be minted server-side because every store write upserts and
 * would therefore quietly overwrite rather than fail on a colliding id.
 *
 * The session is mocked because it is not what is under test. Everything below
 * it — the store, the audit rows, the SQL, the migrations — is real.
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

const caller = { organizationId: "org-aaaa", userId: "user-a", role: "governance_lead" };

vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const { organization } = await import("@/db/auth-schema");
const {
  readActivity,
  readAiFindings,
  readAiRisks,
  readAssessments,
  saveAiSystem,
  saveUseCase,
} = await import("@/lib/ai-store");
const { newSystem } = await import("@/lib/ams/system-create");

const { POST: createRisk } = await import("@/app/api/risks/create/route");
const { POST: createFinding } = await import("@/app/api/findings/create/route");
const { POST: createAssessment } = await import("@/app/api/assessments/create/route");

type Handler = (request: Request) => Promise<Response>;

function post(handler: Handler, path: string, body: unknown) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** The nine answers the risk form collects. Overridden per test. */
function riskForm(overrides: Record<string, unknown> = {}) {
  return {
    title: "Vendor trains on our customer data",
    systemId: "",
    useCaseId: "",
    ownerId: "p-devi",
    treatment: "mitigate",
    treatmentSummary: "Contract amended and a data processing agreement signed.",
    inherentLikelihood: 4,
    inherentImpact: 5,
    residualLikelihood: 2,
    residualImpact: 4,
    ...overrides,
  };
}

function findingForm(overrides: Record<string, unknown> = {}) {
  return {
    title: "Access reviews not run for two quarters",
    severity: "high",
    source: "internal_audit",
    raisedBy: "IA-2026-04",
    raisedAt: "2026-08-01",
    dueAt: "2026-09-01",
    ownerId: "p-devi",
    systemId: "",
    summary: "The standing calendar entry was deleted when the owner changed.",
    ...overrides,
  };
}

function assessmentForm(overrides: Record<string, unknown> = {}) {
  return {
    systemId: "sys-convene-notetaker-aaaaaa",
    useCaseId: "",
    dueAt: "2026-09-30",
    ownerId: "p-devi",
    endorserId: "p-anders",
    approverId: "p-oyelaran",
    ...overrides,
  };
}

/** A system for the assessment to be about, in whichever org is named. */
async function seedSystem(organizationId: string) {
  await saveAiSystem(
    organizationId,
    newSystem(
      "sys-convene-notetaker-aaaaaa",
      {
        name: "Convene Notetaker",
        vendor: "Convene Labs",
        origin: "procured_saas",
        isGenAi: "yes",
        businessUnit: "Marketing",
        ownerId: "p-devi",
        purpose: "Joins external calls to record, transcribe and summarise them.",
      },
      new Date("2026-08-01T00:00:00Z"),
    ),
    { userId: "user-a" },
  );
}

beforeAll(async () => {
  const made = await createTestDb();
  testDb = made.db;
  close = made.close;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  caller.organizationId = ORG_A;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);
});

describe("POST /api/risks/create", () => {
  it("stores the risk and reads it back on the next request", async () => {
    const response = await post(createRisk, "/api/risks/create", riskForm());
    expect(response.status).toBe(201);

    const { risk } = await response.json();
    const stored = await readAiRisks(ORG_A);
    expect(stored.map((r) => r.title)).toEqual(["Vendor trains on our customer data"]);
    expect(stored[0].id).toBe(risk.id);
    expect(await readAiRisks(ORG_B)).toEqual([]);
  });

  it("opens with nobody having accepted the residue", async () => {
    const { risk } = await (
      await post(createRisk, "/api/risks/create", riskForm())
    ).json();
    expect(risk.status).toBe("open");
    expect(risk.acceptedById).toBeNull();
    expect(risk.acceptedAt).toBeNull();
  });

  it("refuses a body that tries to arrive accepted", async () => {
    // The hole this closes: an acceptance that skipped the written reason the
    // edit route demands, and a signature nobody gave.
    for (const extra of [
      { acceptedById: "p-oyelaran" },
      { acceptedAt: "2026-08-01" },
      { status: "accepted" },
      { id: "risk-theirs" },
    ]) {
      expect((await post(createRisk, "/api/risks/create", riskForm(extra))).status).toBe(
        400,
      );
    }
    expect(await readAiRisks(ORG_A)).toEqual([]);
  });

  it("refuses a rating that is missing or off the scale", async () => {
    expect(
      (await post(createRisk, "/api/risks/create", riskForm({ residualImpact: 0 })))
        .status,
    ).toBe(400);
    expect(
      (await post(createRisk, "/api/risks/create", riskForm({ inherentLikelihood: 9 })))
        .status,
    ).toBe(400);
    expect(
      (await post(createRisk, "/api/risks/create", riskForm({ residualLikelihood: "3" })))
        .status,
    ).toBe(400);
  });

  it("names the field that was wrong", async () => {
    const response = await post(
      createRisk,
      "/api/risks/create",
      riskForm({ title: "x", treatmentSummary: "short" }),
    );
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(Object.keys(json.fields).sort()).toEqual(["title", "treatmentSummary"]);
  });

  it("keeps a risk that names no system, as organisation-wide", async () => {
    const { risk } = await (
      await post(createRisk, "/api/risks/create", riskForm())
    ).json();
    expect(risk.systemId).toBeNull();
  });

  it("gives two risks of one title two rows, and records the trail", async () => {
    const first = await (await post(createRisk, "/api/risks/create", riskForm())).json();
    const second = await (await post(createRisk, "/api/risks/create", riskForm())).json();

    expect(first.risk.id).not.toBe(second.risk.id);
    expect(first.risk.id).toMatch(/^risk-vendor-trains-on-our-customer-data-[a-z0-9]{6}$/);
    expect((await readAiRisks(ORG_A)).length).toBe(2);
    expect((await readActivity(ORG_A, first.risk.id)).length).toBeGreaterThan(0);
  });

  it("cleans what somebody typed before it is stored", async () => {
    const { risk } = await (
      await post(createRisk, "/api/risks/create", riskForm({ title: "  Vendor    trains  " }))
    ).json();
    expect(risk.title).toBe("Vendor trains");
  });

  it("files a risk against one use case of a system", async () => {
    /* `ai_risk` has carried both columns since before either was fillable: the
     * create route hardcoded null, so the intersection was modelled and
     * unreachable except through the seed. */
    await seedSystem(ORG_A);
    await saveUseCase(
      ORG_A,
      {
        id: "uc-pair",
        systemIds: ["sys-convene-notetaker-aaaaaa"],
        systemOverrides: [],
        name: "Meeting summarisation",
        description: "Summarises calls",
        businessUnit: "Technology",
        ownerId: "p-devi",
        riskTier: "limited",
        oversightLevel: "human_in_the_loop",
        oversightSummary: "Someone reads it",
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        dataCategories: ["internal"],
        approxUsers: 5,
        status: "active",
        assessmentId: null,
      },
      { userId: "seed" },
    );

    const response = await post(
      createRisk,
      "/api/risks/create",
      riskForm({ systemId: "sys-convene-notetaker-aaaaaa", useCaseId: "uc-pair" }),
    );
    expect(response.status).toBe(201);

    const [stored] = await readAiRisks(ORG_A);
    expect(stored.systemId).toBe("sys-convene-notetaker-aaaaaa");
    expect(stored.useCaseId).toBe("uc-pair");
  });

  it("refuses a use case the named system does not implement", async () => {
    await seedSystem(ORG_A);
    await saveUseCase(
      ORG_A,
      {
        id: "uc-elsewhere2",
        systemIds: ["sys-somewhere-else"],
        systemOverrides: [],
        name: "Something else",
        description: "Does another job",
        businessUnit: "Technology",
        ownerId: "p-devi",
        riskTier: "limited",
        oversightLevel: "human_in_the_loop",
        oversightSummary: "Someone reads it",
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        dataCategories: ["internal"],
        approxUsers: 5,
        status: "active",
        assessmentId: null,
      },
      { userId: "seed" },
    );

    const response = await post(
      createRisk,
      "/api/risks/create",
      riskForm({
        systemId: "sys-convene-notetaker-aaaaaa",
        useCaseId: "uc-elsewhere2",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields.useCaseId).toMatch(/not recorded against/i);
    expect(await readAiRisks(ORG_A)).toEqual([]);
  });

  it("refuses a use case with no system beside it", async () => {
    /* A risk about a purpose is a risk about that purpose on a tool. Without a
     * system there is no pair, and the row would claim a scope it cannot name. */
    const response = await post(
      createRisk,
      "/api/risks/create",
      riskForm({ systemId: "", useCaseId: "uc-anything" }),
    );
    expect(response.status).toBe(400);
    expect(await readAiRisks(ORG_A)).toEqual([]);
  });
});

describe("POST /api/findings/create", () => {
  it("stores the finding and reads it back on the next request", async () => {
    const response = await post(createFinding, "/api/findings/create", findingForm());
    expect(response.status).toBe(201);

    const { finding } = await response.json();
    const stored = await readAiFindings(ORG_A);
    expect(stored.map((f) => f.id)).toEqual([finding.id]);
    expect(await readAiFindings(ORG_B)).toEqual([]);
  });

  it("opens with nothing claimed about the fix", async () => {
    const { finding } = await (
      await post(createFinding, "/api/findings/create", findingForm())
    ).json();
    expect(finding.status).toBe("open");
    expect(finding.rootCause).toBeNull();
    expect(finding.correctiveAction).toBeNull();
    expect(finding.verifiedById).toBeNull();
    expect(finding.verifiedAt).toBeNull();
    expect(finding.closedAt).toBeNull();
  });

  it("refuses a body that tries to arrive closed or verified", async () => {
    // The hole this closes: a finding closed by the person who fixed it,
    // arriving past `canClose` and looking exactly like one that earned it.
    for (const extra of [
      { status: "closed" },
      { closedAt: "2026-08-01" },
      { verifiedById: "p-devi" },
      { verifiedAt: "2026-08-01" },
      { rootCause: "Nobody owned the calendar entry." },
      { correctiveAction: "Recreated it." },
      { id: "fnd-theirs" },
    ]) {
      expect(
        (await post(createFinding, "/api/findings/create", findingForm(extra))).status,
      ).toBe(400);
    }
    expect(await readAiFindings(ORG_A)).toEqual([]);
  });

  it("refuses a source or a severity it does not recognise", async () => {
    expect(
      (await post(createFinding, "/api/findings/create", findingForm({ source: "hunch" })))
        .status,
    ).toBe(400);
    expect(
      (await post(createFinding, "/api/findings/create", findingForm({ severity: "bad" })))
        .status,
    ).toBe(400);
  });

  it("refuses a date that is not a date", async () => {
    expect(
      (await post(createFinding, "/api/findings/create", findingForm({ dueAt: "soon" })))
        .status,
    ).toBe(400);
  });

  it("keeps a finding that names no system, as organisation-level", async () => {
    const { finding } = await (
      await post(createFinding, "/api/findings/create", findingForm())
    ).json();
    expect(finding.systemId).toBeNull();
    expect(finding.id).toMatch(/^fnd-access-reviews-not-run-for-two-quarters-[a-z0-9]{6}$/);
  });
});

describe("POST /api/assessments/create", () => {
  beforeEach(async () => {
    await seedSystem(ORG_A);
  });

  it("stores the assessment and reads it back on the next request", async () => {
    const response = await post(
      createAssessment,
      "/api/assessments/create",
      assessmentForm(),
    );
    expect(response.status).toBe(201);

    const { assessment } = await response.json();
    const stored = await readAssessments(ORG_A);
    expect(stored.map((a) => a.id)).toEqual([assessment.id]);
    expect(await readAssessments(ORG_B)).toEqual([]);
  });

  it("opens unanswered, unsigned, with the owner up", async () => {
    const { assessment } = await (
      await post(createAssessment, "/api/assessments/create", assessmentForm())
    ).json();

    expect(assessment.status).toBe("not_started");
    expect(assessment.answers).toEqual({});
    expect(assessment.signOff.map((s: { state: string }) => s.state)).toEqual([
      "current",
      "pending",
      "pending",
    ]);
    expect(
      assessment.signOff.every((s: { completedAt: string | null }) => s.completedAt === null),
    ).toBe(true);
    expect(assessment.signOff.map((s: { assigneeId: string }) => s.assigneeId)).toEqual([
      "p-devi",
      "p-anders",
      "p-oyelaran",
    ]);
  });

  it("refuses a body that tries to arrive approved or signed", async () => {
    for (const extra of [
      { status: "approved" },
      { answers: { intended_use: "…" } },
      { signOff: [] },
      { templateId: "tpl-theirs" },
      { id: "asmt-theirs" },
    ]) {
      expect(
        (await post(createAssessment, "/api/assessments/create", assessmentForm(extra)))
          .status,
      ).toBe(400);
    }
    expect(await readAssessments(ORG_A)).toEqual([]);
  });

  it("refuses one person both endorsing and approving", async () => {
    // Two different judgements about two different things. Collapsing them is
    // how an assessment ends up approved by the person who checked it.
    const response = await post(
      createAssessment,
      "/api/assessments/create",
      assessmentForm({ endorserId: "p-anders", approverId: "p-anders" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields.approverId).toMatch(/same person/);
  });

  it("refuses a use case the system does not implement", async () => {
    /* The pairing had no guard at all: `ai_assessment.use_case_id` has no
     * foreign key, the route checked only the system, and the dialog scoping
     * its picker was the whole defence. A mismatched pair produces an
     * assessment whose drafting context describes a different tool — the draft
     * resolves the system from the assessment and the use cases from that
     * system, as though the two already agreed. */
    await saveAiSystem(
      ORG_A,
      newSystem(
        "sys-other-aaaaaa",
        {
          name: "Something Else",
          vendor: "Elsewhere",
          origin: "procured_saas",
          isGenAi: "yes",
          businessUnit: "Technology",
          ownerId: "p-devi",
          purpose: "Does another job entirely.",
        },
        new Date("2026-08-01T00:00:00Z"),
      ),
      { userId: "seed" },
    );
    await saveUseCase(
      ORG_A,
      {
        id: "uc-elsewhere",
        systemOverrides: [],
        systemIds: ["sys-other-aaaaaa"],
        name: "Meeting summarisation",
        description: "Summarises calls",
        businessUnit: "Technology",
        ownerId: "p-devi",
        riskTier: "limited",
        oversightLevel: "human_in_the_loop",
        oversightSummary: "Someone reads it",
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        dataCategories: ["internal"],
        approxUsers: 5,
        status: "active",
        assessmentId: null,
      },
      { userId: "seed" },
    );

    const response = await post(
      createAssessment,
      "/api/assessments/create",
      assessmentForm({ useCaseId: "uc-elsewhere" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields.useCaseId).toMatch(/not recorded against/i);
    expect(await readAssessments(ORG_A)).toEqual([]);
  });

  it("accepts a use case the system does implement", async () => {
    await saveUseCase(
      ORG_A,
      {
        id: "uc-here",
        systemOverrides: [],
        systemIds: ["sys-convene-notetaker-aaaaaa"],
        name: "Meeting summarisation",
        description: "Summarises calls",
        businessUnit: "Technology",
        ownerId: "p-devi",
        riskTier: "limited",
        oversightLevel: "human_in_the_loop",
        oversightSummary: "Someone reads it",
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        dataCategories: ["internal"],
        approxUsers: 5,
        status: "active",
        assessmentId: null,
      },
      { userId: "seed" },
    );

    const response = await post(
      createAssessment,
      "/api/assessments/create",
      assessmentForm({ useCaseId: "uc-here" }),
    );
    expect(response.status).toBe(201);
  });

  it("refuses a use case belonging to another organization", async () => {
    const response = await post(
      createAssessment,
      "/api/assessments/create",
      assessmentForm({ useCaseId: "uc-not-ours" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields.useCaseId).toMatch(/register/i);
  });

  it("refuses a system belonging to another organization", async () => {
    // The one field on the wire that can point at another tenant's row. The
    // system is read through the org filter, so an id from elsewhere is simply
    // not found — and nothing is written.
    caller.organizationId = ORG_B;
    const response = await post(
      createAssessment,
      "/api/assessments/create",
      assessmentForm(),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields.systemId).toMatch(/inventory/);
    expect(await readAssessments(ORG_B)).toEqual([]);
  });

  it("slugs the id off the system it covers", async () => {
    const { assessment } = await (
      await post(createAssessment, "/api/assessments/create", assessmentForm())
    ).json();
    expect(assessment.id).toMatch(/^asmt-convene-notetaker-[a-z0-9]{6}$/);
    expect((await readActivity(ORG_A, assessment.id)).length).toBeGreaterThan(0);
  });
});
