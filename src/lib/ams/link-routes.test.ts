import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { Evidence, Finding, Risk } from "@/lib/ams/types";

/**
 * Attaching a record that already exists to a system.
 *
 * Three routes, one behaviour to prove per register, and the differences
 * between them are the whole point — a single test file so the asymmetry is
 * legible in one place rather than inferred from three:
 *
 *   - **Evidence attaches.** `ai_evidence_link` holds a set, so a document can
 *     support many systems and linking adds one without removing another. The
 *     test that matters is the refusal: a document with *no* system links is
 *     organisation-wide and already counts toward every system's coverage, so
 *     linking it to one would silently narrow it. That is the failure a person
 *     clicking "Link existing" would never predict, and the route refuses it.
 *
 *   - **Risks and findings file.** Each carries a single `system_id`, so
 *     attaching is a move. Only organisation-level records may be filed; one
 *     already naming a system is refused with a 409 rather than re-parented,
 *     because a picker on one profile must not be able to take a record off
 *     another's without ever saying what it displaced.
 *
 *   - **Nothing crosses a tenant boundary.** Every id — the record and the
 *     system — is resolved in the caller's own organisation, so an id from
 *     elsewhere is not found rather than written to.
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
  saveAiEvidence,
  saveAiFinding,
  saveAiRisk,
  saveAiSystem,
} = await import("@/lib/ai-store");
const { newSystem } = await import("@/lib/ams/system-create");
const { POST: linkEvidence } = await import(
  "@/app/api/records/evidence/link/route"
);
const { POST: fileRisk } = await import("@/app/api/risks/file/route");
const { POST: fileFinding } = await import("@/app/api/findings/file/route");

const ACTOR = { userId: "seed" };

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  handler(
    new Request(`http://localhost${path}`, {
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

describe("linking existing evidence to a system", () => {
  beforeEach(async () => {
    await saveAiEvidence(
      ORG_A,
      makeEvidence("ev-soc2", "SOC 2 Type II", { linkedSystemIds: ["sys-deepl"] }),
      ACTOR,
    );
    await saveAiEvidence(
      ORG_A,
      makeEvidence("ev-minutes", "Governance forum minutes"),
      ACTOR,
    );
  });

  it("adds the system without taking away the one it already had", async () => {
    const response = await post(linkEvidence, "/api/records/evidence/link", {
      systemId: "sys-otter",
      evidenceIds: ["ev-soc2"],
    });
    expect(response.status).toBe(200);

    const doc = (await readAiEvidence(ORG_A)).find((e) => e.id === "ev-soc2");
    /* Both, and in that order: attaching is additive, which is the entire
     * reason evidence has a link table and not a column. */
    expect(doc?.linkedSystemIds.sort()).toEqual(["sys-deepl", "sys-otter"]);
  });

  it("refuses an organisation-wide document rather than narrowing it", async () => {
    /* An empty link set is not "unfiled" — `coverageForSystem` reads it as
     * covering every system. Linking it to one would drop it out of every other
     * system's coverage figure, silently, from a button that says "link". */
    const response = await post(linkEvidence, "/api/records/evidence/link", {
      systemId: "sys-otter",
      evidenceIds: ["ev-minutes"],
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      linked: unknown[];
      refused: { id: string; reason: string }[];
    };
    expect(body.linked).toHaveLength(0);
    expect(body.refused[0].id).toBe("ev-minutes");
    expect(body.refused[0].reason).toMatch(/organisation-wide/i);

    const doc = (await readAiEvidence(ORG_A)).find((e) => e.id === "ev-minutes");
    expect(doc?.linkedSystemIds).toEqual([]);
  });

  it("files the good documents and reports the refused ones", async () => {
    const response = await post(linkEvidence, "/api/records/evidence/link", {
      systemId: "sys-otter",
      evidenceIds: ["ev-soc2", "ev-minutes", "ev-nothing"],
    });

    const body = (await response.json()) as {
      linked: { id: string }[];
      refused: { id: string }[];
    };
    // One document's refusal is not the batch's.
    expect(body.linked.map((r) => r.id)).toEqual(["ev-soc2"]);
    expect(body.refused.map((r) => r.id).sort()).toEqual(["ev-minutes", "ev-nothing"]);
  });

  it("reports a document already on this system rather than writing again", async () => {
    const response = await post(linkEvidence, "/api/records/evidence/link", {
      systemId: "sys-deepl",
      evidenceIds: ["ev-soc2"],
    });
    const body = (await response.json()) as { refused: { reason: string }[] };
    expect(body.refused[0].reason).toMatch(/already linked/i);
  });

  it("refuses a system from another organisation", async () => {
    const response = await post(linkEvidence, "/api/records/evidence/link", {
      systemId: "sys-theirs",
      evidenceIds: ["ev-soc2"],
    });
    expect(response.status).toBe(400);

    const doc = (await readAiEvidence(ORG_A)).find((e) => e.id === "ev-soc2");
    expect(doc?.linkedSystemIds).toEqual(["sys-deepl"]);
  });

  it("refuses a caller without the statement, before reading the body", async () => {
    permitted = false;
    const response = await post(linkEvidence, "/api/records/evidence/link", {
      systemId: "sys-otter",
      evidenceIds: ["ev-soc2"],
    });
    expect(response.status).toBe(403);
  });
});

