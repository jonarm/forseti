import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { IntakeSubmission } from "@/lib/ams/types";

/**
 * Intake: the submission, the decision, and the register on top of them.
 *
 * The queue was React state over fixtures until this module's commits, so the
 * first thing worth proving is simply that a request survives — and after that,
 * the three rules the routes carry that a screen alone could not:
 *
 *   - **a decision is written once.** The screen disables itself afterwards;
 *     the route is the half a second tab cannot get around;
 *   - **departing from the triage recommendation needs a written reason**,
 *     enforced where it cannot be skipped rather than only in the form;
 *   - **the reference is unique per organisation and survives a delete.** It is
 *     what somebody quotes in an email, so it must never later belong to a
 *     different request — which is exactly why the next one is computed from
 *     every reference ever issued rather than from a count of live rows.
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

const caller = {
  organizationId: ORG_A,
  userId: "user-a",
  personId: "p-devi",
  role: "governance_lead",
};
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
const { aiIntakeRequest, aiPerson } = await import("@/db/schema");
const {
  TRASH_RETENTION_DAYS,
  allIntakeReferences,
  deleteIntakeRequest,
  purgeExpiredIntakeRequests,
  readActivityByKind,
  readDeletedIntakeRequests,
  readIntakeRequest,
  readIntakeRequests,
  restoreIntakeRequest,
} = await import("@/lib/ai-store");
const { POST: SUBMIT } = await import("@/app/api/intake/route");
const { POST: DECIDE } = await import("@/app/api/intake/decision/route");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

function submission(over: Partial<IntakeSubmission> = {}): IntakeSubmission {
  return {
    name: "Otter.ai",
    description: "Transcribes sales calls",
    businessUnit: "Sales",
    origin: "procured_saas",
    isGenAi: true,
    vendor: "Otter.ai Inc.",
    dataCategories: ["customer_content"],
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    originAnswers: {},
    ...over,
  };
}

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  handler(
    new Request(`http://localhost/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const submit = (body: unknown) => post(SUBMIT, "intake", body);
const decide = (body: unknown) => post(DECIDE, "intake/decision", body);

function records(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost/api/records/intake/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind: "intake" }) },
  );
}

const cells = (text: string) => text.split("\n").map((line) => line.split(","));

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
});

describe("submitting a request", () => {
  it("stores it, and it is still there afterwards", async () => {
    const response = await submit({ submission: submission() });
    expect(response.status).toBe(201);

    const { id, reference } = await response.json();
    expect(reference).toMatch(/^REQ-\d{4}-0001$/);

    const stored = await readIntakeRequest(ORG_A, id);
    expect(stored?.submission.name).toBe("Otter.ai");
    // Decided server-side, never sent: a client that could name its own status
    // could submit something that arrives already endorsed.
    expect(stored?.status).toBe("awaiting_decision");
    expect(stored?.decision).toBeNull();
    expect(stored?.submittedById).toBe("p-devi");
    /* Computed from the answers here, not read off the body. This submission
     * touches customer content and nothing escalating, so the rules say noting
     * — and the body asked for endorsement, which is now ignored rather than
     * stored as the baseline a later departure is measured against. */
    expect(stored?.reviewType).toBe("noting");
  });

  it("ignores a recommendation the body tries to name", async () => {
    const { id } = await (
      await submit({
        submission: submission({ dataCategories: ["special_category"] }),
        // A forged "noting" on a submission the rules escalate. Storing it
        // would let the request be noted with no justification asked for.
        reviewType: "noting",
      })
    ).json();

    expect((await readIntakeRequest(ORG_A, id))?.reviewType).toBe("endorsement");
  });

  it("refuses a submission with no name or business unit", async () => {
    expect(
      (await submit({ submission: submission({ name: "" }) }))
        .status,
    ).toBe(400);
    expect(
      (
        await submit({ submission: submission({ businessUnit: "" }) })
      ).status,
    ).toBe(400);
    expect(await readIntakeRequests(ORG_A)).toEqual([]);
  });

  it("drops an origin it does not recognise rather than storing it", async () => {
    const { id } = await (
      await submit({ submission: { ...submission(), origin: "carrier_pigeon" } })
    ).json();

    /* `origin` selects the question set a system answers for the rest of its
     * life; a value outside the union would leave a request nothing knows how
     * to assess. Null is a real state — the reviewer establishes it. */
    expect((await readIntakeRequest(ORG_A, id))?.submission.origin).toBeNull();
  });

  it("numbers each organisation's references from its own sequence", async () => {
    await submit({ submission: submission() });
    const second = await (
      await submit({ submission: submission({ name: "Grammarly" }) })
    ).json();

    expect(second.reference).toMatch(/-0002$/);

    caller.organizationId = ORG_B;
    const theirs = await (
      await submit({ submission: submission() })
    ).json();
    caller.organizationId = ORG_A;

    // A global sequence would leak one customer's volume to another.
    expect(theirs.reference).toMatch(/-0001$/);
  });

  it("does not reissue a reference held by a removed request", async () => {
    const first = await (
      await submit({ submission: submission() })
    ).json();
    await deleteIntakeRequest(ORG_A, first.id, ACTOR);

    const second = await (
      await submit({ submission: submission({ name: "Grammarly" }) })
    ).json();

    /* The unique index does not forget a tombstoned row, and a reference quoted
     * in an email must never later belong to a different request — so the next
     * one is computed from every reference ever issued, not from live rows. */
    expect(second.reference).not.toBe(first.reference);
    expect(await allIntakeReferences(ORG_A)).toHaveLength(2);
  });
});

