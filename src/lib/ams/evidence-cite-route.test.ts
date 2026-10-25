import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { ControlApplicability, Evidence } from "@/lib/ams/types";

/**
 * Citing evidence on a control, and taking it off again.
 *
 * The first write in the product that creates an `ai_evidence_link` row with
 * `targetKind: "control"`. Everything that reads that join — the readiness
 * figures, the coverage column, the SoA lenses, the audit pack — was computing
 * over rows only the demo seed could produce, so the tests are about the three
 * ways this could go wrong now that a person can write them:
 *
 *   - **A citation must not replace what the document already has.**
 *     `saveAiEvidence` rewrites *every* link row for the document it is handed,
 *     controls and systems together. The route is what makes citing additive,
 *     and a version that wrote the client's copy would take a document's systems
 *     away as a side effect of proving a control with it.
 *
 *   - **A control the SoA excludes cannot be cited on**, the same rule
 *     `/api/applicability/claim` enforces and for the same reason: evidence
 *     filed against a control the organisation says it need not satisfy sits in
 *     a coverage figure the SoA says is empty.
 *
 *   - **The citation has to reach the readiness maths, not only the panel.**
 *     `isUsableEvidence` asks whether a document is verified and unexpired, so
 *     citing a lapsed one moves the count and must leave `evidenced` alone. That
 *     difference is the whole reason the "relying on an expired document" lens
 *     exists, and a join wired only to the panel would report it as proof.
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
const { readAiEvidence, readApplicability, saveAiEvidence, saveApplicability } =
  await import("@/lib/ai-store");
const { EMPTY_WORKSPACE, workspace } = await import("@/lib/ams/workspace");
const { frameworkReadiness } = await import("@/lib/ams/readiness");
const { POST: cite } = await import("@/app/api/records/evidence/cite/route");
const { POST: uncite } = await import("@/app/api/records/evidence/uncite/route");

const ACTOR = { userId: "seed" };

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  handler(
    new Request(`http://localhost/api/records/evidence/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const citeOn = (controlId: string, evidenceIds: string[]) =>
  post(cite, "cite", { frameworkId: FRAMEWORK, controlId, evidenceIds });

const unciteFrom = (controlId: string, evidenceIds: string[]) =>
  post(uncite, "uncite", { frameworkId: FRAMEWORK, controlId, evidenceIds });

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

/** What the control says proves it, read back through the join. */
const evidenceOn = async (organizationId: string, controlId: string) =>
  (await readApplicability(organizationId, FRAMEWORK)).find(
    (row) => row.controlId === controlId,
  )?.linkedEvidenceIds ?? [];

const documentIn = async (organizationId: string, id: string) =>
  (await readAiEvidence(organizationId)).find((doc) => doc.id === id);

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

  await saveApplicability(ORG_A, makeRow("ctl-5-2"), ACTOR);
  await saveApplicability(ORG_A, makeRow("ctl-6-1"), ACTOR);
  await saveApplicability(
    ORG_A,
    makeRow("ctl-9-9", { applicability: "na", justification: "We build nothing." }),
    ACTOR,
  );

  await saveAiEvidence(ORG_A, makeEvidence("ev-policy", "AI policy"), ACTOR);
  await saveAiEvidence(
    ORG_A,
    makeEvidence("ev-minutes", "Governance forum minutes", {
      linkedControlIds: ["ctl-6-1"],
      linkedSystemIds: ["sys-otter"],
    }),
    ACTOR,
  );
  await saveAiEvidence(
    ORG_A,
    makeEvidence("ev-lapsed", "Last year's DPIA", { expiresAt: "2026-01-01" }),
    ACTOR,
  );
  await saveAiEvidence(ORG_B, makeEvidence("ev-theirs", "Their SOC 2"), ACTOR);
});

