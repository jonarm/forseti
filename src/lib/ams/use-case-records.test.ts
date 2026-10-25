import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AIUseCase } from "@/lib/ams/types";

/**
 * The use case register on the shared record machinery.
 *
 * Most of this is the same shape as `risk-records.test.ts` and deliberately so —
 * an eighth caller of the generic routes is worth having only if it proves the
 * abstraction still holds. What is *not* shared, and is what these tests exist
 * for, is the pair of judgements this register makes differently:
 *
 *   - **A use case cannot be created against a system it does not belong to.**
 *     `ai_use_case.system_id` is half of a composite foreign key with the
 *     organisation, so a body naming another tenant's system has to be refused
 *     in the route rather than discovered as a constraint violation, and a body
 *     naming a system that does not exist has to be a 404 rather than a 500.
 *
 *   - **The purge clears references nothing cascades from.** `ai_risk.use_case_id`
 *     has no foreign key into this table, so a purged use case would otherwise
 *     leave risks pointing at an id that no longer resolves. This is the one
 *     purge in the codebase that does more than delete, and it is the test that
 *     would catch somebody simplifying it back down.
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
const { aiPerson, aiRisk, aiUseCase } = await import("@/db/schema");
const {
  TRASH_RETENTION_DAYS,
  deleteUseCase,
  purgeExpiredUseCases,
  readActivityByKind,
  readAiRisks,
  readDeletedUseCases,
  saveAiRisk,
  saveAiSystem,
  saveUseCase,
  readUseCases,
} = await import("@/lib/ai-store");
const { newSystem } = await import("@/lib/ams/system-create");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");
const { POST: RESTORE_RECORDS } = await import("@/app/api/records/[kind]/restore/route");
const { POST: createUseCase } = await import("@/app/api/use-cases/create/route");
const { POST: editUseCase } = await import("@/app/api/use-cases/route");
const { POST: linkSystems } = await import("@/app/api/use-cases/link/route");
const { POST: unlinkSystems } = await import("@/app/api/use-cases/unlink/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

function makeUseCase(
  id: string,
  name: string,
  systemIds: string[],
  over: Partial<AIUseCase> = {},
): AIUseCase {
  return {
    id,
    systemIds,
    systemOverrides: [],
    name,
    description: "What it does",
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
    ...over,
  };
}

function call(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
  kind = "useCase",
) {
  return handler(
    new Request(`http://localhost/api/records/${kind}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind }) },
  );
}

const remove = (body: unknown, kind?: string) =>
  call(DELETE_RECORDS, "delete", body, kind);
const exportUseCases = (body: unknown, kind?: string) =>
  call(EXPORT_RECORDS, "export", body, kind);
const restore = (body: unknown, kind?: string) =>
  call(RESTORE_RECORDS, "restore", body, kind);

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

/** A body the create schema accepts, so each test varies only what it is about. */
function createBody(over: Record<string, unknown> = {}) {
  return {
    name: "Summarising customer support calls",
    systemIds: ["sys-otter"],
    description: "Transcribes and summarises recorded support calls.",
    businessUnit: "Sales",
    ownerId: "p-devi",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary: "The account manager reads every summary.",
    status: "active",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["customer_content"],
    approxUsers: 40,
    ...over,
  };
}

/** A registered system, in the shape `newSystem` builds one. */
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

async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteUseCase(organizationId, id, ACTOR);
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiUseCase)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(and(eq(aiUseCase.organizationId, organizationId), eq(aiUseCase.id, id)));
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

  /* A use case's system is a real foreign key, so the systems come first. */
  await saveAiSystem(ORG_A, makeSystem("sys-otter", "Otter.ai"), ACTOR);
  await saveAiSystem(ORG_B, makeSystem("sys-theirs", "Their tool"), ACTOR);

  await saveUseCase(
    ORG_A,
    makeUseCase("uc-one", "Summarising support calls", ["sys-otter"]),
    ACTOR,
  );
  await saveUseCase(
    ORG_A,
    makeUseCase("uc-two", "Screening applicants", ["sys-otter"], {
      riskTier: "high",
      oversightLevel: "none",
      facesCustomers: true,
      informsDecisionsAboutPeople: true,
      businessUnit: "People",
    }),
    ACTOR,
  );
  await saveUseCase(
    ORG_B,
    makeUseCase("uc-theirs", "Somebody else's use case", ["sys-theirs"], {
      ownerId: "",
    }),
    ACTOR,
  );
});

