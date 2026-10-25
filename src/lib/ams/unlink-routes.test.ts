import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type {
  ControlApplicability,
  Evidence,
  Finding,
  Risk,
} from "@/lib/ams/types";

/**
 * Taking records back off a system.
 *
 * The inverse of `link-routes.test.ts` and `applicability-claim-route.test.ts`,
 * and the tests are about the two places the inverse is *not* a mirror:
 *
 *   - **An empty `linkedSystemIds` means every system; an empty
 *     `appliesToSystemIds` means none.** So unlinking a document's last system
 *     widens its reach, and unclaiming a control's last system narrows it to
 *     nothing. The rules look symmetrical and are not, and a refactor that made
 *     them symmetrical would break one of the two coverage figures.
 *
 *   - **Un-filing a risk clears `useCaseId`; un-filing a finding keeps
 *     `controlId`.** A use case belongs to exactly one system, so the reference
 *     dies with the relationship. A framework control belongs to no system, so
 *     it survives.
 *
 * Everything below the mocked session — the store, the audit rows, the SQL, the
 * migrations — is real.
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
const FRAMEWORK = "iso-42001";

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
const { aiPerson } = await import("@/db/schema");
const {
  readAiEvidence,
  readAiFinding,
  readAiRisk,
  readApplicability,
  readWorkspace,
  saveAiEvidence,
  saveAiFinding,
  saveAiRisk,
  saveAiSystem,
  saveApplicability,
  saveUseCase,
} = await import("@/lib/ai-store");
const { newSystem } = await import("@/lib/ams/system-create");
const { POST: unlinkEvidence } = await import(
  "@/app/api/records/evidence/unlink/route"
);
const { POST: unclaim } = await import("@/app/api/applicability/unclaim/route");
const { POST: unfileRisk } = await import("@/app/api/risks/unfile/route");
const { POST: unfileFinding } = await import("@/app/api/findings/unfile/route");

const ACTOR = { userId: "seed" };

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

function makeSystem(id: string, name: string) {
  return newSystem(
    id,
    {
      name,
      vendor: name,
      origin: "procured_saas",
      isGenAi: "yes",
      businessUnit: "Technology",
      ownerId: "p-devi",
      purpose: "Joins external calls to record, transcribe and summarise them.",
    },
    new Date("2026-08-01T00:00:00Z"),
  );
}

function makeEvidence(id: string, title: string, over: Partial<Evidence> = {}): Evidence {
  return {
    id,
    title,
    type: "policy",
    ownerId: "p-devi",
    source: "Internal",
    collectedAt: "2026-01-10",
    expiresAt: null,
    verificationState: "verified",
    linkedControlIds: [],
    linkedSystemIds: [],
    file: null,
    ...over,
  };
}

function makeRisk(id: string, title: string, over: Partial<Risk> = {}): Risk {
  return {
    id,
    title,
    systemId: null,
    useCaseId: null,
    controlIds: [],
    inherentLikelihood: 4,
    inherentImpact: 4,
    treatment: "mitigate",
    treatmentSummary: "Reviewed quarterly",
    residualLikelihood: 2,
    residualImpact: 3,
    ownerId: "p-devi",
    status: "open",
    acceptedById: null,
    acceptedAt: null,
    ...over,
  };
}

function makeFinding(id: string, title: string, over: Partial<Finding> = {}): Finding {
  return {
    id,
    title,
    severity: "high",
    status: "open",
    source: "internal_audit",
    raisedBy: "Internal Audit",
    raisedAt: "2026-05-14",
    dueAt: "2026-06-30",
    ownerId: "p-devi",
    systemId: null,
    controlId: null,
    summary: "Summary",
    rootCause: null,
    correctiveAction: null,
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
    ...over,
  };
}

function makeRow(
  controlId: string,
  over: Partial<ControlApplicability> = {},
): ControlApplicability {
  return {
    frameworkId: FRAMEWORK,
    controlId,
    applicability: "yes",
    justification: "Applicable",
    implementationStatus: "implemented",
    ownerId: "p-devi",
    linkedPolicyId: null,
    linkedEvidenceIds: [],
    appliesToSystemIds: [],
    lastReviewedAt: "2026-06-25",
    ...over,
  };
}

const claimsFor = async (controlId: string) =>
  (await readApplicability(ORG_A, FRAMEWORK)).find((r) => r.controlId === controlId)
    ?.appliesToSystemIds ?? [];

const docById = async (id: string) =>
  (await readAiEvidence(ORG_A)).find((e) => e.id === id);

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
  ]);

  await saveAiSystem(ORG_A, makeSystem("sys-otter", "Otter.ai"), ACTOR);
  await saveAiSystem(ORG_A, makeSystem("sys-deepl", "DeepL"), ACTOR);
  await saveAiSystem(ORG_B, makeSystem("sys-theirs", "Their tool"), ACTOR);
});

describe("unlinking evidence from a system", () => {
  beforeEach(async () => {
    await saveAiEvidence(
      ORG_A,
      makeEvidence("ev-shared", "SOC 2 Type II", {
        linkedSystemIds: ["sys-otter", "sys-deepl"],
      }),
      ACTOR,
    );
    await saveAiEvidence(
      ORG_A,
      makeEvidence("ev-only", "Otter output sampling", {
        linkedSystemIds: ["sys-otter"],
      }),
      ACTOR,
    );
  });

  it("removes this system and leaves the others", async () => {
    const response = await post(unlinkEvidence, {
      systemId: "sys-otter",
      evidenceIds: ["ev-shared"],
    });
    expect(response.status).toBe(200);
    expect((await docById("ev-shared"))?.linkedSystemIds).toEqual(["sys-deepl"]);
  });

  it("makes a document organisation-wide when it was its only system, and says so", async () => {
    /* The asymmetry with unclaiming: an empty link set means the document
     * covers *every* system, so this widens rather than detaches. Allowed —
     * refusing would leave a mis-filed document with no path to
     * organisation-wide — and reported so the caller can see which way it went. */
    const response = await post(unlinkEvidence, {
      systemId: "sys-otter",
      evidenceIds: ["ev-only"],
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      unlinked: { id: string; nowOrgWide: boolean }[];
    };
    expect(body.unlinked[0]).toMatchObject({ id: "ev-only", nowOrgWide: true });
    expect((await docById("ev-only"))?.linkedSystemIds).toEqual([]);
  });

  it("refuses a document that is not linked to this system", async () => {
    const response = await post(unlinkEvidence, {
      systemId: "sys-deepl",
      evidenceIds: ["ev-only"],
    });
    const body = (await response.json()) as {
      unlinked: unknown[];
      refused: { reason: string }[];
    };
    expect(body.unlinked).toHaveLength(0);
    expect(body.refused[0].reason).toMatch(/not linked/i);
    expect((await docById("ev-only"))?.linkedSystemIds).toEqual(["sys-otter"]);
  });

  it("unlinks the good documents and reports the refused ones", async () => {
    const response = await post(unlinkEvidence, {
      systemId: "sys-deepl",
      evidenceIds: ["ev-shared", "ev-only", "ev-nothing"],
    });
    const body = (await response.json()) as {
      unlinked: { id: string }[];
      refused: { id: string }[];
    };
    expect(body.unlinked.map((r) => r.id)).toEqual(["ev-shared"]);
    expect(body.refused.map((r) => r.id).sort()).toEqual(["ev-nothing", "ev-only"]);
  });

  it("refuses a system from another organisation", async () => {
    const response = await post(unlinkEvidence, {
      systemId: "sys-theirs",
      evidenceIds: ["ev-shared"],
    });
    expect(response.status).toBe(400);
    expect((await docById("ev-shared"))?.linkedSystemIds.sort()).toEqual([
      "sys-deepl",
      "sys-otter",
    ]);
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    const response = await post(unlinkEvidence, {
      systemId: "sys-otter",
      evidenceIds: ["ev-shared"],
    });
    expect(response.status).toBe(403);
  });
});

