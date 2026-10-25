import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AiSuggestion, ControlApplicability, Evidence } from "@/lib/ams/types";

/**
 * Editing one row of the Statement of Applicability.
 *
 * The workbench held every edit in React state until this route existed:
 * applicability, implementation status, owner and linked policy survived until
 * the next refresh and no further. So these tests are about what a screen that
 * can finally write has to be stopped from writing:
 *
 *   - **A patch must not clobber the joins.** `saveApplicability` takes a whole
 *     row and rewrites `ai_applicability_system` by deleting and re-inserting.
 *     The route reads the stored row and applies the patch on top of it; a
 *     version that wrote the client's copy would un-claim every system somebody
 *     else had claimed since the page loaded.
 *
 *   - **Scope is a different permission from the working loop.** Applicability
 *     is `framework: ["update"]`, which a system owner deliberately does not
 *     hold; everything else on the row is `answer: ["update"]`, which they do.
 *     Collapsing the two in either direction breaks a role boundary the whole
 *     management system leans on.
 *
 *   - **An exclusion demands prose**, checked against the row as it would end up
 *     rather than against the patch — otherwise the rule is escapable by sending
 *     the two fields in two requests, and unescapable for somebody changing the
 *     owner of a control that was excluded last year.
 *
 * `requirePermission` is mocked, because the tenant boundary is not what is
 * under test. `can()` is **not** mocked: the second check is the thing being
 * tested, so it runs against the real permission matrix with the caller's real
 * role.
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
const {
  readAiEvidence,
  readApplicability,
  readSuggestions,
  saveAiEvidence,
  saveAiSystem,
  saveApplicability,
  saveSuggestion,
} = await import("@/lib/ai-store");
const { newSystem } = await import("@/lib/ams/system-create");
const { aiFramework } = await import("@/db/schema");
const { POST: edit } = await import("@/app/api/applicability/route");
const { POST: decide } = await import("@/app/api/suggestions/route");

const ACTOR = { userId: "seed" };

const post = (body: unknown) =>
  edit(
    new Request("http://localhost/api/applicability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const patch = (controlId: string, fields: Record<string, unknown>) =>
  post({ frameworkId: FRAMEWORK, controlId, ...fields });

function makeRow(
  controlId: string,
  over: Partial<ControlApplicability> = {},
): ControlApplicability {
  return {
    frameworkId: FRAMEWORK,
    controlId,
    applicability: "yes",
    justification: "Applicable",
    implementationStatus: "not_started",
    ownerId: "p-devi",
    linkedPolicyId: null,
    linkedEvidenceIds: [],
    appliesToSystemIds: [],
    lastReviewedAt: "2026-06-25",
    ...over,
  };
}

/**
 * A real row in `ai_system`, because a claim against one is filtered through
 * this organisation's own inventory on the way in. A fixture that skipped this
 * would seed claims that were never stored, and the test asserting they survive
 * an edit would pass against an empty set either way.
 */
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

function makeEvidence(id: string, over: Partial<Evidence> = {}): Evidence {
  return {
    id,
    title: "AI policy",
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

function makeSuggestion(id: string, controlId: string): AiSuggestion {
  return {
    id,
    target: { kind: "control", id: controlId },
    recommendation: "The organisation develops no models of its own.",
    reasoning: "No system in the register has an in-house origin.",
    supportingData: [],
    confidence: 0.8,
    status: "pending",
    decidedById: null,
    decidedAt: null,
    editedText: null,
  };
}

const rowIn = async (organizationId: string, controlId: string) =>
  (await readApplicability(organizationId, FRAMEWORK)).find(
    (row) => row.controlId === controlId,
  );

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
  caller.role = "governance_lead";

  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);

  /* `/api/suggestions` reads the whole workspace, and `readWorkspace` only
   * loads an applicability set once a framework resolves. Without this row its
   * control branch would find nothing and the guard under test would be skipped
   * rather than exercised. */
  await testDb.insert(aiFramework).values({
    id: FRAMEWORK,
    organizationId: ORG_A,
    name: "ISO/IEC 42001",
    shortName: "ISO 42001",
  });

  await saveAiSystem(ORG_A, makeSystem("sys-otter", "Otter.ai"), ACTOR);
  await saveAiSystem(ORG_A, makeSystem("sys-deepl", "DeepL"), ACTOR);

  await saveApplicability(ORG_A, makeRow("ctl-5-2"), ACTOR);
  await saveApplicability(
    ORG_A,
    makeRow("ctl-6-1", { appliesToSystemIds: ["sys-otter", "sys-deepl"] }),
    ACTOR,
  );
  await saveApplicability(
    ORG_A,
    makeRow("ctl-9-9", {
      applicability: "na",
      justification: "We do not develop models in house, so the development controls do not apply.",
      implementationStatus: "not_applicable",
    }),
    ACTOR,
  );
  await saveApplicability(ORG_B, makeRow("ctl-5-2"), ACTOR);

  await saveAiEvidence(
    ORG_A,
    makeEvidence("ev-policy", { linkedControlIds: ["ctl-6-1"] }),
    ACTOR,
  );
});