describe("which systems implement a use case", () => {
  const systemsOf = async (id: string) =>
    ((await readUseCases(ORG_A)).find((u) => u.id === id)?.systemIds ?? []).sort();

  const version = async (id: string) =>
    (await readUseCases(ORG_A)).find((u) => u.id === id)?.version;

  beforeEach(async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-zoom", "Zoom AI"), ACTOR);
  });

  it("adds a system without disturbing the ones already there", async () => {
    const response = await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-zoom"],
      expectedVersion: await version("uc-one"),
    });
    expect(response.status).toBe(200);
    expect(await systemsOf("uc-one")).toEqual(["sys-otter", "sys-zoom"]);
  });

  it("reports a system already linked rather than writing again", async () => {
    const response = await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-otter"],
      expectedVersion: await version("uc-one"),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.added).toEqual([]);
    expect(body.already).toEqual(["sys-otter"]);
  });

  it("refuses a system from another organisation", async () => {
    const response = await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-theirs"],
      expectedVersion: await version("uc-one"),
    });
    expect(response.status).toBe(400);
    expect(await systemsOf("uc-one")).toEqual(["sys-otter"]);
  });

  it("removes one system and leaves the rest", async () => {
    await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-zoom"],
      expectedVersion: await version("uc-one"),
    });

    const response = await post(unlinkSystems, "/api/use-cases/unlink", {
      useCaseId: "uc-one",
      systemIds: ["sys-otter"],
      expectedVersion: await version("uc-one"),
    });
    expect(response.status).toBe(200);
    expect(await systemsOf("uc-one")).toEqual(["sys-zoom"]);
  });

  it("refuses to unlink the last system", async () => {
    /* A purpose nothing implements is not a purpose. The join cannot express a
     * minimum, so the route is the only thing holding this — and without it the
     * use case would drop out of every register at once with no tombstone and
     * no trash entry to find it by. */
    const response = await post(unlinkSystems, "/api/use-cases/unlink", {
      useCaseId: "uc-one",
      systemIds: ["sys-otter"],
      expectedVersion: await version("uc-one"),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/only system|no system/i);
    expect(await systemsOf("uc-one")).toEqual(["sys-otter"]);
  });

  it("refuses to unlink every system at once", async () => {
    await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-zoom"],
      expectedVersion: await version("uc-one"),
    });

    const response = await post(unlinkSystems, "/api/use-cases/unlink", {
      useCaseId: "uc-one",
      systemIds: ["sys-otter", "sys-zoom"],
      expectedVersion: await version("uc-one"),
    });
    expect(response.status).toBe(409);
    expect(await systemsOf("uc-one")).toEqual(["sys-otter", "sys-zoom"]);
  });

  it("refuses a stale version rather than discarding the other edit", async () => {
    const stale = await version("uc-one");
    await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-zoom"],
      expectedVersion: stale,
    });

    const response = await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-one",
      systemIds: ["sys-theirs2"],
      expectedVersion: stale,
    });
    expect([400, 409]).toContain(response.status);
  });

  it("will not reach another organisation's use case", async () => {
    const response = await post(linkSystems, "/api/use-cases/link", {
      useCaseId: "uc-theirs",
      systemIds: ["sys-otter"],
    });
    expect(response.status).toBe(404);
  });
});

