import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AISystem } from "@/lib/ams/types";

/**
 * `PATCH /api/systems/:id`, exercised against a real Postgres.
 *
 * The matrix in `permissions.test.ts` proves the role is right and
 * `route-guards.test.ts` proves the check is reached. What is left is what only
 * this route can get wrong, and both failures are silent:
 *
 *   - the **tenant re-read**, which turns a cross-tenant patch into a 404
 *     rather than an upsert that quietly mints another organisation's id here;
 *   - the **merge**, which stops a one-field patch blanking the other twenty-two
 *     columns, because `saveAiSystem` writes every column it is given.
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

/** Who the route thinks is calling. Swapped per test. */
const caller = { organizationId: "org-aaaa", userId: "user-a", role: "system_owner" };

vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const { organization } = await import("@/db/auth-schema");
const { readAiSystem, saveAiSystem } = await import("@/lib/ai-store");
const { PATCH } = await import("@/app/api/systems/[systemId]/route");

const ACTOR = { userId: "seed" };

function makeSystem(id: string, name: string): AISystem {
  return {
    id,
    name,
    vendor: `${name} Vendor`,
    origin: "procured_saas",
    isGenAi: true,
    businessUnit: "Technology",
    ownerId: "p-devi",
    lifecycleStage: "production",
    riskTier: "minimal",
    assessmentStatus: "approved",
    purpose: `${name} purpose`,
    deploymentModel: "vendor_multi_tenant",
    hostingRegions: ["EU West"],
    dataResidency: "EU",
    userGroups: ["All staff"],
    approxUsers: 10,
    dataCategories: ["internal"],
    characteristics: ["generative"],
    vendorDetail: {
      name: `${name} Vendor`,
      subProcessors: ["AWS"],
      modelProvider: "OpenAI",
      contractType: "click_through",
      dataProcessingAgreement: true,
      certifications: ["ISO 27001"],
      trainsOnCustomerData: false,
      renewalDate: "2027-01-01",
    },
    registeredAt: "2026-01-01",
    nextReviewDate: "2026-12-15",
    discoveredVia: null,
  };
}

/** Call the handler the way Next would. */
function patch(systemId: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/systems/${systemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ systemId }) },
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
  caller.organizationId = ORG_A;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);
});

describe("PATCH — the tenant boundary", () => {
  it("refuses to patch a system belonging to another organization", async () => {
    await saveAiSystem(ORG_B, makeSystem("sys-1", "Theirs"), ACTOR);

    const response = await patch("sys-1", { name: "Mine now" });

    expect(response.status).toBe(404);
    // The point of the re-read: theirs is untouched, and no row was minted here.
    expect((await readAiSystem(ORG_B, "sys-1"))?.name).toBe("Theirs");
    expect(await readAiSystem(ORG_A, "sys-1")).toBeNull();
  });

  it("404s an id that exists nowhere", async () => {
    expect((await patch("sys-nope", { name: "Ghost" })).status).toBe(404);
  });
});

describe("PATCH — the merge", () => {
  beforeEach(async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Original"), ACTOR);
  });

  it("leaves every column the patch did not mention alone", async () => {
    const response = await patch("sys-1", { riskTier: "high" });
    expect(response.status).toBe(200);

    const after = await readAiSystem(ORG_A, "sys-1");
    expect(after?.riskTier).toBe("high");
    expect(after?.name).toBe("Original");
    expect(after?.purpose).toBe("Original purpose");
    expect(after?.hostingRegions).toEqual(["EU West"]);
    expect(after?.vendorDetail.subProcessors).toEqual(["AWS"]);
  });

  it("replaces a nested vendor object wholesale, keeping its other keys", async () => {
    const before = await readAiSystem(ORG_A, "sys-1");
    const response = await patch("sys-1", {
      vendorDetail: { ...before!.vendorDetail, contractType: "enterprise_agreement" },
    });
    expect(response.status).toBe(200);

    const after = await readAiSystem(ORG_A, "sys-1");
    expect(after?.vendorDetail.contractType).toBe("enterprise_agreement");
    expect(after?.vendorDetail.subProcessors).toEqual(["AWS"]);
  });

  it("writes an array field, and can empty one", async () => {
    await patch("sys-1", { hostingRegions: ["US East", "EU West"] });
    expect((await readAiSystem(ORG_A, "sys-1"))?.hostingRegions).toEqual(["US East", "EU West"]);

    await patch("sys-1", { hostingRegions: [] });
    expect((await readAiSystem(ORG_A, "sys-1"))?.hostingRegions).toEqual([]);
  });

  it("can return an owner to unassigned", async () => {
    await patch("sys-1", { ownerId: "" });
    expect((await readAiSystem(ORG_A, "sys-1"))?.ownerId).toBe("");
  });

  it("changes origin, which selects the assessment question set", async () => {
    const response = await patch("sys-1", { origin: "api_integration" });
    expect(response.status).toBe(200);
    expect((await readAiSystem(ORG_A, "sys-1"))?.origin).toBe("api_integration");
  });
});

describe("PATCH — what it refuses", () => {
  beforeEach(async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Original"), ACTOR);
  });

  it("rejects an unknown key rather than dropping it", async () => {
    const response = await patch("sys-1", { name: "Fine", isoCoverage: 80 });
    expect(response.status).toBe(400);
    expect((await readAiSystem(ORG_A, "sys-1"))?.name).toBe("Original");
  });

  it("refuses to set assessment status, which the sign-off chain owns", async () => {
    expect((await patch("sys-1", { assessmentStatus: "approved" })).status).toBe(400);
  });

  it("refuses a risk tier outside our vocabulary", async () => {
    expect((await patch("sys-1", { riskTier: "spicy" })).status).toBe(400);
  });

  it("refuses an origin outside our vocabulary", async () => {
    // Origin selects the assessment question set and the renderer resolves it
    // live — an unrecognised one would render no sections at all.
    expect((await patch("sys-1", { origin: "borrowed" })).status).toBe(400);
  });

  it("names the field that failed, so the editor can say what to retype", async () => {
    const response = await patch("sys-1", { name: "x" });
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toHaveProperty("name");
  });
});

describe("PATCH — concurrency", () => {
  beforeEach(async () => {
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Original"), ACTOR);
  });

  it("refuses a save that would overwrite somebody else's edit", async () => {
    const stale = (await readAiSystem(ORG_A, "sys-1"))!.version;

    // Somebody else saves first, moving the version on.
    await patch("sys-1", { name: "Theirs" });

    const response = await patch("sys-1", { name: "Mine", expectedVersion: stale });
    expect(response.status).toBe(409);
    expect((await readAiSystem(ORG_A, "sys-1"))?.name).toBe("Theirs");
  });

  it("accepts a patch that carries no version at all", async () => {
    // The profile commits one field at a time on blur; two people editing
    // different fields is ordinary, and refusing that would be wrong far more
    // often than it would be right.
    expect((await patch("sys-1", { name: "Fine" })).status).toBe(200);
  });
});