describe("editing a row", () => {
  it("saves the working-loop fields", async () => {
    const response = await patch("ctl-5-2", {
      implementationStatus: "implemented",
      ownerId: "p-marc",
      linkedPolicyId: "pol-ai-use",
      justification: "Covered by the acceptable use policy and the quarterly review.",
    });
    expect(response.status).toBe(200);

    const row = await rowIn(ORG_A, "ctl-5-2");
    expect(row?.implementationStatus).toBe("implemented");
    expect(row?.ownerId).toBe("p-marc");
    expect(row?.linkedPolicyId).toBe("pol-ai-use");
    expect(row?.justification).toMatch(/acceptable use policy/);
  });

  it("leaves the fields it was not sent alone", async () => {
    await patch("ctl-5-2", { implementationStatus: "in_progress" });

    const row = await rowIn(ORG_A, "ctl-5-2");
    expect(row?.justification).toBe("Applicable");
    expect(row?.ownerId).toBe("p-devi");
    expect(row?.applicability).toBe("yes");
  });

  it("keeps the systems the control is claimed against", async () => {
    /* The clobber this route exists to avoid: `saveApplicability` rewrites the
     * whole claim set from the row it is handed, so a patch applied to anything
     * other than the freshly read row silently un-claims every system. */
    const response = await patch("ctl-6-1", { implementationStatus: "implemented" });
    expect(response.status).toBe(200);

    expect((await rowIn(ORG_A, "ctl-6-1"))?.appliesToSystemIds.sort()).toEqual([
      "sys-deepl",
      "sys-otter",
    ]);
  });

  it("keeps the evidence cited on the control", async () => {
    await patch("ctl-6-1", { ownerId: "p-marc" });

    expect((await rowIn(ORG_A, "ctl-6-1"))?.linkedEvidenceIds).toEqual(["ev-policy"]);
    expect((await readAiEvidence(ORG_A))[0].linkedControlIds).toEqual(["ctl-6-1"]);
  });

  it("stores an unassigned owner as nothing, not as an empty name", async () => {
    await patch("ctl-5-2", { ownerId: "" });
    expect((await rowIn(ORG_A, "ctl-5-2"))?.ownerId).toBeNull();
  });

  it("rejects a field the schema does not know rather than dropping it", async () => {
    /* A key the server does not recognise is a client and a server that disagree
     * about the record. Dropping it silently means the person who sent it
     * believes it was saved. */
    const response = await patch("ctl-5-2", { lastReviewedAt: "2026-08-22" });
    expect(response.status).toBe(400);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.lastReviewedAt).toBe("2026-06-25");
  });

  it("refuses a change that names no fields", async () => {
    expect((await patch("ctl-5-2", {})).status).toBe(400);
  });

  it("cannot reach a control this organisation does not have", async () => {
    expect((await patch("ctl-nothing", { ownerId: "p-marc" })).status).toBe(404);
  });

  it("cannot reach another organisation's row", async () => {
    /* Both organisations have a `ctl-5-2`. The read is what makes the wrong one
     * a 404 rather than an upsert that creates a row here carrying their id. */
    await patch("ctl-5-2", { implementationStatus: "implemented" });
    expect((await rowIn(ORG_B, "ctl-5-2"))?.implementationStatus).toBe("not_started");
  });

  it("is refused without the working-loop statement", async () => {
    permitted = false;
    const response = await patch("ctl-5-2", { implementationStatus: "implemented" });
    expect(response.status).toBe(403);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.implementationStatus).toBe("not_started");
  });
});

