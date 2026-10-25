import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";

/**
 * `POST /api/systems`, exercised against a real Postgres.
 *
 * `permissions.test.ts` proves the role is right and `route-guards.test.ts`
 * proves the check is reached. What is left is what only this route can get
 * wrong, and each of the three is silent:
 *
 *   - the **row has to actually persist**, which is the whole point — the
 *     register was local state before this route existed, and a system that
 *     survived until the tab was refreshed looked exactly like one that saved;
 *   - the **body is eight fields, not an `AISystem`**, so a caller cannot
 *     register a system already marked approved, or at minimal risk of their own
 *     choosing;
 *   - the **id is minted here**, because `saveAiSystem` upserts and would
 *     therefore quietly overwrite rather than fail on a colliding id.
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
const { readAiSystems, readActivity } = await import("@/lib/ai-store");
const { POST } = await import("@/app/api/systems/route");

/** The eight answers the form collects. Overridden per test. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    name: "Convene Notetaker",
    vendor: "Convene Labs",
    origin: "procured_saas",
    isGenAi: "yes",
    businessUnit: "Marketing",
    ownerId: "p-devi",
    purpose: "Joins external calls to record, transcribe and summarise them.",
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  caller.organizationId = ORG_A;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);
});

describe("POST — the row persists", () => {
  it("stores the system and reads it back on the next request", async () => {
    const response = await post(form());
    expect(response.status).toBe(201);

    const { system } = await response.json();
    expect(system.name).toBe("Convene Notetaker");

    // The assertion the whole change exists for.
    const stored = await readAiSystems(ORG_A);
    expect(stored.map((s) => s.name)).toEqual(["Convene Notetaker"]);
    expect(stored[0].id).toBe(system.id);
  });

  it("lands in no other organization's register", async () => {
    await post(form());
    expect(await readAiSystems(ORG_B)).toEqual([]);
  });

  it("starts unassessed, at minimal risk, proposed and manual", async () => {
    // Nobody has decided yet, and a register that guesses produces a tier
    // nobody owns. The row belongs in the attention list.
    const { system } = await (await post(form())).json();
    expect(system.assessmentStatus).toBe("not_started");
    expect(system.riskTier).toBe("minimal");
    expect(system.lifecycleStage).toBe("proposed");
    expect(system.discoveredVia).toBe("manual");
    expect(system.version).toBe(1);
  });

  it("marks a generative system as such and leaves the rest alone", async () => {
    const gen = await (await post(form())).json();
    expect(gen.system.characteristics).toEqual(["generative"]);

    const plain = await (await post(form({ name: "Route Optimiser", isGenAi: "no" }))).json();
    expect(plain.system.isGenAi).toBe(false);
    expect(plain.system.characteristics).toEqual([]);
  });

  it("records the registration on the trail", async () => {
    const { system } = await (await post(form())).json();
    const trail = await readActivity(ORG_A, system.id);
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.some((e) => e.action.includes("registered"))).toBe(true);
  });
});

describe("POST — what the body may say", () => {
  it("refuses a body carrying fields the form does not ask for", async () => {
    // The hole this closes: registering a system already marked approved.
    const approved = await post(form({ assessmentStatus: "approved" }));
    expect(approved.status).toBe(400);

    const tiered = await post(form({ riskTier: "high" }));
    expect(tiered.status).toBe(400);

    expect(await readAiSystems(ORG_A)).toEqual([]);
  });

  it("refuses an id chosen by the caller", async () => {
    expect((await post(form({ id: "sys-theirs" }))).status).toBe(400);
  });

  it("names the field that was wrong", async () => {
    const response = await post(form({ name: "x", purpose: "too short" }));
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(Object.keys(json.fields).sort()).toEqual(["name", "purpose"]);
    expect(json.fields.name).toMatch(/recognise/);
  });

  it("refuses an origin outside the question sets", async () => {
    expect((await post(form({ origin: "borrowed" }))).status).toBe(400);
  });

  it("refuses a body that is not an object", async () => {
    expect((await post("a string")).status).toBe(400);
  });

  it("cleans what somebody typed before it is stored", async () => {
    const { system } = await (
      await post(form({ name: "  Convene\u0000   Notetaker  " }))
    ).json();
    expect(system.name).toBe("Convene Notetaker");
  });
});

describe("POST — the id", () => {
  it("gives two registrations of one name two rows", async () => {
    // `saveAiSystem` upserts on (organizationId, id) and does not fail on a
    // collision — it updates. A name-derived id would mean the second
    // registration silently replaced the first.
    const first = await (await post(form())).json();
    const second = await (await post(form())).json();

    expect(first.system.id).not.toBe(second.system.id);
    expect((await readAiSystems(ORG_A)).length).toBe(2);
  });

  it("keeps the name legible in the id", async () => {
    const { system } = await (await post(form())).json();
    expect(system.id).toMatch(/^sys-convene-notetaker-[a-z0-9]{6}$/);
  });

  it("still produces an id for a name that slugs to nothing", async () => {
    const { system } = await (await post(form({ name: "上手" }))).json();
    expect(system.id).toMatch(/^sys-system-[a-z0-9]{6}$/);
  });
});
