import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { Evidence } from "@/lib/ams/types";

/**
 * The evidence register on the shared record machinery.
 *
 * The third register through the generic routes, and the one whose deletion has
 * a consequence the other two do not: **coverage is computed from what evidence
 * a control carries**, so removing a document lowers a figure the organisation
 * has already reported. That is the property most worth pinning here — that the
 * figure moves when a document goes, moves back when it returns, and that the
 * document is still nameable in the trail either way.
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
const { aiEvidence, aiPerson } = await import("@/db/schema");
const {
  TRASH_RETENTION_DAYS,
  deleteAiEvidence,
  purgeExpiredEvidence,
  readActivityByKind,
  readAiEvidence,
  readAiEvidenceItem,
  readDeletedAiEvidence,
  restoreAiEvidence,
  saveAiEvidence,
} = await import("@/lib/ai-store");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

function makeEvidence(
  id: string,
  title: string,
  over: Partial<Evidence> = {},
): Evidence {
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

function call(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost/api/records/evidence/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind: "evidence" }) },
  );
}

const remove = (body: unknown) => call(DELETE_RECORDS, "delete", body);
const exportDocs = (body: unknown) => call(EXPORT_RECORDS, "export", body);
const cells = (text: string) => text.split("\n").map((line) => line.split(","));

async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteAiEvidence(organizationId, id, ACTOR);
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiEvidence)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(and(eq(aiEvidence.organizationId, organizationId), eq(aiEvidence.id, id)));
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

  await saveAiEvidence(
    ORG_A,
    makeEvidence("ev-one", "Access review Q1", {
      linkedControlIds: ["ctl-a6-1", "ctl-a6-2"],
      expiresAt: "2026-01-01",
      file: { name: "access-q1.pdf", kind: "pdf", mime: "application/pdf", sizeKb: 240, href: "/x" },
    }),
    ACTOR,
  );
  await saveAiEvidence(
    ORG_A,
    makeEvidence("ev-two", "AI policy", { linkedControlIds: ["ctl-a2-1"] }),
    ACTOR,
  );
  await saveAiEvidence(ORG_B, makeEvidence("ev-theirs", "Somebody else's"), ACTOR);
});

describe("removing evidence through the generic route", () => {
  it("removes the ones it is given and names them", async () => {
    const { deleted, refused } = await (await remove({ ids: ["ev-one"] })).json();

    expect(refused).toEqual([]);
    expect(deleted).toEqual([{ id: "ev-one", name: "Access review Q1" }]);
    expect((await readAiEvidence(ORG_A)).map((e) => e.id)).toEqual(["ev-two"]);
    // The single read goes through the list read, so one filter covers both.
    expect(await readAiEvidenceItem(ORG_A, "ev-one")).toBeNull();
  });

  it("will not reach another organization's register", async () => {
    const { deleted } = await (await remove({ ids: ["ev-theirs"] })).json();

    expect(deleted).toEqual([]);
    expect((await readAiEvidence(ORG_B)).map((e) => e.id)).toEqual(["ev-theirs"]);
  });

  it("checks the evidence resource", async () => {
    requirePermission.mockClear();
    await remove({ ids: ["ev-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { evidence: ["delete"] },
      expect.any(String),
    );
  });
});

describe("what a removed document takes with it", () => {
  it("takes its claims on controls out of view, and brings them back whole", async () => {
    /* The consequence that makes this register's delete different from the
     * others': a control's coverage rests on these links. */
    await deleteAiEvidence(ORG_A, "ev-one", ACTOR);
    expect(await readAiEvidence(ORG_A)).toHaveLength(1);

    await restoreAiEvidence(ORG_A, "ev-one", ACTOR);

    const back = (await readAiEvidence(ORG_A)).find((e) => e.id === "ev-one");
    /* The links were never touched, only hidden — so the document comes back
     * backing exactly what it backed before, and coverage returns to what it
     * was rather than to something plausible. */
    expect(back?.linkedControlIds.sort()).toEqual(["ctl-a6-1", "ctl-a6-2"]);
    expect(back?.file?.name).toBe("access-q1.pdf");
  });

  it("keeps the trail after the row is gone for good", async () => {
    await removedDaysAgo(ORG_A, "ev-one", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredEvidence(ORG_A);

    const actions = (await readActivityByKind(ORG_A, "evidence"))
      .filter((e) => e.subjectId === "ev-one")
      .map((e) => e.action);

    /* After the purge the only record that this document ever backed a control
     * is the trail — which is why that table has no foreign key into any of it,
     * and why "why did coverage drop in April" stays answerable. */
    expect(actions).toContain("deleted the evidence");
    expect(actions).toContain(
      "permanently removed the evidence after its retention window",
    );
  });

  it("purges only what is overdue, and not across tenants", async () => {
    await removedDaysAgo(ORG_A, "ev-one", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_A, "ev-two", TRASH_RETENTION_DAYS - 1);
    await removedDaysAgo(ORG_B, "ev-theirs", TRASH_RETENTION_DAYS + 5);

    const purged = await purgeExpiredEvidence(ORG_A);

    expect(purged.map((e) => e.id)).toEqual(["ev-one"]);
    expect((await readDeletedAiEvidence(ORG_A)).map((e) => e.id)).toEqual(["ev-two"]);
    expect(await readDeletedAiEvidence(ORG_B)).toHaveLength(1);
  });
});

describe("exporting evidence", () => {
  it("states expiry rather than leaving it to arithmetic", async () => {
    const response = await exportDocs({
      format: "csv",
      columns: ["title", "expiresAt", "expired"],
      ids: ["ev-one", "ev-two"],
    });

    const rows = cells(await response.text());
    const lapsed = rows.find((r) => r[0].startsWith("Access"));
    const policy = rows.find((r) => r[0].startsWith("AI policy"));

    expect(lapsed?.[2]).toBe("Yes");
    /* "Does not expire" rather than blank: a policy with no expiry is a
     * deliberate fact about the document, not a field somebody forgot. */
    expect(policy?.[1]).toBe("Does not expire");
    expect(policy?.[2]).toBe("No");
  });

  it("counts what each document actually backs", async () => {
    const response = await exportDocs({
      format: "csv",
      columns: ["title", "controlCount", "controls"],
      ids: ["ev-one"],
    });

    const [, row] = cells(await response.text());
    expect(row[1]).toBe("2");
    /* By reference, because the point of the column is joining back to the
     * control library. Unquoted, and deliberately so: the list separator is a
     * semicolon precisely because a comma would force every multi-value cell
     * through the quoting path for no reader's benefit. */
    expect(row[2]).toBe("ctl-a6-1; ctl-a6-2");
  });

  it("says an unscoped document applies to all systems, not to none", async () => {
    const response = await exportDocs({
      format: "csv",
      columns: ["title", "systems"],
      ids: ["ev-two"],
    });

    expect(cells(await response.text())[1][1]).toBe("All systems");
  });

  it("names the missing attachment, because that is the finding", async () => {
    const response = await exportDocs({
      format: "csv",
      columns: ["title", "filename"],
      ids: ["ev-two"],
    });

    // A register row claiming proof exists with nothing behind it is exactly
    // what an auditor samples for.
    expect(cells(await response.text())[1][1]).toBe("Nothing attached");
  });

  it("records the export against the evidence register", async () => {
    await exportDocs({ format: "csv", columns: ["title"], ids: ["ev-one"] });

    const entry = (await readActivityByKind(ORG_A, "organization")).find(
      (e) => e.action === "exported the Evidence register",
    );

    expect(entry?.after).toContain("1 document");
  });
});