describe("who may change what a control is in scope for", () => {
  it("lets a governance lead take a control out of scope, with a reason", async () => {
    const response = await patch("ctl-5-2", {
      applicability: "no",
      implementationStatus: "not_applicable",
      justification: "The organisation runs no biometric identification of any kind.",
    });
    expect(response.status).toBe(200);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.applicability).toBe("no");
  });

  it("refuses a system owner the scope decision", async () => {
    caller.role = "system_owner";

    const response = await patch("ctl-5-2", {
      applicability: "no",
      justification: "The organisation runs no biometric identification of any kind.",
    });
    expect(response.status).toBe(403);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.applicability).toBe("yes");
  });

  it("still lets that system owner evidence the control", async () => {
    /* The line between the two roles, and the reason this route checks two
     * statements rather than one: a system owner evidences the framework and
     * cannot change what it says. Gating the whole route on the scope statement
     * would also have stopped them typing a justification they can already
     * accept from an AI draft through `/api/suggestions`. */
    caller.role = "system_owner";

    const response = await patch("ctl-5-2", {
      implementationStatus: "implemented",
      justification: "Covered by the acceptable use policy and the quarterly review.",
    });
    expect(response.status).toBe(200);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.implementationStatus).toBe("implemented");
  });
});

describe("an exclusion demands prose", () => {
  it("refuses an exclusion carrying nothing", async () => {
    const response = await patch("ctl-5-2", { applicability: "na", justification: "n/a" });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { fields?: Record<string, string> };
    expect(body.fields?.justification).toBeDefined();
    expect((await rowIn(ORG_A, "ctl-5-2"))?.applicability).toBe("yes");
  });

  it("refuses it even when the two fields arrive separately", async () => {
    /* Checked against the merged row, so sending the applicability on its own
     * is refused by what the row *would* say rather than by what the patch
     * happens to mention. */
    const response = await patch("ctl-5-2", { applicability: "na" });
    expect(response.status).toBe(400);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.applicability).toBe("yes");
  });

  it("allows an ordinary edit to a control that is already excluded", async () => {
    /* The mirror failure: a rule read off the patch would refuse somebody
     * changing the owner of a control excluded last year, because this request
     * carries no justification of its own. */
    const response = await patch("ctl-9-9", { ownerId: "p-marc" });
    expect(response.status).toBe(200);
    expect((await rowIn(ORG_A, "ctl-9-9"))?.ownerId).toBe("p-marc");
  });

  it("refuses emptying the justification of an excluded control", async () => {
    const response = await patch("ctl-9-9", { justification: "" });
    expect(response.status).toBe(400);
    expect((await rowIn(ORG_A, "ctl-9-9"))?.justification).toMatch(/do not develop/);
  });

  it("lets an applicable control carry no justification at all", async () => {
    const response = await patch("ctl-5-2", { justification: "" });
    expect(response.status).toBe(200);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.justification).toBe("");
  });
});

describe("the floor holds on the other route that writes this field", () => {
  /**
   * `/api/suggestions` writes `justification` into the applicability row as part
   * of recording an acceptance, under the same statement this route checks — and
   * the card hands the person a free textarea. A rule only this route enforced
   * would be one anybody could step over by drafting first and replacing the
   * draft with "n/a".
   */
  const accept = (suggestionId: string, text: string) =>
    decide(
      new Request("http://localhost/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId, status: "edited", text }),
      }),
    );

  beforeEach(async () => {
    await saveSuggestion(ORG_A, makeSuggestion("sug-1", "ctl-9-9"), ACTOR);
  });

  it("refuses an accepted draft that would leave an excluded control unexplained", async () => {
    const response = await accept("sug-1", "n/a");
    expect(response.status).toBe(400);

    expect((await rowIn(ORG_A, "ctl-9-9"))?.justification).toMatch(/do not develop/);
    // Both halves or neither: the decision is not recorded either.
    expect((await readSuggestions(ORG_A))[0].status).toBe("pending");
  });

  it("accepts one that carries a reason", async () => {
    const response = await accept(
      "sug-1",
      "No model is developed in house, so the development controls cannot apply.",
    );
    expect(response.status).toBe(200);

    expect((await rowIn(ORG_A, "ctl-9-9"))?.justification).toMatch(/developed in house/);
    expect((await readSuggestions(ORG_A))[0].status).toBe("edited");
  });

  it("leaves an applicable control's justification unpoliced", async () => {
    await saveSuggestion(ORG_A, makeSuggestion("sug-2", "ctl-5-2"), ACTOR);

    const response = await accept("sug-2", "Short.");
    expect(response.status).toBe(200);
    expect((await rowIn(ORG_A, "ctl-5-2"))?.justification).toBe("Short.");
  });
});
