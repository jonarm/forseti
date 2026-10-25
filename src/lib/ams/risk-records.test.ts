import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { Risk } from "@/lib/ams/types";

/**
 * The risk register on the shared record machinery.
 *
 * The inventory proved the layer; this proves it *generalises*, which is a
 * different claim and the one that matters — a shared component that works for
 * exactly one caller is a shared component in name only. So these tests are
 * deliberately the same shape as the inventory's, run through the same generic
 * routes with `kind: "risk"`, and what they check is that nothing about the
 * inventory leaked into the abstraction:
 *
 *   - the delete route resolves the risk store's functions rather than the
 *     system store's, and refuses another tenant's id;
 *   - the export carries the *risk* catalogue, with scores computed by the same
 *     function the register sorts by;
 *   - the trail names the risk register, not the inventory;
 *   - restore and the 30-day purge work for a second table, which is what the
 *     cron's per-kind sweep depends on.
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
const { aiPerson, aiRisk } = await import("@/db/schema");
const {
  TRASH_RETENTION_DAYS,
  deleteAiRisk,
  purgeExpiredRisks,
  readActivityByKind,
  readAiRisks,
  readDeletedAiRisks,
  saveAiRisk,
} = await import("@/lib/ai-store");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");
const { POST: RESTORE_RECORDS } = await import("@/app/api/records/[kind]/restore/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

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

function call(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
  kind = "risk",
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
const exportRisks = (body: unknown, kind?: string) =>
  call(EXPORT_RECORDS, "export", body, kind);
const restore = (body: unknown, kind?: string) =>
  call(RESTORE_RECORDS, "restore", body, kind);

async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteAiRisk(organizationId, id, ACTOR);
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiRisk)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(and(eq(aiRisk.organizationId, organizationId), eq(aiRisk.id, id)));
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

  await saveAiRisk(ORG_A, makeRisk("risk-one", "Model drift goes unnoticed"), ACTOR);
  await saveAiRisk(
    ORG_A,
    makeRisk("risk-two", "Vendor trains on our data", {
      residualLikelihood: 4,
      residualImpact: 5,
      acceptedById: "p-devi",
      acceptedAt: "2026-05-01",
      status: "accepted",
    }),
    ACTOR,
  );
  await saveAiRisk(ORG_B, makeRisk("risk-theirs", "Somebody else's risk"), ACTOR);
});

describe("removing risks through the generic route", () => {
  it("removes the ones it is given and names them", async () => {
    const response = await remove({ ids: ["risk-one"] });
    expect(response.status).toBe(200);

    const { deleted, refused } = await response.json();
    expect(refused).toEqual([]);
    /* A risk is named by its `title` where a system is named by its `name` —
     * the shared route has to find the right field per register. */
    expect(deleted).toEqual([
      { id: "risk-one", name: "Model drift goes unnoticed" },
    ]);

    expect((await readAiRisks(ORG_A)).map((r) => r.id)).toEqual(["risk-two"]);
  });

  it("will not reach another organization's register", async () => {
    const { deleted, refused } = await (await remove({ ids: ["risk-theirs"] })).json();

    expect(deleted).toEqual([]);
    expect(refused).toHaveLength(1);
    expect((await readAiRisks(ORG_B)).map((r) => r.id)).toEqual(["risk-theirs"]);
  });

  it("checks the risk resource, not the inventory's", async () => {
    // The whole point of the registry: the kind in the path decides which
    // statement is asked about. A shared route that asked for `system` would
    // work perfectly here and be wrong.
    requirePermission.mockClear();
    await remove({ ids: ["risk-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { risk: ["delete"] },
      expect.any(String),
    );
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    expect((await remove({ ids: ["risk-one"] })).status).toBe(403);
    expect(await readAiRisks(ORG_A)).toHaveLength(2);
  });

  it("writes one trail entry per risk", async () => {
    await remove({ ids: ["risk-one", "risk-two"] });

    const trail = await readActivityByKind(ORG_A, "risk");
    const deletions = trail.filter((e) => e.action === "deleted the risk");
    expect(deletions.map((e) => e.subjectId).sort()).toEqual([
      "risk-one",
      "risk-two",
    ]);
  });
});

