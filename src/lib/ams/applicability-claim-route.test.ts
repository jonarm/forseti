import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { ControlApplicability } from "@/lib/ams/types";

/**
 * Claiming controls against a system.
 *
 * The first write in the product that touches `ai_applicability_system`, which
 * is the join every coverage figure is computed from — so the tests are about
 * the two ways that number could be made to lie:
 *
 *   - **A claim must not replace what is already there.** `saveApplicability`
 *     rewrites `appliesToSystemIds` by deleting and re-inserting, and there is
 *     an existing test asserting exactly that ("replaces system claims rather
 *     than merging them"). The route is what makes claiming additive, and a
 *     refactor that pushed the union down into the store would quietly turn
 *     every claim into a replacement of every other system's.
 *
 *   - **A control the SoA excludes cannot be claimed.** `applicability: "no"`
 *     or `"na"` says this organisation does not have to satisfy the control at
 *     all. Claiming one would put a row into the coverage denominator the SoA
 *     says is empty, and the framework screen and the profile would then report
 *     different totals for the same framework.
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
const FRAMEWORK = "iso-42001";

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
const { readApplicability, saveApplicability, saveAiSystem } = await import(
  "@/lib/ai-store"
);
const { newSystem } = await import("@/lib/ams/system-create");
const { POST: claim } = await import("@/app/api/applicability/claim/route");

const ACTOR = { userId: "seed" };

const post = (body: unknown) =>
  claim(
    new Request("http://localhost/api/applicability/claim", {
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

function makeRow(
  controlId: string,
  over: Partial<ControlApplicability> = {},
): ControlApplicability {
  return {
    frameworkId: FRAMEWORK,
    controlId,
    applicability: "yes",
    justification: "Applicable",
    implementationStatus: "implemented",
    ownerId: "p-devi",
    linkedPolicyId: null,
    linkedEvidenceIds: [],
    appliesToSystemIds: [],
    lastReviewedAt: "2026-06-25",
    ...over,
  };
}

const claimsFor = async (organizationId: string, controlId: string) =>
  (await readApplicability(organizationId, FRAMEWORK)).find(
    (row) => row.controlId === controlId,
  )?.appliesToSystemIds ?? [];

const control = (controlId: string) => ({ frameworkId: FRAMEWORK, controlId });

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

  await saveAiSystem(ORG_A, makeSystem("sys-otter", "Otter.ai"), ACTOR);
  await saveAiSystem(ORG_A, makeSystem("sys-deepl", "DeepL"), ACTOR);
  await saveAiSystem(ORG_B, makeSystem("sys-theirs", "Their tool"), ACTOR);

  await saveApplicability(ORG_A, makeRow("ctl-5-2"), ACTOR);
  await saveApplicability(
    ORG_A,
    makeRow("ctl-6-1", { appliesToSystemIds: ["sys-deepl"] }),
    ACTOR,
  );
  await saveApplicability(
    ORG_A,
    makeRow("ctl-9-9", { applicability: "na", justification: "We build nothing." }),
    ACTOR,
  );
});

describe("claiming a control against a system", () => {
  it("claims it", async () => {
    const response = await post({
      systemId: "sys-otter",
      controls: [control("ctl-5-2")],
    });
    expect(response.status).toBe(200);
    expect(await claimsFor(ORG_A, "ctl-5-2")).toEqual(["sys-otter"]);
  });

  it("adds to the systems already claimed rather than replacing them", async () => {
    /* `saveApplicability` rewrites the whole set, so the union has to happen in
     * the route. Without it, claiming a control for one system would silently
     * un-claim it for every other. */
    const response = await post({
      systemId: "sys-otter",
      controls: [control("ctl-6-1")],
    });
    expect(response.status).toBe(200);
    expect((await claimsFor(ORG_A, "ctl-6-1")).sort()).toEqual(["sys-deepl", "sys-otter"]);
  });

  it("refuses a control the Statement of Applicability puts out of scope", async () => {
    const response = await post({
      systemId: "sys-otter",
      controls: [control("ctl-9-9")],
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      claimed: unknown[];
      refused: { controlId: string; reason: string }[];
    };
    expect(body.claimed).toHaveLength(0);
    expect(body.refused[0].reason).toMatch(/out of scope/i);
    expect(await claimsFor(ORG_A, "ctl-9-9")).toEqual([]);
  });

  it("claims the good controls and reports the refused ones", async () => {
    const response = await post({
      systemId: "sys-otter",
      controls: [control("ctl-5-2"), control("ctl-9-9"), control("ctl-nothing")],
    });

    const body = (await response.json()) as {
      claimed: { controlId: string }[];
      refused: { controlId: string }[];
    };
    // One control's refusal is not the batch's.
    expect(body.claimed.map((r) => r.controlId)).toEqual(["ctl-5-2"]);
    expect(body.refused.map((r) => r.controlId).sort()).toEqual([
      "ctl-9-9",
      "ctl-nothing",
    ]);
  });

  it("reports a control already claimed rather than writing again", async () => {
    const response = await post({
      systemId: "sys-deepl",
      controls: [control("ctl-6-1")],
    });
    const body = (await response.json()) as { refused: { reason: string }[] };
    expect(body.refused[0].reason).toMatch(/already claimed/i);
    expect(await claimsFor(ORG_A, "ctl-6-1")).toEqual(["sys-deepl"]);
  });

  it("refuses a system from another organisation", async () => {
    const response = await post({
      systemId: "sys-theirs",
      controls: [control("ctl-5-2")],
    });
    expect(response.status).toBe(400);
    expect(await claimsFor(ORG_A, "ctl-5-2")).toEqual([]);
  });

  it("does not reach another organisation's Statement of Applicability", async () => {
    await saveApplicability(ORG_B, makeRow("ctl-5-2"), ACTOR);

    await post({ systemId: "sys-otter", controls: [control("ctl-5-2")] });

    expect(await claimsFor(ORG_A, "ctl-5-2")).toEqual(["sys-otter"]);
    expect(await claimsFor(ORG_B, "ctl-5-2")).toEqual([]);
  });

  it("refuses a caller without the statement, before reading the body", async () => {
    permitted = false;
    const response = await post({
      systemId: "sys-otter",
      controls: [control("ctl-5-2")],
    });
    expect(response.status).toBe(403);
    expect(await claimsFor(ORG_A, "ctl-5-2")).toEqual([]);
  });

  it("refuses a body whose controls do not name their framework", async () => {
    /* Applicability is keyed by framework and control together, so a bare
     * control id does not name a row. */
    const response = await post({
      systemId: "sys-otter",
      controls: [{ controlId: "ctl-5-2" }],
    });
    expect(response.status).toBe(400);
    expect(await claimsFor(ORG_A, "ctl-5-2")).toEqual([]);
  });
});