describe("citing evidence on a control", () => {
  it("cites it, and the control can see it", async () => {
    const response = await citeOn("ctl-5-2", ["ev-policy"]);
    expect(response.status).toBe(200);

    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual(["ev-policy"]);
    expect((await documentIn(ORG_A, "ev-policy"))?.linkedControlIds).toEqual(["ctl-5-2"]);
  });

  it("adds to what the document already proves rather than replacing it", async () => {
    /* `saveAiEvidence` deletes and re-inserts every link row for the document,
     * so the union has to happen in the route. Without it, citing a document on
     * one control would silently take it off every other. */
    const response = await citeOn("ctl-5-2", ["ev-minutes"]);
    expect(response.status).toBe(200);

    const doc = await documentIn(ORG_A, "ev-minutes");
    expect(doc?.linkedControlIds.sort()).toEqual(["ctl-5-2", "ctl-6-1"]);
  });

  it("leaves the document's systems alone", async () => {
    /* Controls and systems are rows in the same table, written by the same
     * call. A citation that dropped the systems would quietly empty
     * `linkedSystemIds` — which does not mean "unfiled" but "organisation-wide",
     * so the document would start counting toward every system in the register. */
    await citeOn("ctl-5-2", ["ev-minutes"]);

    const doc = await documentIn(ORG_A, "ev-minutes");
    expect(doc?.linkedSystemIds).toEqual(["sys-otter"]);
  });

  it("refuses a control the Statement of Applicability puts out of scope", async () => {
    const response = await citeOn("ctl-9-9", ["ev-policy"]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/out of scope/i);
    expect(await evidenceOn(ORG_A, "ctl-9-9")).toEqual([]);
  });

  it("refuses a control this framework does not have", async () => {
    const response = await citeOn("ctl-nothing", ["ev-policy"]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /not in this framework/i,
    );
  });

  it("reports a document already cited rather than writing it twice", async () => {
    await citeOn("ctl-5-2", ["ev-policy"]);
    const response = await citeOn("ctl-5-2", ["ev-policy"]);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      cited: unknown[];
      refused: { reason: string }[];
    };
    expect(body.cited).toHaveLength(0);
    expect(body.refused[0].reason).toMatch(/already cited/i);
    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual(["ev-policy"]);
  });

  it("cites the documents it can and reports the rest", async () => {
    const response = await citeOn("ctl-5-2", ["ev-policy", "ev-theirs", "ev-nothing"]);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      cited: { id: string }[];
      refused: { id: string; reason: string }[];
    };
    expect(body.cited.map((row) => row.id)).toEqual(["ev-policy"]);
    // Another organisation's document is simply not in this register.
    expect(body.refused.map((row) => row.id).sort()).toEqual(["ev-nothing", "ev-theirs"]);
    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual(["ev-policy"]);
  });

  it("cannot reach another organisation's document", async () => {
    await citeOn("ctl-5-2", ["ev-theirs"]);
    expect((await documentIn(ORG_B, "ev-theirs"))?.linkedControlIds).toEqual([]);
  });

  it("is refused without the statement", async () => {
    permitted = false;
    const response = await citeOn("ctl-5-2", ["ev-policy"]);
    expect(response.status).toBe(403);
    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual([]);
  });

  it("refuses a batch that names no documents", async () => {
    const response = await citeOn("ctl-5-2", []);
    expect(response.status).toBe(400);
  });
});

describe("what a citation does to the readiness figures", () => {
  /**
   * The panel and the maths have to agree, and they read the join through
   * different questions: the count asks how many documents are attached, and
   * `evidenced` asks how many are *usable*.
   */
  const readiness = async () => {
    const [applicability, evidence] = await Promise.all([
      readApplicability(ORG_A, FRAMEWORK),
      readAiEvidence(ORG_A),
    ]);
    return frameworkReadiness(
      workspace({ ...EMPTY_WORKSPACE, applicability, evidence }),
    );
  };

  it("counts a verified, unexpired document as proof", async () => {
    const before = (await readiness()).evidenced.done;

    await citeOn("ctl-5-2", ["ev-policy"]);

    expect((await readiness()).evidenced.done).toBe(before + 1);
  });

  it("counts an expired one on the control and not in the figure", async () => {
    const before = (await readiness()).evidenced.done;

    await citeOn("ctl-5-2", ["ev-lapsed"]);

    // Attached — the control depends on it, and the panel says so.
    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual(["ev-lapsed"]);
    // Not proof — it stopped being that the day it expired.
    expect((await readiness()).evidenced.done).toBe(before);
  });
});

describe("taking evidence off a control", () => {
  beforeEach(async () => {
    await citeOn("ctl-5-2", ["ev-policy", "ev-minutes"]);
  });

  it("removes the citation", async () => {
    const response = await unciteFrom("ctl-5-2", ["ev-policy"]);
    expect(response.status).toBe(200);
    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual(["ev-minutes"]);
  });

  it("deletes nothing: the document keeps its register, its systems and its other controls", async () => {
    await unciteFrom("ctl-5-2", ["ev-minutes"]);

    const doc = await documentIn(ORG_A, "ev-minutes");
    expect(doc).toBeDefined();
    expect(doc?.linkedControlIds).toEqual(["ctl-6-1"]);
    expect(doc?.linkedSystemIds).toEqual(["sys-otter"]);
  });

  it("leaves the control in the Statement of Applicability when the last one goes", async () => {
    await unciteFrom("ctl-5-2", ["ev-policy", "ev-minutes"]);

    const row = (await readApplicability(ORG_A, FRAMEWORK)).find(
      (r) => r.controlId === "ctl-5-2",
    );
    expect(row?.applicability).toBe("yes");
    expect(row?.linkedEvidenceIds).toEqual([]);
  });

  it("refuses a document that does not cite this control", async () => {
    const response = await unciteFrom("ctl-6-1", ["ev-policy"]);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      uncited: unknown[];
      refused: { reason: string }[];
    };
    expect(body.uncited).toHaveLength(0);
    expect(body.refused[0].reason).toMatch(/not cited/i);
  });

  it("still works once the control has gone out of scope", async () => {
    /* The scope rule exists to stop evidence arriving on an excluded control,
     * not to trap it there. A control taken out of scope afterwards would
     * otherwise keep citations nobody could clear. */
    await saveApplicability(
      ORG_A,
      makeRow("ctl-5-2", {
        applicability: "na",
        justification: "Out of scope after the re-scoping in August.",
      }),
      ACTOR,
    );

    const response = await unciteFrom("ctl-5-2", ["ev-policy"]);
    expect(response.status).toBe(200);
    expect(await evidenceOn(ORG_A, "ctl-5-2")).toEqual(["ev-minutes"]);
  });

  it("is refused without the statement", async () => {
    permitted = false;
    const response = await unciteFrom("ctl-5-2", ["ev-policy"]);
    expect(response.status).toBe(403);
    expect((await evidenceOn(ORG_A, "ctl-5-2")).sort()).toEqual(["ev-minutes", "ev-policy"]);
  });
});