describe("exporting risks", () => {
  it("carries the risk catalogue, with scores computed the way the screen computes them", async () => {
    const response = await exportRisks({
      format: "csv",
      columns: ["title", "residualScore", "residualBand", "acceptedBy"],
      ids: ["risk-two"],
    });

    expect(response.status).toBe(200);
    const [header, row] = (await response.text()).split("\n").map((l) => l.split(","));

    expect(header).toEqual([
      "Risk",
      "Residual score",
      "Residual band",
      "Residue accepted by",
    ]);
    // 4 × 5, the same multiplication `riskScore` does for the table.
    expect(row[1]).toBe("20");
    expect(row[3]).toBe("S. Devi");
  });

  it("names the absent acceptor rather than leaving the cell blank", async () => {
    const response = await exportRisks({
      format: "csv",
      columns: ["title", "acceptedBy"],
      ids: ["risk-one"],
    });

    const [, row] = (await response.text()).split("\n").map((l) => l.split(","));
    /* The question this register exists to answer, and the one most often
     * unanswered. An auditor filtering a spreadsheet for blanks finds nothing;
     * one filtering for "Nobody" finds the gap. */
    expect(row[1]).toBe("Nobody");
  });

  it("says an organisation-wide risk is one, rather than exporting an empty cell", async () => {
    const response = await exportRisks({
      format: "csv",
      columns: ["title", "system"],
      ids: ["risk-one"],
    });

    const [, row] = (await response.text()).split("\n").map((l) => l.split(","));
    expect(row[1]).toBe("Organisation-wide");
  });

  it("records the export against the risk register, not the inventory", async () => {
    await exportRisks({ format: "csv", columns: ["title"], ids: ["risk-one"] });

    const trail = await readActivityByKind(ORG_A, "organization");
    const entry = trail.find((e) => e.action === "exported the Risk register");

    expect(entry).toBeDefined();
    expect(entry?.after).toContain("1 risk");
    expect(entry?.after).toContain("Risk register 2");
  });

  it("will not export another organization's risk", async () => {
    const response = await exportRisks({
      format: "csv",
      columns: ["title"],
      ids: ["risk-theirs"],
    });

    expect(response.status).toBe(404);
  });
});

describe("the trash, for a second register", () => {
  it("lists a removed risk and puts it back", async () => {
    await deleteAiRisk(ORG_A, "risk-one", { userId: "user-a" });

    const trash = await readDeletedAiRisks(ORG_A);
    expect(trash.map((r) => r.id)).toEqual(["risk-one"]);
    expect(trash[0].deletedBy).toBe("user-a");

    const { restored } = await (await restore({ ids: ["risk-one"] })).json();
    expect(restored).toEqual(["risk-one"]);
    expect((await readAiRisks(ORG_A)).map((r) => r.id).sort()).toEqual([
      "risk-one",
      "risk-two",
    ]);
  });

  it("purges only what is overdue", async () => {
    await removedDaysAgo(ORG_A, "risk-one", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_A, "risk-two", TRASH_RETENTION_DAYS - 1);

    const purged = await purgeExpiredRisks(ORG_A);
    expect(purged.map((r) => r.id)).toEqual(["risk-one"]);
    expect((await readDeletedAiRisks(ORG_A)).map((r) => r.id)).toEqual(["risk-two"]);
  });

  it("keeps the trail after the row is gone for good", async () => {
    await removedDaysAgo(ORG_A, "risk-one", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredRisks(ORG_A);

    const actions = (await readActivityByKind(ORG_A, "risk"))
      .filter((e) => e.subjectId === "risk-one")
      .map((e) => e.action);

    expect(actions).toContain("deleted the risk");
    expect(actions).toContain(
      "permanently removed the risk after its retention window",
    );
  });

  it("will not purge another organization's overdue risk", async () => {
    await removedDaysAgo(ORG_B, "risk-theirs", TRASH_RETENTION_DAYS + 5);
    await removedDaysAgo(ORG_A, "risk-one", TRASH_RETENTION_DAYS + 5);

    await purgeExpiredRisks(ORG_A);

    expect(await readDeletedAiRisks(ORG_B)).toHaveLength(1);
  });
});
