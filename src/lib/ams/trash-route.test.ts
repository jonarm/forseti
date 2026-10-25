import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AISystem } from "@/lib/ams/types";

/**
 * The trash: restoring from it, and the 30-day purge that empties it.
 *
 * The delete was already soft and already audited. What is new is that the row
 * now has a deadline, and a deadline is the one part of this feature that runs
 * with nobody watching. So the properties worth pinning are the ones whose
 * failure is silent:
 *
 *   - **the purge takes only what is overdue.** A window that is off by a day
 *     in the wrong direction deletes a register somebody was about to restore;
 *   - **it takes the dependents the soft delete hid**, including the risks and
 *     findings that have no foreign key to cascade through — a row left behind
 *     is invisible forever and grows without bound;
 *   - **it never crosses a tenant.** The purge is org-scoped and the cron loops;
 *     the test that matters is that one organisation's overdue trash does not
 *     touch another's;
 *   - **the audit trail outlives the row.** This is the property that makes a
 *     permanent delete defensible in a governance product: after the system is
 *     gone for good, "who removed it, and when" is still answerable;
 *   - **restore brings the whole tree back**, because visibility is derived from
 *     the parent rather than tombstoned downward.
 *
 * The session is mocked; the store, the SQL, the cascades and the append-only
 * trigger are all real.
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

const caller = { organizationId: ORG_A, userId: "user-a", role: "system_owner" };
let permitted = true;

/**
 * Held outside the factory so its arguments can be asserted — the statement the
 * restore route checks is part of what is under test, and a mock that says yes
 * to anything cannot show it was the right one.
 */
const requirePermission = vi.fn(async () =>
  permitted
    ? { ok: true as const, ctx: { ...caller } }
    : {
        ok: false as const,
        response: Response.json({ error: "Refused." }, { status: 403 }),
      },
);

/* Only the session guards are mocked. The cron route reaches for
 * `@/lib/cron-auth` instead, which is the real implementation — the secret
 * check is one of the things under test here. */