describe("deciding a request", () => {
  /**
   * A request the rules escalate, so "endorsement" below is the recommendation
   * rather than a departure from it.
   *
   * The recommendation is computed from the answers now, not named by the
   * caller — so a test that wants to decide *with* the rules has to submit a
   * submission the rules actually escalate. `special_category` fires the first
   * and least arguable of them.
   */
  async function open() {
    const { id } = await (
      await submit({ submission: submission({ dataCategories: ["special_category"] }) })
    ).json();
    return id as string;
  }

  it("records the decision and moves the status", async () => {
    const id = await open();

    const response = await decide({
      id,
      decision: "endorse",
      reviewType: "endorsement",
      overrideJustification: null,
      comments: "Low risk, standard terms.",
    });
    expect(response.status).toBe(200);

    const decided = await readIntakeRequest(ORG_A, id);
    expect(decided?.status).toBe("endorsed");
    expect(decided?.decision).toBe("endorse");
    expect(decided?.decidedById).toBe("p-devi");
    expect(decided?.comments).toBe("Low risk, standard terms.");
  });

  it("refuses to decide the same request twice", async () => {
    const id = await open();
    await decide({ id, decision: "endorse", reviewType: "endorsement", comments: "" });

    const second = await decide({
      id,
      decision: "reject",
      reviewType: "endorsement",
      comments: "changed my mind",
    });

    /* The record's whole value is that it says what was decided at the time,
     * and a second tab left open is exactly how that gets rewritten. */
    expect(second.status).toBe(409);
    expect((await readIntakeRequest(ORG_A, id))?.decision).toBe("endorse");
  });

  it("requires a written reason for departing from the recommendation", async () => {
    const id = await open();

    const refused = await decide({
      id,
      decision: "note",
      // The rules recommended endorsement.
      reviewType: "noting",
      overrideJustification: "",
      comments: "",
    });

    expect(refused.status).toBe(400);
    expect((await readIntakeRequest(ORG_A, id))?.decision).toBeNull();

    const allowed = await decide({
      id,
      decision: "note",
      reviewType: "noting",
      overrideJustification: "Vendor is already covered by the group agreement.",
      comments: "",
    });

    expect(allowed.status).toBe(200);
    const decided = await readIntakeRequest(ORG_A, id);
    expect(decided?.overrideJustification).toContain("group agreement");
  });

  it("lets a request returned for more information be decided when it comes back", async () => {
    const id = await open();

    const returned = await decide({
      id,
      decision: "more_info",
      reviewType: "endorsement",
      comments: "Which region does the vendor store the transcripts in?",
    });
    expect(returned.status).toBe(200);

    const waiting = await readIntakeRequest(ORG_A, id);
    /* Still open, and the queue is still counting: `needs_more_info` is
     * `open: true`. A decision that asked a question settled nothing. */
    expect(waiting?.status).toBe("needs_more_info");
    expect(waiting?.decision).toBe("more_info");

    const second = await decide({
      id,
      decision: "endorse",
      reviewType: "endorsement",
      comments: "EU only — confirmed.",
    });
    expect(second.status).toBe(200);

    const settled = await readIntakeRequest(ORG_A, id);
    expect(settled?.status).toBe("endorsed");
    expect(settled?.decision).toBe("endorse");
    expect(settled?.comments).toBe("EU only — confirmed.");
  });

  it("still refuses a second decision once one has settled the request", async () => {
    const id = await open();
    await decide({ id, decision: "more_info", reviewType: "endorsement", comments: "?" });
    await decide({ id, decision: "reject", reviewType: "endorsement", comments: "No." });

    // The exemption is for the question, not for the answer to it.
    const third = await decide({
      id,
      decision: "endorse",
      reviewType: "endorsement",
      comments: "changed my mind",
    });
    expect(third.status).toBe(409);
    expect((await readIntakeRequest(ORG_A, id))?.decision).toBe("reject");
  });

  it("measures every pass against the rules, not against the last pass", async () => {
    const id = await open();

    /* The first pass departed to noting and said why, which stores
     * `reviewType: "noting"`. The submission still escalates, so on the second
     * pass "endorsement" is the recommendation — agreeing with it is not a
     * departure, and measuring against the stored field would demand a
     * justification for agreeing with the panel's own recommendation. */
    await decide({
      id,
      decision: "more_info",
      reviewType: "noting",
      overrideJustification: "Group agreement already covers this vendor.",
      comments: "Send me the DPA reference.",
    });
    expect((await readIntakeRequest(ORG_A, id))?.reviewType).toBe("noting");

    const response = await decide({
      id,
      decision: "endorse",
      reviewType: "endorsement",
      overrideJustification: "",
      comments: "",
    });
    expect(response.status).toBe(200);

    const settled = await readIntakeRequest(ORG_A, id);
    expect(settled?.reviewType).toBe("endorsement");
    // Not a departure this time, so the earlier justification does not linger.
    expect(settled?.overrideJustification).toBeNull();
  });

  it("still refuses an unexplained departure on a second pass", async () => {
    const id = await open();
    await decide({ id, decision: "more_info", reviewType: "endorsement", comments: "?" });

    // The exemption reopens the decision; it does not relax the rule guarding it.
    const refused = await decide({
      id,
      decision: "note",
      reviewType: "noting",
      overrideJustification: "",
      comments: "",
    });
    expect(refused.status).toBe(400);
    expect((await readIntakeRequest(ORG_A, id))?.decision).toBe("more_info");
  });

  it("will not decide another organization's request", async () => {
    const id = await open();
    caller.organizationId = ORG_B;
    const response = await decide({
      id,
      decision: "endorse",
      reviewType: "endorsement",
      comments: "",
    });
    caller.organizationId = ORG_A;

    expect(response.status).toBe(404);
    expect((await readIntakeRequest(ORG_A, id))?.decision).toBeNull();
  });
});