describe("adding a use case", () => {
  it("stores it and mints the id server-side", async () => {
    const response = await post(createUseCase, "/api/use-cases/create", createBody());
    expect(response.status).toBe(201);

    const { useCase } = await response.json();
    expect(useCase.id).toMatch(/^uc-summarising-customer-support-calls-[a-z0-9]{6}$/);
    expect(useCase.version).toBe(1);

    const stored = await readUseCases(ORG_A);
    expect(stored.map((u) => u.id)).toContain(useCase.id);
  });

  it("refuses a system that is not in the caller's inventory", async () => {
    /* The whole reason the route reads every system first. Left to the database
     * this is a composite foreign key violation on the join and a 500, on a
     * request that deserves a plain answer. */
    const response = await post(
      createUseCase,
      "/api/use-cases/create",
      createBody({ systemIds: ["sys-theirs"] }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).fields.systemIds).toMatch(/your own register/i);
    expect(await readUseCases(ORG_A)).toHaveLength(2);
  });

  it("refuses the whole body when only one of several systems is foreign", async () => {
    /* Half a use case is worse than none: filing it against the one system that
     * resolved would record the purpose as narrower than the caller said it
     * was, and nothing would ever say so. */
    const response = await post(
      createUseCase,
      "/api/use-cases/create",
      createBody({ systemIds: ["sys-otter", "sys-theirs"] }),
    );

    expect(response.status).toBe(404);
    expect(await readUseCases(ORG_A)).toHaveLength(2);
  });

  it("stores every system it was given", async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-zoom", "Zoom AI"), ACTOR);

    const response = await post(
      createUseCase,
      "/api/use-cases/create",
      createBody({ systemIds: ["sys-otter", "sys-zoom"] }),
    );
    expect(response.status).toBe(201);

    const { useCase } = await response.json();
    const stored = (await readUseCases(ORG_A)).find((u) => u.id === useCase.id);
    expect(stored?.systemIds.sort()).toEqual(["sys-otter", "sys-zoom"]);
  });

  it("refuses a body with no system at all", async () => {
    // A risk with no system is organisation-wide and ordinary. A use case with
    // no system is nothing at all — the one place these two specs diverge.
    const response = await post(
      createUseCase,
      "/api/use-cases/create",
      createBody({ systemIds: [] }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).fields.systemIds).toBeDefined();
  });

  it("cannot be handed an assessment it has not been given", async () => {
    /* `assessmentId` is derived from the assessment that names the use case. A
     * create body asserting one would claim an assessment covers something the
     * assessment says nothing about — the same forged link the risk importer
     * refuses to carry across in its acceptance. The schema is strict, so the
     * body is refused outright rather than quietly stripped. */
    const response = await post(
      createUseCase,
      "/api/use-cases/create",
      createBody({ assessmentId: "asmt-anything" }),
    );

    expect(response.status).toBe(400);
  });

  it("checks the use case resource, not the inventory's", async () => {
    requirePermission.mockClear();
    await post(createUseCase, "/api/use-cases/create", createBody());

    expect(requirePermission).toHaveBeenCalledWith(
      { useCase: ["create"] },
      expect.any(String),
    );
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    const response = await post(createUseCase, "/api/use-cases/create", createBody());

    expect(response.status).toBe(403);
    expect(await readUseCases(ORG_A)).toHaveLength(2);
  });
});

describe("correcting a use case", () => {
  it("changes the tier and the two questions", async () => {
    const response = await post(editUseCase, "/api/use-cases", {
      useCaseId: "uc-one",
      changes: { riskTier: "high", informsDecisionsAboutPeople: true },
      expectedVersion: 1,
    });

    expect(response.status).toBe(200);
    const { useCase } = await response.json();
    expect(useCase.riskTier).toBe("high");
    expect(useCase.informsDecisionsAboutPeople).toBe(true);
    expect(useCase.version).toBe(2);
  });

  it("refuses a save against a version somebody else has moved past", async () => {
    await post(editUseCase, "/api/use-cases", {
      useCaseId: "uc-one",
      changes: { riskTier: "high" },
      expectedVersion: 1,
    });

    // The second tab, still holding version 1.
    const response = await post(editUseCase, "/api/use-cases", {
      useCaseId: "uc-one",
      changes: { businessUnit: "Sales" },
      expectedVersion: 1,
    });

    expect(response.status).toBe(409);
    const stored = (await readUseCases(ORG_A)).find((u) => u.id === "uc-one");
    expect(stored?.businessUnit).toBe("Technology");
  });

  it("will not change a use case's systems through the edit route", async () => {
    /* The systems are a relation, not a field: they live in
     * `ai_use_case_system` and move through `/api/use-cases/{link,unlink}`,
     * where the in-organisation check and the last-system rule are. `EDITABLE`
     * is an allowlist of scalars, so both spellings are ignored rather than
     * refused — and neither reaches the join. */
    await post(editUseCase, "/api/use-cases", {
      useCaseId: "uc-one",
      changes: { systemIds: ["sys-theirs"], systemId: "sys-theirs" },
      expectedVersion: 1,
    });

    const stored = (await readUseCases(ORG_A)).find((u) => u.id === "uc-one");
    expect(stored?.systemIds).toEqual(["sys-otter"]);
  });

  it("will not reach another organization's use case", async () => {
    const response = await post(editUseCase, "/api/use-cases", {
      useCaseId: "uc-theirs",
      changes: { riskTier: "unacceptable" },
    });

    expect(response.status).toBe(404);
    const theirs = (await readUseCases(ORG_B)).find((u) => u.id === "uc-theirs");
    expect(theirs?.riskTier).toBe("limited");
  });

  it("refuses a tier that is not one of ours", async () => {
    const response = await post(editUseCase, "/api/use-cases", {
      useCaseId: "uc-one",
      changes: { riskTier: "catastrophic" },
    });

    expect(response.status).toBe(400);
  });
});

