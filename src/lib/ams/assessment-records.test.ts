import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AssessmentInstance } from "@/lib/ams/types";

/**
 * The impact assessment register on the shared record machinery.
 *
 * Two properties here have no equivalent in the registers before it.
 *
 * **The purge has to clear the review assignments itself.** Answers cascade
 * from the assessment at the foreign key; sign-off assignments do not, because
 * they are keyed by `(organization, subjectKind, subjectId, stage)` with no
 * constraint into any table — which is what lets one shape serve assessments,
 * systems and policies alike. Left behind, "who was assigned to approve this"
 * keeps answering about a record nothing else can find.
 *
 * **A restore must not reset the sign-off chain.** Removing and putting back is
 * not an edit — nobody changed an answer — so signatures valid before are valid
 * after. The one thing `saveAssessmentAnswers` is careful never to do over a
 * typo, this must never do at all.
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

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const caller = { organizationId: ORG_A, userId: "user-a", role: "governance_lead" };
let permitted = true;

const requirePermission = vi.fn(async () =>
  permitted
    ? { ok: true as const, ctx: { ...caller } }
    : {
        ok: false as const,
        response: Response.json({ error: "Refused." }, { status: 403 }),
      },
);

vi.mock("@/lib/session", () => ({
  requirePermission: (...args: unknown[]) =>
    (requirePermission as unknown as (...a: unknown[]) => unknown)(...args),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const { organization } = await import("@/db/auth-schema");
const { aiAssessment, aiAssessmentAnswer, aiPerson, aiReviewAssignment } =
  await import("@/db/schema");
const {
  TRASH_RETENTION_DAYS,
  deleteAssessment,
  purgeExpiredAssessments,
  readActivityByKind,
  readAssessment,
  readAssessments,
  readDeletedAssessments,
  restoreAssessment,
  saveAiSystem,
  saveAssessment,
  saveAssessmentAnswers,
} = await import("@/lib/ai-store");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

function makeAssessment(
  id: string,
  over: Partial<AssessmentInstance> = {},
): AssessmentInstance {
  return {
    id,
    templateId: "tpl-impact",
    systemId: "sys-one",
    useCaseId: null,
    status: "in_progress",
    answers: {},
    signOff: [
      {
        stage: "governance_endorse",
        label: "Governance lead",
        assigneeId: "p-devi",
        state: "complete",
        completedAt: "2026-06-01",
      },
      {
        stage: "approver_approve",
        label: "Legal",
        assigneeId: "p-quinn",
        state: "current",
        completedAt: null,
      },
    ],
    updatedAt: "2026-06-01T00:00:00.000Z",
    dueAt: "2026-06-30",
    ...over,
  };
}

function call(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost/api/records/assessment/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind: "assessment" }) },
  );
}

const remove = (body: unknown) => call(DELETE_RECORDS, "delete", body);
const exportAssessments = (body: unknown) => call(EXPORT_RECORDS, "export", body);
const cells = (text: string) => text.split("\n").map((line) => line.split(","));

async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteAssessment(organizationId, id, ACTOR);
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiAssessment)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(and(eq(aiAssessment.organizationId, organizationId), eq(aiAssessment.id, id)));
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
  permitted = true;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);
  await testDb.insert(aiPerson).values([
    {
      id: "p-devi",
      organizationId: ORG_A,
      name: "S. Devi",
      role: "Head of Technology",
      businessUnit: "Technology",
    },
    {
      id: "p-quinn",
      organizationId: ORG_A,
      name: "E. Quinn",
      role: "Counsel",
      businessUnit: "Legal",
    },
  ]);

  /* The assessment's system has a foreign key, so both organisations need one
   * before an assessment can exist at all. */
  for (const org of [ORG_A, ORG_B]) {
    await saveAiSystem(
      org,
      {
        id: "sys-one",
        name: "Otter.ai",
        vendor: "Otter",
        origin: "procured_saas",
        isGenAi: true,
        businessUnit: "Sales",
        ownerId: "",
        lifecycleStage: "production",
        riskTier: "limited",
        assessmentStatus: "in_progress",
        purpose: "",
        deploymentModel: "vendor_multi_tenant",
        hostingRegions: [],
        dataResidency: "EU",
        userGroups: [],
        approxUsers: 0,
        dataCategories: [],
        characteristics: [],
        vendorDetail: {
          name: "Otter",
          subProcessors: [],
          modelProvider: null,
          contractType: "click_through",
          dataProcessingAgreement: false,
          certifications: [],
          trainsOnCustomerData: false,
          renewalDate: null,
        },
        registeredAt: "2026-01-01",
        nextReviewDate: "2026-12-01",
        discoveredVia: null,
      },
      ACTOR,
    );
  }

  await saveAssessment(ORG_A, makeAssessment("asm-one"), ACTOR);
  await saveAssessment(ORG_A, makeAssessment("asm-two", { status: "approved" }), ACTOR);
  await saveAssessment(ORG_B, makeAssessment("asm-theirs"), ACTOR);
});

