import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AISystem } from "@/lib/ams/types";
import { RECORD_KINDS, RECORD_KIND_IDS } from "@/lib/ams/record-kinds";

/**
 * `POST /api/records/system/delete`, exercised against a real Postgres.
 *
 * The store's `deleteAiSystem` was already written and already tested; nothing
 * in the app called it. What this covers is the route around it, and the
 * failures a bulk delete can have that a single one cannot:
 *
 *   - **tenant isolation**, which for a delete is the one that ends a company.
 *     Another organisation's id in the body is refused as "not in your
 *     register" and its row is still there afterwards;
 *   - **a mixed batch lands the rows it can and names the ones it cannot**,
 *     rather than failing whole. There is no transaction — the store audits and
 *     writes per system — so the response has to say what happened to each id
 *     instead of implying an all-or-nothing;
 *   - **the trail is written**, because a governed deletion that leaves no
 *     record of who removed what is the deletion an auditor asks about;
 *   - **the row survives the delete**, soft, so that record has something to
 *     point at.
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

const caller = { organizationId: ORG_A, userId: "user-a", role: "system_owner" };

/** Swapped per test so the refusal path can be exercised without a real session. */
let permitted = true;

vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () =>
    permitted
      ? { ok: true as const, ctx: { ...caller } }
      : {
          ok: false as const,
          response: Response.json({ error: "Refused." }, { status: 403 }),
        },
  ),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const { organization } = await import("@/db/auth-schema");
const { readAiSystems, readActivityByKind, saveAiSystem } = await import(
  "@/lib/ai-store"
);
const { POST } = await import("@/app/api/records/[kind]/delete/route");

const ACTOR = { userId: "seed" };

function post(body: unknown, kind = "system") {
  return POST(
    new Request(`http://localhost/api/records/${kind}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind }) },
  );
}

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
  caller.organizationId = ORG_A;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);

  await saveAiSystem(ORG_A, makeSystem("sys-one", "Otter.ai"), ACTOR);
  await saveAiSystem(ORG_A, makeSystem("sys-two", "Grammarly"), ACTOR);
  await saveAiSystem(ORG_A, makeSystem("sys-three", "Copilot"), ACTOR);
  await saveAiSystem(ORG_B, makeSystem("sys-theirs", "Somebody else's"), ACTOR);
});

describe("removing systems", () => {
  it("removes one and leaves the rest of the register alone", async () => {
    const response = await post({ ids: ["sys-two"] });
    expect(response.status).toBe(200);

    const { deleted, refused } = await response.json();
    expect(refused).toEqual([]);
    // Named rather than counted, because that is what the confirmation showed.
    expect(deleted).toEqual([{ id: "sys-two", name: "Grammarly" }]);

    const left = await readAiSystems(ORG_A);
    expect(left.map((s) => s.id).sort()).toEqual(["sys-one", "sys-three"]);
  });

  it("removes many in one call", async () => {
    const response = await post({ ids: ["sys-one", "sys-three"] });

    const { deleted } = await response.json();
    expect(deleted).toHaveLength(2);
    expect((await readAiSystems(ORG_A)).map((s) => s.id)).toEqual(["sys-two"]);
  });

  it("collapses the same id sent twice instead of reporting it already gone", async () => {
    const { deleted, refused } = await (
      await post({ ids: ["sys-one", "sys-one"] })
    ).json();

    expect(deleted).toHaveLength(1);
    expect(refused).toEqual([]);
  });
});

describe("what a bulk delete must not do", () => {
  it("will not reach another organization's register", async () => {
    const { deleted, refused } = await (
      await post({ ids: ["sys-theirs"] })
    ).json();

    expect(deleted).toEqual([]);
    // "Not in your register" is the whole truth this caller is entitled to —
    // and the row is still there.
    expect(refused).toEqual([
      {
        id: "sys-theirs",
        reason: "No longer in your register — it may already have been removed.",
      },
    ]);
    expect((await readAiSystems(ORG_B)).map((s) => s.id)).toEqual(["sys-theirs"]);
  });

  it("lands the rows it can and names the one it cannot", async () => {
    const { deleted, refused } = await (
      await post({ ids: ["sys-one", "sys-gone", "sys-three"] })
    ).json();

    // The failure a transaction-shaped response would hide: two rows are gone
    // and the caller can see exactly which third one was not.
    expect(deleted.map((d: { id: string }) => d.id).sort()).toEqual([
      "sys-one",
      "sys-three",
    ]);
    expect(refused).toHaveLength(1);
    expect(refused[0].id).toBe("sys-gone");
    expect((await readAiSystems(ORG_A)).map((s) => s.id)).toEqual(["sys-two"]);
  });

  it("refuses a caller without the statement, before anything is removed", async () => {
    permitted = false;

    const response = await post({ ids: ["sys-one"] });
    expect(response.status).toBe(403);
    expect(await readAiSystems(ORG_A)).toHaveLength(3);
  });

  it("refuses a register whose records cannot be removed yet", async () => {
    /* The registry says which kinds offer deletion and the binding says whether
     * the store can actually do it. Both have to agree, and a client claiming
     * otherwise is answered rather than trusted.
     *
     * The kind is taken from the registry rather than named, so that turning a
     * register on does not fail this test — it just moves it to the next one
     * still waiting. When every register is on, only the nonsense case is left,
     * which is still worth asserting. */
    const notYet = RECORD_KIND_IDS.find((k) => !RECORD_KINDS[k].features.delete);
    if (notYet) {
      expect((await post({ ids: ["x-1"] }, notYet)).status).toBe(404);
    }

    expect((await post({ ids: ["x"] }, "not-a-register")).status).toBe(404);
    expect(await readAiSystems(ORG_A)).toHaveLength(3);
  });

  it("rejects a body that is not a list of ids", async () => {
    expect((await post({ ids: [] })).status).toBe(400);
    expect((await post({ ids: "sys-one" })).status).toBe(400);
    expect((await post({ ids: [123] })).status).toBe(400);
    expect((await post({})).status).toBe(400);

    expect(await readAiSystems(ORG_A)).toHaveLength(3);
  });
});

describe("the trail a deletion leaves", () => {
  it("records who removed what, naming the system rather than its id", async () => {
    await post({ ids: ["sys-two"] });

    const trail = await readActivityByKind(ORG_A, "system");
    const entry = trail.find((e) => e.action === "deleted the system");

    expect(entry).toBeDefined();
    expect(entry?.subjectId).toBe("sys-two");
    expect(entry?.actorId).toBe("user-a");
    // The name is the "before" value, because after the delete there is nothing
    // left on screen to look the id up against.
    expect(entry?.before).toBe("Grammarly");
  });

  it("writes one entry per system in a bulk delete", async () => {
    await post({ ids: ["sys-one", "sys-three"] });

    const trail = await readActivityByKind(ORG_A, "system");
    const deletions = trail.filter((e) => e.action === "deleted the system");

    // Two removals are two facts. A single "removed 2 systems" entry could not
    // answer "was Copilot ever in the register?".
    expect(deletions.map((e) => e.subjectId).sort()).toEqual([
      "sys-one",
      "sys-three",
    ]);
  });

  it("keeps the row on disk, so the trail still has something to point at", async () => {
    await post({ ids: ["sys-two"] });

    // Registering the same id again brings it back rather than colliding, which
    // is only true because the delete was soft.
    await saveAiSystem(ORG_A, makeSystem("sys-two", "Grammarly"), ACTOR);
    expect((await readAiSystems(ORG_A)).map((s) => s.id).sort()).toEqual([
      "sys-one",
      "sys-three",
      "sys-two",
    ]);
  });
});
