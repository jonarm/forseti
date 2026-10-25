import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { IntakeRequest } from "@/lib/ams/types";

/**
 * `POST /api/intake/:id/notes`, exercised against a real Postgres.
 *
 * The route exists because the decision columns hold exactly one decision, and
 * "let me edit the comments" is nearly always somebody wanting to add to the
 * record rather than revise it. So what is worth proving is mostly what this
 * route *cannot* do:
 *
 *   - there is no PATCH and no DELETE, and the store's insert is what makes
 *     that true rather than the absence of a handler somebody could add;
 *   - a note aimed at another tenant's request is a 404, not a constraint
 *     violation and not a row;
 *   - a settled decision is untouched by adding one, which is the whole point.
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

const caller = { organizationId: "org-aaaa", userId: "user-a", personId: "p-anders" };

vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const { organization } = await import("@/db/auth-schema");
const { readActivity, readIntakeNotes, readIntakeRequest, saveIntakeRequest } =
  await import("@/lib/ai-store");
const { POST } = await import("@/app/api/intake/[requestId]/notes/route");

const ACTOR = { userId: "seed" };

/** A decided request — the state a note is actually for. */
function makeRequest(id: string): IntakeRequest {
  return {
    id,
    reference: `REQ-2026-${id}`,
    submission: {
      name: "Meeting notetaker",
      description: "Transcribes internal meetings.",
      businessUnit: "Technology",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Notetaker Co",
      dataCategories: ["internal"],
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      originAnswers: {},
    },
    submittedById: "p-devi",
    submittedAt: "2026-01-05",
    status: "noted",
    reviewerId: "p-anders",
    reviewType: "noting",
    overrideJustification: null,
    decision: "note",
    decidedById: "p-anders",
    decidedAt: "2026-01-08",
    comments: "Recorded without a forum decision.",
    createdSystemId: null,
  };
}

function addNote(requestId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/intake/${requestId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }),
    { params: Promise.resolve({ requestId }) },
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
  await saveIntakeRequest(ORG_A, makeRequest("req-1"), ACTOR);
});

describe("adding a note", () => {
  it("appends it to a request that has already been decided", async () => {
    const response = await addNote("req-1", "The vendor DPA came back signed.");
    expect(response.status).toBe(201);

    const [note] = await readIntakeNotes(ORG_A, "req-1");
    expect(note.body).toBe("The vendor DPA came back signed.");
    expect(note.authorId).toBe("p-anders");
  });

  it("leaves the decision exactly where it was", async () => {
    await addNote("req-1", "Scope extended by a quarter.");

    const after = await readIntakeRequest(ORG_A, "req-1");
    /* The whole argument for a separate table: the decision columns hold one
     * decision, and adding to the record must not be a way to revise it. */
    expect(after?.decision).toBe("note");
    expect(after?.decidedAt).toBe("2026-01-08");
    expect(after?.comments).toBe("Recorded without a forum decision.");
    expect(after?.status).toBe("noted");
  });

  it("keeps them in the order they were written", async () => {
    await addNote("req-1", "First thing");
    await addNote("req-1", "Second thing");

    expect((await readIntakeNotes(ORG_A, "req-1")).map((n) => n.body)).toEqual([
      "First thing",
      "Second thing",
    ]);
  });

  it("records it on the request's activity trail", async () => {
    await addNote("req-1", "The vendor was acquired.");

    const entry = (await readActivity(ORG_A, "req-1")).find(
      (event) => event.action === "added a note to the intake request",
    );
    expect(entry?.after).toBe("The vendor was acquired.");
  });

  it("cleans the text at the door", async () => {
    await addNote("req-1", "  Spaced   out  ");
    expect((await readIntakeNotes(ORG_A, "req-1"))[0].body).toBe("Spaced   out");
  });
});

describe("what it refuses", () => {
  it("refuses an empty note", async () => {
    expect((await addNote("req-1", "   ")).status).toBe(400);
    expect(await readIntakeNotes(ORG_A, "req-1")).toEqual([]);
  });

  it("refuses a body that is not a string", async () => {
    expect((await addNote("req-1", { sneaky: true })).status).toBe(400);
  });

  it("404s a request belonging to another organization", async () => {
    await saveIntakeRequest(ORG_B, makeRequest("req-2"), ACTOR);

    const response = await addNote("req-2", "Not yours.");

    // Resolved inside the caller's org by the store, so this is an answer
    // rather than a foreign key error escaping as a 500.
    expect(response.status).toBe(404);
    expect(await readIntakeNotes(ORG_B, "req-2")).toEqual([]);
  });

  it("404s an id that exists nowhere", async () => {
    expect((await addNote("req-nope", "Into the void.")).status).toBe(404);
  });
});
