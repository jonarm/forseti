import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AISystem } from "@/lib/ams/types";

/**
 * `POST /api/records/system/import`, exercised against a real Postgres.
 *
 * The import was local React state until this route existed, so the first thing
 * worth proving is simply that the rows survive. After that, the failures that
 * only this route can have, all of them silent:
 *
 *   - the apply **re-validates against this organisation's register**, so a row
 *     the preview cleared is still refused if the name has since been taken.
 *     This is also the test that would have caught the older bug, where every
 *     tenant's spreadsheet was checked against the demo fixtures;
 *   - a file naming one tool **twice** imports it once, because the register
 *     check is built from a read taken before the first row was written;
 *   - excluded rows are simply not sent, and rows land only in the caller's
 *     organisation.
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

const caller = { organizationId: "org-aaaa", userId: "user-a", role: "system_owner" };

vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const { organization } = await import("@/db/auth-schema");
const { aiPerson } = await import("@/db/schema");
const { readAiSystems, readActivity, saveAiSystem } = await import("@/lib/ai-store");
const { POST } = await import("@/app/api/records/[kind]/import/route");

const ACTOR = { userId: "seed" };

/** The mapping the dialog ships with, minus the columns it leaves unmapped. */
const MAPPING = {
  Tool: "name",
  Supplier: "vendor",
  "How we got it": "origin",
  "Uses genAI?": "isGenAi",
  Dept: "businessUnit",
  "Requested by": "owner",
  Stage: "lifecycleStage",
};

function row(overrides: Record<string, string> = {}) {
  return {
    Tool: "Otter.ai",
    Supplier: "Otter.ai Inc.",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Sales",
    "Requested by": "M. Hallberg",
    Stage: "pilot",
    ...overrides,
  };
}