vi.mock("@/lib/session", () => ({
  requirePermission: (...args: unknown[]) =>
    (requirePermission as unknown as (...a: unknown[]) => unknown)(...args),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const { organization } = await import("@/db/auth-schema");
const { aiRisk, aiUseCase, aiUseCaseSystem } = await import("@/db/schema");
const {
  deleteAiSystem,
  purgeExpiredSystems,
  readActivityByKind,
  readAiSystems,
  readDeletedAiSystems,
  readWorkspace,
  saveAiSystem,
  TRASH_RETENTION_DAYS,
} = await import("@/lib/ai-store");
const { POST: RESTORE } = await import("@/app/api/records/[kind]/restore/route");
const { GET: PURGE_CRON } = await import("@/app/api/cron/purge-trash/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

function makeSystem(id: string, name: string): AISystem {
  return {
    id,
    name,
    vendor: "Somebody",
    origin: "procured_saas",
    isGenAi: true,
    businessUnit: "Technology",
    ownerId: "",
    lifecycleStage: "production",
    riskTier: "minimal",
    assessmentStatus: "approved",
    purpose: "",
    deploymentModel: "vendor_multi_tenant",
    hostingRegions: [],
    dataResidency: "EU",
    userGroups: [],
    approxUsers: 0,
    dataCategories: [],
    characteristics: [],
    vendorDetail: {
      name: "Somebody",
      subProcessors: [],
      modelProvider: null,
      contractType: "click_through",
      dataProcessingAgreement: false,
      certifications: [],
      trainsOnCustomerData: false,
      renewalDate: null,
    },
    registeredAt: "2026-01-01",
    nextReviewDate: "2026-12-15",
    discoveredVia: null,
  };
}

/** Backdate a tombstone, so "removed 40 days ago" needs no clock mocking. */
async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteAiSystem(organizationId, id, ACTOR);
  const { aiSystem } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiSystem)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(and(eq(aiSystem.organizationId, organizationId), eq(aiSystem.id, id)));
}

function restore(body: unknown, kind = "system") {
  return RESTORE(
    new Request(`http://localhost/api/records/${kind}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind }) },
  );
}

function cron(secret?: string) {
  return PURGE_CRON(
    new Request("http://localhost/api/cron/purge-trash", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
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
  permitted = true;
  delete process.env.CRON_SECRET;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);

  await saveAiSystem(ORG_A, makeSystem("sys-one", "Otter.ai"), ACTOR);
  await saveAiSystem(ORG_A, makeSystem("sys-two", "Grammarly"), ACTOR);
  await saveAiSystem(ORG_B, makeSystem("sys-theirs", "Somebody else's"), ACTOR);
});

describe("the trash view's data", () => {
  it("lists what was removed, with when and by whom", async () => {
    await deleteAiSystem(ORG_A, "sys-two", { userId: "user-a" });

    const trash = await readDeletedAiSystems(ORG_A);
    expect(trash).toHaveLength(1);
    expect(trash[0].name).toBe("Grammarly");
    expect(trash[0].deletedBy).toBe("user-a");
    expect(Date.parse(trash[0].deletedAt)).not.toBeNaN();
  });

  it("is the exact inverse of the register, and never leaks another tenant's", async () => {
    await deleteAiSystem(ORG_A, "sys-two", ACTOR);

    expect((await readAiSystems(ORG_A)).map((s) => s.id)).toEqual(["sys-one"]);
    expect((await readDeletedAiSystems(ORG_A)).map((s) => s.id)).toEqual(["sys-two"]);
    expect(await readDeletedAiSystems(ORG_B)).toEqual([]);
  });
});

describe("restoring", () => {
  it("puts the system back and empties it out of the trash", async () => {
    await deleteAiSystem(ORG_A, "sys-two", ACTOR);

    const response = await restore({ ids: ["sys-two"] });
    expect(response.status).toBe(200);
    expect((await response.json()).restored).toEqual(["sys-two"]);

    expect((await readAiSystems(ORG_A)).map((s) => s.id).sort()).toEqual([
      "sys-one",
      "sys-two",
    ]);
    expect(await readDeletedAiSystems(ORG_A)).toEqual([]);
  });

  it("brings the dependents back with it", async () => {
    await testDb.insert(aiUseCase).values({
      id: "uc-one",
      organizationId: ORG_A,
      name: "Drafting",
      description: "",
      businessUnit: "Technology",
      riskTier: "minimal",
      oversightLevel: "human_in_the_loop",
      oversightSummary: "",
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      dataCategories: [],
      approxUsers: 0,
      status: "live",
    });
    await testDb.insert(aiUseCaseSystem).values({
      organizationId: ORG_A,
      useCaseId: "uc-one",
      systemId: "sys-two",
    });

    await deleteAiSystem(ORG_A, "sys-two", ACTOR);
    expect((await readWorkspace(ORG_A, {})).useCases.map((u) => u.id)).toEqual([]);

    await restore({ ids: ["sys-two"] });

    // Only true because the delete never tombstoned downward — clearing the
    // parent's is the whole restore.
    expect((await readWorkspace(ORG_A, {})).useCases.map((u) => u.id)).toEqual([
      "uc-one",
    ]);
  });

  it("refuses another tenant's id, and a row that was never removed", async () => {
    const { restored, refused } = await (
      await restore({ ids: ["sys-theirs", "sys-one"] })
    ).json();

    expect(restored).toEqual([]);
    expect(refused.map((r: { id: string }) => r.id).sort()).toEqual([
      "sys-one",
      "sys-theirs",
    ]);
    expect((await readAiSystems(ORG_B)).map((s) => s.id)).toEqual(["sys-theirs"]);
  });

  it("checks a permission before restoring anything", async () => {
    await deleteAiSystem(ORG_A, "sys-two", ACTOR);
    permitted = false;

    expect((await restore({ ids: ["sys-two"] })).status).toBe(403);
    expect(await readDeletedAiSystems(ORG_A)).toHaveLength(1);
  });

  it("gates on the platform admin's statement, not on system: create", async () => {
    /*
     * The trash view is restricted to the platform admin, and a route left on
     * `system: ["create"]` would let a governance lead or system owner restore
     * through the API something the screen will not show them. A gate the UI
     * enforces and the route does not is a list of ids away from being nothing.
     *
     * Asserted on the arguments because the mock says yes to anything — without
     * this the statement could be quietly widened and every test here would
     * still pass.
     */
    requirePermission.mockClear();
    await restore({ ids: ["sys-two"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { role: ["update"] },
      expect.any(String),
    );
  });

  it("records the restore in the trail", async () => {
    await deleteAiSystem(ORG_A, "sys-two", ACTOR);
    await restore({ ids: ["sys-two"] });

    const trail = await readActivityByKind(ORG_A, "system");
    const entry = trail.find((e) => e.action === "restored the system");

    expect(entry?.subjectId).toBe("sys-two");
    expect(entry?.after).toBe("Grammarly");
  });
});

describe("the 30-day purge", () => {
  it("leaves a system that still has time on the clock", async () => {
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS - 1);

    expect(await purgeExpiredSystems(ORG_A)).toEqual([]);
    expect(await readDeletedAiSystems(ORG_A)).toHaveLength(1);
  });

  it("takes one whose window has run out", async () => {
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 1);

    expect(await purgeExpiredSystems(ORG_A)).toEqual([
      { id: "sys-two", name: "Grammarly" },
    ]);
    expect(await readDeletedAiSystems(ORG_A)).toEqual([]);
    // Gone for good: re-registering the id is a fresh row, not a revival.
    expect((await readAiSystems(ORG_A)).map((s) => s.id)).toEqual(["sys-one"]);
  });

  it("leaves no row anywhere still naming the system it removed", async () => {
    await testDb.insert(aiUseCase).values({
      id: "uc-doomed",
      organizationId: ORG_A,
      name: "Drafting",
      description: "",
      businessUnit: "Technology",
      riskTier: "minimal",
      oversightLevel: "human_in_the_loop",
      oversightSummary: "",
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      dataCategories: [],
      approxUsers: 0,
      status: "live",
    });
    await testDb.insert(aiUseCaseSystem).values({
      organizationId: ORG_A,
      useCaseId: "uc-doomed",
      systemId: "sys-two",
    });
    await testDb.insert(aiRisk).values({
      id: "risk-doomed",
      organizationId: ORG_A,
      systemId: "sys-two",
      useCaseId: null,
      title: "A risk about it",
      inherentLikelihood: 3,
      inherentImpact: 3,
      residualLikelihood: 2,
      residualImpact: 2,
    });

    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredSystems(ORG_A);

    /* The link cascades at the foreign key, and the use case goes with it
     * because `sys-two` was the only system implementing it — a purpose left
     * with nothing is a purpose nobody can reach. The risk has no foreign key
     * and is removed explicitly. Any one of the three left behind is invisible
     * forever. */
    const links = await testDb.select().from(aiUseCaseSystem);
    const useCases = await testDb.select().from(aiUseCase);
    const risks = await testDb.select().from(aiRisk);
    expect(links.filter((l) => l.systemId === "sys-two")).toEqual([]);
    expect(useCases.filter((u) => u.id === "uc-doomed")).toEqual([]);
    expect(risks.filter((r) => r.systemId === "sys-two")).toEqual([]);
  });

  it("keeps the trail after the row is gone for good", async () => {
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredSystems(ORG_A);

    const trail = await readActivityByKind(ORG_A, "system");
    const actions = trail
      .filter((e) => e.subjectId === "sys-two")
      .map((e) => e.action);

    /* The property that makes a permanent delete defensible here: the record of
     * the decision survives the record it was about. */
    expect(actions).toContain("deleted the system");
    expect(actions).toContain(
      "permanently removed the system after its retention window",
    );
  });

  it("will not reach into another organization's overdue trash", async () => {
    await removedDaysAgo(ORG_B, "sys-theirs", TRASH_RETENTION_DAYS + 5);
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 5);

    await purgeExpiredSystems(ORG_A);

    // A global sweep would have taken both. This is the one operation nothing
    // can undo, so the scoping is asserted rather than assumed.
    expect(await readDeletedAiSystems(ORG_B)).toHaveLength(1);
  });
});

describe("the scheduled job", () => {
  it("refuses to run at all when no secret is configured", async () => {
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 1);

    const response = await cron("anything");
    expect(response.status).toBe(503);
    // Unset must mean "the trash stops emptying", never "anybody can empty it".
    expect(await readDeletedAiSystems(ORG_A)).toHaveLength(1);
  });

  it("refuses a wrong secret", async () => {
    process.env.CRON_SECRET = "the-real-one";
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 1);

    expect((await cron("not-the-real-one")).status).toBe(401);
    expect((await cron(undefined)).status).toBe(401);
    expect(await readDeletedAiSystems(ORG_A)).toHaveLength(1);
  });

  it("purges every organization that has something overdue", async () => {
    process.env.CRON_SECRET = "the-real-one";
    await removedDaysAgo(ORG_A, "sys-two", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_B, "sys-theirs", TRASH_RETENTION_DAYS + 1);

    const response = await cron("the-real-one");
    expect(response.status).toBe(200);

    const summary = await response.json();
    expect(summary.systemsPurged).toBe(2);
    expect(summary.organizationsFailed).toBe(0);
    expect(summary.retentionDays).toBe(TRASH_RETENTION_DAYS);

    expect(await readDeletedAiSystems(ORG_A)).toEqual([]);
    expect(await readDeletedAiSystems(ORG_B)).toEqual([]);
  });

  it("does nothing on a night when nothing is overdue", async () => {
    process.env.CRON_SECRET = "the-real-one";
    await deleteAiSystem(ORG_A, "sys-two", ACTOR);

    const summary = await (await cron("the-real-one")).json();
    expect(summary.organizationsScanned).toBe(0);
    expect(summary.systemsPurged).toBe(0);
    expect(await readDeletedAiSystems(ORG_A)).toHaveLength(1);
  });
});