describe("unclaiming a control from a system", () => {
  beforeEach(async () => {
    await saveApplicability(
      ORG_A,
      makeRow("ctl-5-2", { appliesToSystemIds: ["sys-otter", "sys-deepl"] }),
      ACTOR,
    );
    await saveApplicability(
      ORG_A,
      makeRow("ctl-6-1", { appliesToSystemIds: ["sys-otter"] }),
      ACTOR,
    );
  });

  it("removes this system and leaves the others", async () => {
    const response = await post(unclaim, {
      systemId: "sys-otter",
      controls: [{ frameworkId: FRAMEWORK, controlId: "ctl-5-2" }],
    });
    expect(response.status).toBe(200);
    expect(await claimsFor("ctl-5-2")).toEqual(["sys-deepl"]);
  });

  it("empties the claim set without deleting the SoA row", async () => {
    /* The mirror-image of the evidence case, and the reason the two rules are
     * written separately: `coverageForSystem` has no length branch for
     * applicability, so an empty set is claimed against nothing. The control
     * stays in scope for the organisation. */
    const response = await post(unclaim, {
      systemId: "sys-otter",
      controls: [{ frameworkId: FRAMEWORK, controlId: "ctl-6-1" }],
    });
    expect(response.status).toBe(200);
    expect(await claimsFor("ctl-6-1")).toEqual([]);

    const row = (await readApplicability(ORG_A, FRAMEWORK)).find(
      (r) => r.controlId === "ctl-6-1",
    );
    expect(row?.applicability).toBe("yes");
  });

  it("refuses a control that is not claimed against this system", async () => {
    const response = await post(unclaim, {
      systemId: "sys-deepl",
      controls: [{ frameworkId: FRAMEWORK, controlId: "ctl-6-1" }],
    });
    const body = (await response.json()) as {
      unclaimed: unknown[];
      refused: { reason: string }[];
    };
    expect(body.unclaimed).toHaveLength(0);
    expect(body.refused[0].reason).toMatch(/not claimed/i);
    expect(await claimsFor("ctl-6-1")).toEqual(["sys-otter"]);
  });

  it("refuses a system from another organisation", async () => {
    const response = await post(unclaim, {
      systemId: "sys-theirs",
      controls: [{ frameworkId: FRAMEWORK, controlId: "ctl-5-2" }],
    });
    expect(response.status).toBe(400);
    expect((await claimsFor("ctl-5-2")).sort()).toEqual(["sys-deepl", "sys-otter"]);
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    const response = await post(unclaim, {
      systemId: "sys-otter",
      controls: [{ frameworkId: FRAMEWORK, controlId: "ctl-5-2" }],
    });
    expect(response.status).toBe(403);
  });
});

