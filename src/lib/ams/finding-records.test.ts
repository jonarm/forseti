import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { Finding } from "@/lib/ams/types";

/**
 * The findings register on the shared record machinery.
 *
 * The third register through the same routes, and the first whose table had no
 * `deleted_at` column until this change — so alongside the usual tenant and
 * catalogue checks, this is where the migration gets exercised. PGlite applies
 * the real `drizzle/` files, so a column that did not arrive fails here rather
 * than in production.
 *
 * The columns worth their own tests are the two that run a rule rather than
 * read a field: **what is blocking closure**, which must come from the same
 * `canClose` the screen uses, and **overdue**, which must not flag a finding
 * that is already closed.
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
const { aiFinding, aiPerson } = await import("@/db/schema");
const {
  TRASH_RETENTION_DAYS,
  deleteAiFinding,
  purgeExpiredFindings,
  readActivityByKind,
  readAiFindings,
  readDeletedAiFindings,
  saveAiFinding,
} = await import("@/lib/ai-store");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");
const { POST: RESTORE_RECORDS } = await import("@/app/api/records/[kind]/restore/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

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

function call(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost/api/records/finding/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind: "finding" }) },
  );
}

const remove = (body: unknown) => call(DELETE_RECORDS, "delete", body);
const exportFindings = (body: unknown) => call(EXPORT_RECORDS, "export", body);
const restore = (body: unknown) => call(RESTORE_RECORDS, "restore", body);

const cells = (text: string) => text.split("\n").map((line) => line.split(","));

async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteAiFinding(organizationId, id, ACTOR);
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiFinding)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(and(eq(aiFinding.organizationId, organizationId), eq(aiFinding.id, id)));
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
      role: "Internal Audit",
      businessUnit: "Risk",
    },
  ]);

  await saveAiFinding(ORG_A, makeFinding("fnd-one", "Access reviews not evidenced"), ACTOR);
  await saveAiFinding(
    ORG_A,
    makeFinding("fnd-two", "Retention schedule out of date", {
      status: "closed",
      rootCause: "The schedule was never assigned an owner",
      correctiveAction: "Assigned to Records Management",
      verifiedById: "p-quinn",
      verifiedAt: "2026-07-01",
      closedAt: "2026-07-01",
    }),
    ACTOR,
  );
  await saveAiFinding(ORG_B, makeFinding("fnd-theirs", "Somebody else's finding"), ACTOR);
});

describe("removing findings through the generic route", () => {
  it("removes the ones it is given and names them by title", async () => {
    const { deleted, refused } = await (await remove({ ids: ["fnd-one"] })).json();

    expect(refused).toEqual([]);
    expect(deleted).toEqual([
      { id: "fnd-one", name: "Access reviews not evidenced" },
    ]);
    expect((await readAiFindings(ORG_A)).map((f) => f.id)).toEqual(["fnd-two"]);
  });

  it("will not reach another organization's register", async () => {
    const { deleted } = await (await remove({ ids: ["fnd-theirs"] })).json();

    expect(deleted).toEqual([]);
    expect((await readAiFindings(ORG_B)).map((f) => f.id)).toEqual(["fnd-theirs"]);
  });

  it("checks the finding resource", async () => {
    requirePermission.mockClear();
    await remove({ ids: ["fnd-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { finding: ["delete"] },
      expect.any(String),
    );
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    expect((await remove({ ids: ["fnd-one"] })).status).toBe(403);
    expect(await readAiFindings(ORG_A)).toHaveLength(2);
  });
});

describe("exporting findings", () => {
  it("runs the closure rule rather than restating it", async () => {
    const response = await exportFindings({
      format: "csv",
      columns: ["title", "blockingClosure"],
      ids: ["fnd-one", "fnd-two"],
    });

    const rows = cells(await response.text());
    const open = rows.find((r) => r[0].startsWith("Access"));
    const closed = rows.find((r) => r[0].startsWith("Retention"));

    /* The same sentence `canClose` gives the screen. A spreadsheet that
     * computed this differently would be worse than one that omitted it. */
    expect(open?.[1]).toContain("No root cause recorded");
    // A closed finding has nothing blocking it; the blank is the useful answer.
    expect(closed?.[1]).toBe("");
  });

  it("does not call a closed finding overdue, whatever its due date says", async () => {
    const response = await exportFindings({
      format: "csv",
      columns: ["title", "overdue"],
      ids: ["fnd-one", "fnd-two"],
    });

    const rows = cells(await response.text());
    // Both are due 30 June and today is past it. Only the open one is late —
    // flagging the closed one would bury the one somebody has to act on.
    expect(rows.find((r) => r[0].startsWith("Access"))?.[1]).toBe("Yes");
    expect(rows.find((r) => r[0].startsWith("Retention"))?.[1]).toBe("No");
  });

  it("names an unverified finding rather than leaving the cell blank", async () => {
    const response = await exportFindings({
      format: "csv",
      columns: ["title", "verifiedBy"],
      ids: ["fnd-one"],
    });

    expect(cells(await response.text())[1][1]).toBe("Not verified");
  });

  it("records the export against the findings register", async () => {
    await exportFindings({ format: "csv", columns: ["title"], ids: ["fnd-one"] });

    const entry = (await readActivityByKind(ORG_A, "organization")).find(
      (e) => e.action === "exported the Findings",
    );

    expect(entry?.after).toContain("1 finding");
  });
});

describe("the trash, for a table that had no tombstone until now", () => {
  it("lists a removed finding and puts it back", async () => {
    await deleteAiFinding(ORG_A, "fnd-one", { userId: "user-a" });

    const trash = await readDeletedAiFindings(ORG_A);
    expect(trash.map((f) => f.id)).toEqual(["fnd-one"]);
    expect(trash[0].deletedBy).toBe("user-a");

    const { restored } = await (await restore({ ids: ["fnd-one"] })).json();
    expect(restored).toEqual(["fnd-one"]);
    expect((await readAiFindings(ORG_A)).map((f) => f.id).sort()).toEqual([
      "fnd-one",
      "fnd-two",
    ]);
  });

  it("purges only what is overdue, and keeps the trail", async () => {
    await removedDaysAgo(ORG_A, "fnd-one", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_A, "fnd-two", TRASH_RETENTION_DAYS - 1);

    const purged = await purgeExpiredFindings(ORG_A);
    expect(purged.map((f) => f.id)).toEqual(["fnd-one"]);
    expect((await readDeletedAiFindings(ORG_A)).map((f) => f.id)).toEqual(["fnd-two"]);

    const actions = (await readActivityByKind(ORG_A, "finding"))
      .filter((e) => e.subjectId === "fnd-one")
      .map((e) => e.action);

    /* "You raised nine and this register shows seven" has to stay answerable
     * after the row itself is gone. */
    expect(actions).toContain("deleted the finding");
    expect(actions).toContain(
      "permanently removed the finding after its retention window",
    );
  });

  it("will not purge another organization's overdue finding", async () => {
    await removedDaysAgo(ORG_B, "fnd-theirs", TRASH_RETENTION_DAYS + 5);
    await removedDaysAgo(ORG_A, "fnd-one", TRASH_RETENTION_DAYS + 5);

    await purgeExpiredFindings(ORG_A);

    expect(await readDeletedAiFindings(ORG_B)).toHaveLength(1);
  });
});