describe("removing use cases through the generic route", () => {
  it("removes the ones it is given and names them", async () => {
    const response = await remove({ ids: ["uc-one"] });
    expect(response.status).toBe(200);

    const { deleted, refused } = await response.json();
    expect(refused).toEqual([]);
    expect(deleted).toEqual([{ id: "uc-one", name: "Summarising support calls" }]);

    expect((await readUseCases(ORG_A)).map((u) => u.id)).toEqual(["uc-two"]);
  });

  it("will not reach another organization's register", async () => {
    const { deleted, refused } = await (await remove({ ids: ["uc-theirs"] })).json();

    expect(deleted).toEqual([]);
    expect(refused).toHaveLength(1);
    expect((await readUseCases(ORG_B)).map((u) => u.id)).toEqual(["uc-theirs"]);
  });

  it("checks the use case resource, not the inventory's", async () => {
    requirePermission.mockClear();
    await remove({ ids: ["uc-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { useCase: ["delete"] },
      expect.any(String),
    );
  });

  it("leaves the risks filed against it on their own register", async () => {
    /* A risk is a register row in its own right. Hiding it because its use case
     * went would make it vanish from a register nobody deleted it from, with no
     * trash entry to find it in. */
    await saveAiRisk(
      ORG_A,
      {
        id: "risk-one",
        title: "Screening is unfair",
        systemId: "sys-otter",
        useCaseId: "uc-two",
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
      },
      ACTOR,
    );

    await remove({ ids: ["uc-two"] });

    const risks = await readAiRisks(ORG_A);
    expect(risks.map((r) => r.id)).toEqual(["risk-one"]);
    expect(risks[0].useCaseId).toBe("uc-two");
  });
});

describe("exporting use cases", () => {
  it("carries the use case catalogue, with the two questions as words", async () => {
    const response = await exportUseCases({
      format: "csv",
      columns: ["name", "system", "riskTier", "facesCustomers", "informsDecisionsAboutPeople"],
      ids: ["uc-two"],
    });

    expect(response.status).toBe(200);
    const [header, row] = (await response.text()).split("\n").map((l) => l.split(","));

    expect(header).toEqual([
      "Use case",
      "System",
      "Risk tier",
      "Faces customers",
      "Informs decisions about people",
    ]);
    expect(row[1]).toBe("Otter.ai");
    expect(row[2]).toBe("High");
    /* Words rather than TRUE/FALSE: a spreadsheet of booleans is one nobody can
     * filter meaningfully in a meeting. */
    expect(row[3]).toBe("Yes");
    expect(row[4]).toBe("Yes");
  });

  it("names the absent assessment rather than exporting an empty cell", async () => {
    const response = await exportUseCases({
      format: "csv",
      columns: ["name", "assessment"],
      ids: ["uc-one"],
    });

    const [, row] = (await response.text()).split("\n").map((l) => l.split(","));
    expect(row[1]).toBe("Covered by system");
  });

  it("records the export against the use case register", async () => {
    await exportUseCases({ format: "csv", columns: ["name"], ids: ["uc-one"] });

    const trail = await readActivityByKind(ORG_A, "organization");
    const entry = trail.find((e) => e.action === "exported the Use cases");

    expect(entry).toBeDefined();
    expect(entry?.after).toContain("1 use case");
  });

  it("will not export another organization's use case", async () => {
    const response = await exportUseCases({
      format: "csv",
      columns: ["name"],
      ids: ["uc-theirs"],
    });

    expect(response.status).toBe(404);
  });
});

describe("the trash, for the use case register", () => {
  it("lists a removed use case and puts it back", async () => {
    await deleteUseCase(ORG_A, "uc-one", { userId: "user-a" });

    const trash = await readDeletedUseCases(ORG_A);
    expect(trash.map((u) => u.id)).toEqual(["uc-one"]);
    expect(trash[0].deletedBy).toBe("user-a");

    const { restored } = await (await restore({ ids: ["uc-one"] })).json();
    expect(restored).toEqual(["uc-one"]);
    expect((await readUseCases(ORG_A)).map((u) => u.id).sort()).toEqual([
      "uc-one",
      "uc-two",
    ]);
  });

  it("does not bump the version on a restore", async () => {
    // A restore is not an edit, so somebody holding the record open from before
    // the deletion can still save against the version they read.
    await deleteUseCase(ORG_A, "uc-one", ACTOR);
    await restore({ ids: ["uc-one"] });

    const restored = (await readUseCases(ORG_A)).find((u) => u.id === "uc-one");
    // 1 from the save, 1 from the delete; the restore adds nothing.
    expect(restored?.version).toBe(2);
  });

  it("purges only what is overdue", async () => {
    await removedDaysAgo(ORG_A, "uc-one", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_A, "uc-two", TRASH_RETENTION_DAYS - 1);

    const purged = await purgeExpiredUseCases(ORG_A);
    expect(purged.map((u) => u.id)).toEqual(["uc-one"]);
    expect((await readDeletedUseCases(ORG_A)).map((u) => u.id)).toEqual(["uc-two"]);
  });

  it("clears the risk's reference rather than leaving it dangling", async () => {
    /*
     * The distinctive half of this purge. `ai_risk.use_case_id` is a plain text
     * column with no foreign key into `ai_use_case`, so nothing cascades — and a
     * purged use case would leave the risk register rendering a use case column
     * that resolves to nothing, for a row whose history no longer explains why.
     */
    await saveAiRisk(
      ORG_A,
      {
        id: "risk-one",
        title: "Screening is unfair",
        systemId: "sys-otter",
        useCaseId: "uc-two",
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
      },
      ACTOR,
    );

    await removedDaysAgo(ORG_A, "uc-two", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredUseCases(ORG_A);

    const risks = await readAiRisks(ORG_A);
    // The risk survives. Its pointer does not.
    expect(risks.map((r) => r.id)).toEqual(["risk-one"]);
    expect(risks[0].useCaseId).toBeNull();
  });

  it("will not clear another organization's reference", async () => {
    const { and, eq } = await import("drizzle-orm");

    await saveAiRisk(
      ORG_B,
      {
        id: "risk-theirs",
        title: "Their risk",
        systemId: "sys-theirs",
        /* The same id as the one being purged in A. Nothing stops two tenants
         * minting the same record id, and a purge scoped only by id would blank
         * this column for a tenant that was never in scope. */
        useCaseId: "uc-two",
        controlIds: [],
        inherentLikelihood: 4,
        inherentImpact: 4,
        treatment: "mitigate",
        treatmentSummary: "Reviewed quarterly",
        residualLikelihood: 2,
        residualImpact: 3,
        ownerId: "",
        status: "open",
        acceptedById: null,
        acceptedAt: null,
      },
      ACTOR,
    );

    await removedDaysAgo(ORG_A, "uc-two", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredUseCases(ORG_A);

    const [theirs] = await testDb
      .select({ useCaseId: aiRisk.useCaseId })
      .from(aiRisk)
      .where(and(eq(aiRisk.organizationId, ORG_B), eq(aiRisk.id, "risk-theirs")));

    expect(theirs.useCaseId).toBe("uc-two");
  });

  it("keeps the trail after the row is gone for good", async () => {
    await removedDaysAgo(ORG_A, "uc-one", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredUseCases(ORG_A);

    const actions = (await readActivityByKind(ORG_A, "use_case"))
      .filter((e) => e.subjectId === "uc-one")
      .map((e) => e.action);

    expect(actions).toContain("deleted the use case");
    expect(actions).toContain(
      "permanently removed the use case after its retention window",
    );
  });

  it("will not purge another organization's overdue use case", async () => {
    await removedDaysAgo(ORG_B, "uc-theirs", TRASH_RETENTION_DAYS + 5);
    await removedDaysAgo(ORG_A, "uc-one", TRASH_RETENTION_DAYS + 5);

    await purgeExpiredUseCases(ORG_A);

    expect(await readDeletedUseCases(ORG_B)).toHaveLength(1);
  });
});