describe("unfiling a risk from a system", () => {
  beforeEach(async () => {
    await saveUseCase(
      ORG_A,
      {
        id: "uc-notes",
        systemOverrides: [],
        systemIds: ["sys-otter"],
        name: "Meeting notes",
        description: "Summarises recorded calls.",
        businessUnit: "Technology",
        ownerId: "p-devi",
        riskTier: "limited",
        oversightLevel: "human_in_the_loop",
        oversightSummary: "Someone reads every output",
        facesCustomers: false,
        informsDecisionsAboutPeople: false,
        dataCategories: ["internal"],
        approxUsers: 12,
        status: "active",
        assessmentId: null,
      },
      ACTOR,
    );
    await saveAiRisk(
      ORG_A,
      makeRisk("r-plain", "Drift goes unnoticed", { systemId: "sys-otter" }),
      ACTOR,
    );
    await saveAiRisk(
      ORG_A,
      makeRisk("r-usecase", "Summaries misquote a customer", {
        systemId: "sys-otter",
        useCaseId: "uc-notes",
      }),
      ACTOR,
    );
  });

  it("returns it to organisation level", async () => {
    const before = await readAiRisk(ORG_A, "r-plain");
    const response = await post(unfileRisk, {
      riskId: "r-plain",
      systemId: "sys-otter",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(200);
    expect((await readAiRisk(ORG_A, "r-plain"))?.systemId).toBeNull();
  });

  it("clears the use case with it", async () => {
    /* A use case's own system is NOT NULL, so a risk naming one is
     * transitively about that use case's system. Leaving the reference behind
     * would have the risk belong to no system and to one system's use case at
     * the same time. */
    const before = await readAiRisk(ORG_A, "r-usecase");
    const response = await post(unfileRisk, {
      riskId: "r-usecase",
      systemId: "sys-otter",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(200);

    const after = await readAiRisk(ORG_A, "r-usecase");
    expect(after?.systemId).toBeNull();
    expect(after?.useCaseId).toBeNull();
  });

  it("hands the client a risk carrying its version", async () => {
    /*
     * The unfile dialog reads `expectedVersion` off the workspace, not off
     * `readAiRisk`. Every other test here builds the version from the store
     * directly, so none of them would notice `readWorkspace` dropping it — and
     * if it did, `expectedVersion` would arrive undefined, `checkVersion` would
     * no-op, and this route's 409 guarantee would be silently hollow.
     */
    const ws = await readWorkspace(ORG_A);
    const risk = ws.risks.find((r) => r.id === "r-plain");
    expect(risk?.version).toEqual(expect.any(Number));
  });

  it("refuses when the risk is no longer on the system the caller named", async () => {
    const before = await readAiRisk(ORG_A, "r-plain");
    const response = await post(unfileRisk, {
      riskId: "r-plain",
      systemId: "sys-deepl",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(409);
    expect((await readAiRisk(ORG_A, "r-plain"))?.systemId).toBe("sys-otter");
  });

  it("refuses a stale version rather than discarding the other edit", async () => {
    const before = await readAiRisk(ORG_A, "r-plain");
    await saveAiRisk(ORG_A, { ...before!, title: "Renamed by somebody else" }, ACTOR);

    const response = await post(unfileRisk, {
      riskId: "r-plain",
      systemId: "sys-otter",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(409);
    expect((await readAiRisk(ORG_A, "r-plain"))?.systemId).toBe("sys-otter");
  });

  it("does not find a risk belonging to another organisation", async () => {
    await saveAiRisk(
      ORG_B,
      makeRisk("r-theirs", "Theirs", { systemId: "sys-theirs" }),
      ACTOR,
    );
    const response = await post(unfileRisk, {
      riskId: "r-theirs",
      systemId: "sys-theirs",
    });
    expect(response.status).toBe(404);
    expect((await readAiRisk(ORG_B, "r-theirs"))?.systemId).toBe("sys-theirs");
  });
});

describe("unfiling a finding from a system", () => {
  beforeEach(async () => {
    await saveAiFinding(
      ORG_A,
      makeFinding("f-one", "No output sampling", {
        systemId: "sys-otter",
        controlId: "ctl-a8-4",
      }),
      ACTOR,
    );
  });

  it("returns it to organisation level and keeps its control", async () => {
    /* Unlike a risk's use case: a framework control belongs to no system, so
     * a finding against A.8.4 is still against A.8.4. */
    const response = await post(unfileFinding, {
      findingId: "f-one",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(200);

    const after = await readAiFinding(ORG_A, "f-one");
    expect(after?.systemId).toBeNull();
    expect(after?.controlId).toBe("ctl-a8-4");
  });

  it("refuses when the finding is already at organisation level", async () => {
    await post(unfileFinding, { findingId: "f-one", systemId: "sys-otter" });

    const response = await post(unfileFinding, {
      findingId: "f-one",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already held at organisation level/i);
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    const response = await post(unfileFinding, {
      findingId: "f-one",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(403);
    expect((await readAiFinding(ORG_A, "f-one"))?.systemId).toBe("sys-otter");
  });
});