describe("the queue on the shared record machinery", () => {
  async function seed() {
    const { id } = await (
      await submit({ submission: submission() })
    ).json();
    return id as string;
  }

  it("removes a request and keeps the record that it was asked", async () => {
    const id = await seed();

    const { deleted } = await (
      await records(DELETE_RECORDS, "delete", { ids: [id] })
    ).json();

    // Named by its reference — what somebody would have quoted in an email.
    expect(deleted[0].name).toMatch(/^REQ-/);
    expect(await readIntakeRequests(ORG_A)).toEqual([]);
    expect(await readIntakeRequest(ORG_A, id)).toBeNull();

    const restored = await restoreIntakeRequest(ORG_A, id, ACTOR);
    expect(restored).toBe(true);
    expect(await readIntakeRequests(ORG_A)).toHaveLength(1);
  });

  it("checks the intake resource", async () => {
    const id = await seed();
    requirePermission.mockClear();
    await records(DELETE_RECORDS, "delete", { ids: [id] });

    expect(requirePermission).toHaveBeenCalledWith(
      { intake: ["delete"] },
      expect.any(String),
    );
  });

  it("purges only what is overdue, and keeps the trail", async () => {
    const id = await seed();
    await deleteIntakeRequest(ORG_A, id, ACTOR);

    const { and, eq } = await import("drizzle-orm");
    await testDb
      .update(aiIntakeRequest)
      .set({ deletedAt: new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * DAY) })
      .where(
        and(eq(aiIntakeRequest.organizationId, ORG_A), eq(aiIntakeRequest.id, id)),
      );

    const purged = await purgeExpiredIntakeRequests(ORG_A);
    expect(purged.map((r) => r.id)).toEqual([id]);
    expect(await readDeletedIntakeRequests(ORG_A)).toEqual([]);

    const actions = (await readActivityByKind(ORG_A, "intake_request"))
      .filter((e) => e.subjectId === id)
      .map((e) => e.action);

    // "We were never told about that tool" must not become true after the fact.
    expect(actions).toContain("deleted the intake request");
    expect(actions).toContain(
      "permanently removed the intake request after its retention window",
    );
  });

  it("exports the asking and the answering", async () => {
    const id = await seed();
    /* `submission()` touches customer content and nothing escalating, so the
     * rules recommend noting. Endorsing it anyway is the departure this row is
     * meant to carry — a file showing the decision without it would hide the
     * only judgement in the record. */
    await decide({
      id,
      decision: "endorse",
      reviewType: "endorsement",
      overrideJustification: "Exec sponsor asked for a forum decision regardless.",
      comments: "",
    });

    const response = await records(EXPORT_RECORDS, "export", {
      format: "csv",
      columns: ["reference", "name", "decision", "overridden", "origin"],
      ids: [id],
    });

    const [header, row] = cells(await response.text());
    expect(header).toEqual([
      "Reference",
      "What was asked for",
      "Origin",
      "Decision",
      "Went against the recommendation",
    ]);
    expect(row[1]).toBe("Otter.ai");
    expect(row[2]).toBe("Procured SaaS");
    expect(row[3]).toBe("Endorsed");
    /* The only judgement in the record. A file carrying the decision without
     * this would hide it. */
    expect(row[4]).toBe("Yes");
  });

  it("says an undecided request is undecided rather than leaving it blank", async () => {
    const id = await seed();

    const response = await records(EXPORT_RECORDS, "export", {
      format: "csv",
      columns: ["reference", "decision"],
      ids: [id],
    });

    expect(cells(await response.text())[1][1]).toBe("Not yet decided");
  });
});