describe("removing assessments through the generic route", () => {
  it("removes the ones it is given", async () => {
    const { deleted, refused } = await (await remove({ ids: ["asm-one"] })).json();

    expect(refused).toEqual([]);
    expect(deleted.map((d: { id: string }) => d.id)).toEqual(["asm-one"]);
    expect((await readAssessments(ORG_A)).map((a) => a.id)).toEqual(["asm-two"]);
    expect(await readAssessment(ORG_A, "asm-one")).toBeNull();
  });

  it("will not reach another organization's register", async () => {
    const { deleted } = await (await remove({ ids: ["asm-theirs"] })).json();

    expect(deleted).toEqual([]);
    expect((await readAssessments(ORG_B)).map((a) => a.id)).toEqual(["asm-theirs"]);
  });

  it("checks the assessment resource", async () => {
    requirePermission.mockClear();
    await remove({ ids: ["asm-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { assessment: ["delete"] },
      expect.any(String),
    );
  });
});

describe("what removing and restoring an assessment must not lose", () => {
  it("brings the answers back with it", async () => {
    await saveAssessmentAnswers(
      ORG_A,
      "asm-one",
      { "field-purpose": "Transcribes sales calls" },
      ACTOR,
      { materialChange: false },
    );

    await deleteAssessment(ORG_A, "asm-one", ACTOR);
    await restoreAssessment(ORG_A, "asm-one", ACTOR);

    const back = await readAssessment(ORG_A, "asm-one");
    /* Answers are only ever hidden by the parent going out of view, so a
     * restore returns the assessment as it was answered rather than as an
     * empty form. */
    expect(back?.answers["field-purpose"]).toBe("Transcribes sales calls");
  });

  it("does not reset the sign-off chain", async () => {
    await deleteAssessment(ORG_A, "asm-one", ACTOR);
    await restoreAssessment(ORG_A, "asm-one", ACTOR);

    const back = await readAssessment(ORG_A, "asm-one");
    const complete = back?.signOff.filter((step) => step.state === "complete") ?? [];

    /* Removing and putting back is not an edit — nobody changed an answer — so
     * a signature valid before is valid after. Resetting here would be this
     * function inventing a material change. */
    expect(complete).toHaveLength(1);
    expect(complete[0].completedAt).toBe("2026-06-01");
  });
});

describe("the purge, and the rows nothing cascades from", () => {
  it("clears the review assignments it leaves behind", async () => {
    /* Inserted directly: the store has no writer for these — `/api/review-
     * assignments` builds the row itself — and what this test needs is simply
     * that a row naming the assessment exists when the purge runs. */
    await testDb.insert(aiReviewAssignment).values({
      organizationId: ORG_A,
      subjectKind: "assessment",
      subjectId: "asm-one",
      stage: "legal",
      assigneeUserId: "user-quinn",
      assignedBy: "user-a",
    });

    await removedDaysAgo(ORG_A, "asm-one", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredAssessments(ORG_A);

    const left = await testDb.select().from(aiReviewAssignment);
    /* No foreign key does this for us. Left behind, "who was assigned to
     * approve this" keeps answering about a record nothing else can find. */
    expect(left.filter((r) => r.subjectId === "asm-one")).toEqual([]);
  });

  it("takes the answers with it at the foreign key", async () => {
    await saveAssessmentAnswers(
      ORG_A,
      "asm-one",
      { "field-purpose": "Transcribes sales calls" },
      ACTOR,
      { materialChange: false },
    );

    await removedDaysAgo(ORG_A, "asm-one", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredAssessments(ORG_A);

    const answers = await testDb.select().from(aiAssessmentAnswer);
    expect(answers.filter((a) => a.assessmentId === "asm-one")).toEqual([]);
  });

  it("purges only what is overdue, and keeps the trail", async () => {
    await removedDaysAgo(ORG_A, "asm-one", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_A, "asm-two", TRASH_RETENTION_DAYS - 1);

    const purged = await purgeExpiredAssessments(ORG_A);
    expect(purged.map((a) => a.id)).toEqual(["asm-one"]);
    expect((await readDeletedAssessments(ORG_A)).map((a) => a.id)).toEqual(["asm-two"]);

    const actions = (await readActivityByKind(ORG_A, "assessment"))
      .filter((e) => e.subjectId === "asm-one")
      .map((e) => e.action);

    expect(actions).toContain("deleted the assessment");
    expect(actions).toContain(
      "permanently removed the assessment after its retention window",
    );
  });

  it("will not purge another organization's overdue assessment", async () => {
    await removedDaysAgo(ORG_B, "asm-theirs", TRASH_RETENTION_DAYS + 5);
    await removedDaysAgo(ORG_A, "asm-one", TRASH_RETENTION_DAYS + 5);

    await purgeExpiredAssessments(ORG_A);

    expect(await readDeletedAssessments(ORG_B)).toHaveLength(1);
  });
});

describe("exporting assessments", () => {
  it("exports the sign-off chain, which is the thing anybody asks about", async () => {
    const response = await exportAssessments({
      format: "csv",
      columns: [
        "system",
        "currentStage",
        "signaturesComplete",
        "signaturesTotal",
      ],
      ids: ["asm-one"],
    });

    const [, row] = cells(await response.text());
    expect(row[0]).toBe("Otter.ai");
    // Who is waiting on whom — the one question a register of assessments
    // exists to answer.
    expect(row[1]).toBe("Legal — E. Quinn");
    /* Given and required as two numbers, because a spreadsheet can subtract two
     * numbers and cannot subtract a sentence. */
    expect(row[2]).toBe("1");
    expect(row[3]).toBe("2");
  });

  it("says a system-level assessment covers the whole system", async () => {
    const response = await exportAssessments({
      format: "csv",
      columns: ["system", "useCase"],
      ids: ["asm-one"],
    });

    // A different claim from covering one of its use cases, and a blank cell
    // would not say which.
    expect(cells(await response.text())[1][1]).toBe("Whole system");
  });

  it("does not call an approved assessment overdue", async () => {
    const response = await exportAssessments({
      format: "csv",
      columns: ["system", "overdue"],
      ids: ["asm-two"],
    });

    expect(cells(await response.text())[1][1]).toBe("No");
  });

  it("records the export against the assessment register", async () => {
    await exportAssessments({ format: "csv", columns: ["system"], ids: ["asm-one"] });

    const entry = (await readActivityByKind(ORG_A, "organization")).find(
      (e) => e.action === "exported the Impact assessments",
    );

    expect(entry?.after).toContain("1 assessment");
  });
});