function post(body: unknown, kind = "system") {
  return POST(
    new Request(`http://localhost/api/records/${kind}/import`, {
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
    ownerId: "p-devi",
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
  caller.organizationId = ORG_A;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);
  // The people the owner column is matched against, and the source of the
  // business units — both are this organisation's, never a fixture.
  await testDb.insert(aiPerson).values([
    {
      id: "p-hallberg",
      organizationId: ORG_A,
      name: "M. Hallberg",
      role: "Head of Customer Operations",
      businessUnit: "Customer Operations",
    },
  ]);
});

describe("import — the rows persist", () => {
  it("stores every row it accepts and reads them back", async () => {
    const response = await post({
      mapping: MAPPING,
      rows: [row(), row({ Tool: "Grammarly Business", Supplier: "Grammarly" })],
    });
    expect(response.status).toBe(201);

    const { imported, rejected } = await response.json();
    expect(rejected).toEqual([]);
    expect(imported).toHaveLength(2);

    const stored = await readAiSystems(ORG_A);
    expect(stored.map((s) => s.name).sort()).toEqual([
      "Grammarly Business",
      "Otter.ai",
    ]);
  });

  it("lands in no other organization's register", async () => {
    await post({ mapping: MAPPING, rows: [row()] });
    expect(await readAiSystems(ORG_B)).toEqual([]);
  });

  it("applies the coercions the warnings promised", async () => {
    await post({
      mapping: MAPPING,
      rows: [
        row({
          Supplier: "",
          "How we got it": "Built by us",
          Stage: "trial",
          Dept: "Sales",
          "Requested by": "Nobody At All",
        }),
      ],
    });

    const [stored] = await readAiSystems(ORG_A);
    expect(stored.vendor).toBe("Unknown");
    expect(stored.origin).toBe("internal_model");
    expect(stored.lifecycleStage).toBe("poc");
    // Neither the department nor the person exists here, and the warnings said
    // exactly what would happen to each.
    expect(stored.businessUnit).toBe("Unassigned");
    expect(stored.ownerId).toBe("");
  });

  it("matches an owner and a business unit that this organization does have", async () => {
    await post({ mapping: MAPPING, rows: [row({ Dept: "Customer Operations" })] });

    const [stored] = await readAiSystems(ORG_A);
    expect(stored.ownerId).toBe("p-hallberg");
    expect(stored.businessUnit).toBe("Customer Operations");
  });

  it("marks the rows as imported and provisional", async () => {
    await post({ mapping: MAPPING, rows: [row()] });

    const [stored] = await readAiSystems(ORG_A);
    expect(stored.discoveredVia).toBe("import");
    expect(stored.riskTier).toBe("minimal");
    expect(stored.assessmentStatus).toBe("not_started");
  });

  it("records each imported row on its own trail", async () => {
    const { imported } = await (
      await post({ mapping: MAPPING, rows: [row(), row({ Tool: "Perplexity" })] })
    ).json();

    for (const entry of imported) {
      const trail = await readActivity(ORG_A, entry.id);
      expect(trail.some((e) => e.action.includes("registered"))).toBe(true);
    }
  });
});

describe("import — the apply re-validates", () => {
  it("refuses a name this organization already has, whatever the preview said", async () => {
    // The preview was computed before this row existed. The apply is not.
    await saveAiSystem(ORG_A, makeSystem("sys-1", "Otter.ai"), ACTOR);

    const { imported, rejected } = await (
      await post({ mapping: MAPPING, rows: [row()] })
    ).json();

    expect(imported).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].name).toBe("Otter.ai");
    expect(rejected[0].reason).toMatch(/already in the inventory/i);
    expect((await readAiSystems(ORG_A)).length).toBe(1);
  });

  it("does not refuse a name that only another organization has", async () => {
    // The bug this guards: validation used to run against the demo fixtures, so
    // one tenant's register could block another tenant's import.
    await saveAiSystem(ORG_B, makeSystem("sys-1", "Otter.ai"), ACTOR);

    const { imported, rejected } = await (
      await post({ mapping: MAPPING, rows: [row()] })
    ).json();

    expect(rejected).toEqual([]);
    expect(imported).toHaveLength(1);
  });

  it("imports a name listed twice in one file exactly once", async () => {
    const { imported, rejected } = await (
      await post({ mapping: MAPPING, rows: [row(), row()] })
    ).json();

    expect(imported).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/appears earlier in the same file/i);
    expect((await readAiSystems(ORG_A)).length).toBe(1);
  });

  it("refuses a nameless row and keeps the rest", async () => {
    const { imported, rejected } = await (
      await post({
        mapping: MAPPING,
        rows: [row({ Tool: "" }), row({ Tool: "Perplexity Enterprise" })],
      })
    ).json();

    expect(imported.map((r: { name: string }) => r.name)).toEqual([
      "Perplexity Enterprise",
    ]);
    expect(rejected).toHaveLength(1);
  });

  it("imports only the rows it was sent", async () => {
    // Exclusion is the client dropping a row before it posts, so the register
    // must end up with exactly what arrived and nothing else.
    await post({ mapping: MAPPING, rows: [row({ Tool: "Only This One" })] });
    expect((await readAiSystems(ORG_A)).map((s) => s.name)).toEqual(["Only This One"]);
  });

  it("gives two rows two ids, even under one name in two imports", async () => {
    const first = await (await post({ mapping: MAPPING, rows: [row()] })).json();
    // The second is refused as a duplicate, which is the point — but the ids
    // must not have been the deciding factor.
    expect(first.imported[0].id).toMatch(/^sys-otter-ai-[a-z0-9]{6}$/);
  });
});

describe("import — what the body may say", () => {
  it("refuses a mapping naming a field that is not ours", async () => {
    const response = await post({
      mapping: { ...MAPPING, Notes: "assessmentStatus" },
      rows: [row()],
    });
    expect(response.status).toBe(400);
    expect(await readAiSystems(ORG_A)).toEqual([]);
  });

  it("refuses a mapping with no system name column", async () => {
    const response = await post({
      mapping: { Supplier: "vendor" },
      rows: [row()],
    });
    expect(response.status).toBe(400);
    expect(await readAiSystems(ORG_A)).toEqual([]);
  });

  it("refuses an empty or oversized row set", async () => {
    expect((await post({ mapping: MAPPING, rows: [] })).status).toBe(400);
    expect(
      (await post({ mapping: MAPPING, rows: Array.from({ length: 501 }, () => row()) }))
        .status,
    ).toBe(400);
  });

  it("refuses rows that are not flat objects", async () => {
    expect((await post({ mapping: MAPPING, rows: ["Otter.ai"] })).status).toBe(400);
    expect((await post({ mapping: MAPPING, rows: [[1, 2]] })).status).toBe(400);
  });

  it("cleans the cells before they are stored", async () => {
    await post({ mapping: MAPPING, rows: [row({ Tool: "  Otter    .ai  " })] });
    expect((await readAiSystems(ORG_A))[0].name).toBe("Otter .ai");
  });

  it("refuses a body that is not an object", async () => {
    expect((await post("nope")).status).toBe(400);
  });
});