describe("filing an existing risk against a system", () => {
  beforeEach(async () => {
    await saveAiRisk(ORG_A, makeRisk("r-loose", "Model drift goes unnoticed"), ACTOR);
    await saveAiRisk(
      ORG_A,
      makeRisk("r-taken", "Prompt retention exceeds the DPA", {
        systemId: "sys-deepl",
      }),
      ACTOR,
    );
  });

  it("fills in a system the risk never had", async () => {
    const before = await readAiRisk(ORG_A, "r-loose");
    const response = await post(fileRisk, "/api/risks/file", {
      riskId: "r-loose",
      systemId: "sys-otter",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(200);
    expect((await readAiRisk(ORG_A, "r-loose"))?.systemId).toBe("sys-otter");
  });

  it("refuses a risk that already names a system", async () => {
    /* Filing is not transferring. A picker on Otter's profile must not be able
     * to take this risk off DeepL's without ever saying so. */
    const before = await readAiRisk(ORG_A, "r-taken");
    const response = await post(fileRisk, "/api/risks/file", {
      riskId: "r-taken",
      systemId: "sys-otter",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/DeepL/);
    expect((await readAiRisk(ORG_A, "r-taken"))?.systemId).toBe("sys-deepl");
  });

  it("refuses a stale version rather than discarding the other edit", async () => {
    const before = await readAiRisk(ORG_A, "r-loose");
    await saveAiRisk(ORG_A, { ...before!, title: "Renamed by somebody else" }, ACTOR);

    const response = await post(fileRisk, "/api/risks/file", {
      riskId: "r-loose",
      systemId: "sys-otter",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(409);
    expect((await readAiRisk(ORG_A, "r-loose"))?.systemId).toBeNull();
  });

  it("refuses a system from another organisation", async () => {
    const before = await readAiRisk(ORG_A, "r-loose");
    const response = await post(fileRisk, "/api/risks/file", {
      riskId: "r-loose",
      systemId: "sys-theirs",
      expectedVersion: before?.version,
    });
    expect(response.status).toBe(400);
    expect((await readAiRisk(ORG_A, "r-loose"))?.systemId).toBeNull();
  });

  it("does not find a risk belonging to another organisation", async () => {
    await saveAiRisk(ORG_B, makeRisk("r-theirs", "Somebody else's risk"), ACTOR);
    const response = await post(fileRisk, "/api/risks/file", {
      riskId: "r-theirs",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(404);
    expect((await readAiRisk(ORG_B, "r-theirs"))?.systemId).toBeNull();
  });
});

describe("filing an existing finding against a system", () => {
  beforeEach(async () => {
    await saveAiFinding(ORG_A, makeFinding("f-loose", "No output sampling"), ACTOR);
    await saveAiFinding(
      ORG_A,
      makeFinding("f-taken", "DPA not countersigned", { systemId: "sys-deepl" }),
      ACTOR,
    );
  });

  it("fills in a system the finding never had", async () => {
    const response = await post(fileFinding, "/api/findings/file", {
      findingId: "f-loose",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(200);
    expect((await readAiFinding(ORG_A, "f-loose"))?.systemId).toBe("sys-otter");
  });

  it("refuses a finding that already names a system", async () => {
    const response = await post(fileFinding, "/api/findings/file", {
      findingId: "f-taken",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(409);
    expect((await readAiFinding(ORG_A, "f-taken"))?.systemId).toBe("sys-deepl");
  });

  it("refuses a system from another organisation", async () => {
    const response = await post(fileFinding, "/api/findings/file", {
      findingId: "f-loose",
      systemId: "sys-theirs",
    });
    expect(response.status).toBe(400);
    expect((await readAiFinding(ORG_A, "f-loose"))?.systemId).toBeNull();
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    const response = await post(fileFinding, "/api/findings/file", {
      findingId: "f-loose",
      systemId: "sys-otter",
    });
    expect(response.status).toBe(403);
  });
});
