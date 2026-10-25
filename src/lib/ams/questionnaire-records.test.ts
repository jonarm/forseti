import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { Questionnaire } from "@/lib/ams/types";

/**
 * The questionnaire register on the shared record machinery.
 *
 * Two things are particular to this one.
 *
 * **The questions have no foreign key**, only an index — so nothing cascades and
 * the purge removes them by hand. Left behind they would be unreachable rows
 * accumulating forever, and a questionnaire id reused later would inherit
 * somebody else's questions.
 *
 * **There are no answers to remove.** Questionnaire answers are ephemeral
 * runtime state in this product and were never written to a table, which is the
 * one place where "we do not store it" makes a purge simpler rather than
 * harder — and the reason the export carries state rather than content.
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
const { aiPerson, aiQuestionnaire, aiQuestionnaireQuestion } = await import(
  "@/db/schema"
);
const {
  TRASH_RETENTION_DAYS,
  deleteQuestionnaire,
  purgeExpiredQuestionnaires,
  readActivityByKind,
  readDeletedQuestionnaires,
  readQuestionnaires,
  restoreQuestionnaire,
  saveQuestionnaire,
} = await import("@/lib/ai-store");
const { POST: DELETE_RECORDS } = await import("@/app/api/records/[kind]/delete/route");
const { POST: EXPORT_RECORDS } = await import("@/app/api/records/[kind]/export/route");

const ACTOR = { userId: "seed" };
const DAY = 24 * 60 * 60 * 1000;

function makeQuestionnaire(
  id: string,
  title: string,
  over: Partial<Questionnaire> = {},
): Questionnaire {
  return {
    id,
    title,
    requester: "Northwind Bank",
    requesterType: "customer",
    receivedAt: "2026-05-01",
    dueAt: "2026-06-15",
    ownerId: "p-devi",
    status: "in_progress",
    note: "Annual vendor review",
    questions: [
      {
        id: `${id}-q1`,
        number: "1.1",
        text: "Do you train models on customer data?",
        controlIds: ["ctl-a5-1"],
        policyIds: [],
        evidenceIds: [],
      },
      {
        id: `${id}-q2`,
        number: "1.2",
        text: "Describe your incident process.",
        controlIds: [],
        policyIds: [],
        evidenceIds: [],
      },
    ],
    ...over,
  };
}

function call(
  handler: (r: Request, ctx: { params: Promise<{ kind: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost/api/records/questionnaire/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind: "questionnaire" }) },
  );
}

const remove = (body: unknown) => call(DELETE_RECORDS, "delete", body);
const exportQuestionnaires = (body: unknown) => call(EXPORT_RECORDS, "export", body);
const cells = (text: string) => text.split("\n").map((line) => line.split(","));

async function removedDaysAgo(organizationId: string, id: string, days: number) {
  await deleteQuestionnaire(organizationId, id, ACTOR);
  const { and, eq } = await import("drizzle-orm");
  await testDb
    .update(aiQuestionnaire)
    .set({ deletedAt: new Date(Date.now() - days * DAY) })
    .where(
      and(eq(aiQuestionnaire.organizationId, organizationId), eq(aiQuestionnaire.id, id)),
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

  await saveQuestionnaire(ORG_A, makeQuestionnaire("qn-one", "Northwind vendor review"), ACTOR);
  await saveQuestionnaire(
    ORG_A,
    makeQuestionnaire("qn-two", "Regulator information request", {
      requester: "Financial Conduct Authority",
      requesterType: "regulator",
      status: "submitted",
    }),
    ACTOR,
  );
  await saveQuestionnaire(ORG_B, makeQuestionnaire("qn-theirs", "Somebody else's"), ACTOR);
});

describe("removing questionnaires through the generic route", () => {
  it("removes the ones it is given and names them", async () => {
    const { deleted, refused } = await (await remove({ ids: ["qn-one"] })).json();

    expect(refused).toEqual([]);
    expect(deleted).toEqual([{ id: "qn-one", name: "Northwind vendor review" }]);
    expect((await readQuestionnaires(ORG_A)).map((q) => q.id)).toEqual(["qn-two"]);
  });

  it("will not reach another organization's register", async () => {
    const { deleted } = await (await remove({ ids: ["qn-theirs"] })).json();

    expect(deleted).toEqual([]);
    expect((await readQuestionnaires(ORG_B)).map((q) => q.id)).toEqual(["qn-theirs"]);
  });

  it("checks the questionnaire resource", async () => {
    requirePermission.mockClear();
    await remove({ ids: ["qn-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { questionnaire: ["delete"] },
      expect.any(String),
    );
  });

  it("brings the questions back on a restore", async () => {
    await deleteQuestionnaire(ORG_A, "qn-one", ACTOR);
    expect(await restoreQuestionnaire(ORG_A, "qn-one", ACTOR)).toBe(true);

    const back = (await readQuestionnaires(ORG_A)).find((q) => q.id === "qn-one");
    /* The questions were only ever unreachable, never removed — so the
     * questionnaire returns whole rather than as an empty shell. */
    expect(back?.questions.map((q) => q.number)).toEqual(["1.1", "1.2"]);
  });
});

describe("the purge, and the rows nothing cascades from", () => {
  it("removes the questions by hand, because no foreign key does it", async () => {
    await removedDaysAgo(ORG_A, "qn-one", TRASH_RETENTION_DAYS + 1);
    await purgeExpiredQuestionnaires(ORG_A);

    const left = await testDb.select().from(aiQuestionnaireQuestion);
    /* Left behind they would be unreachable rows accumulating forever, and a
     * questionnaire id reused later would inherit somebody else's questions. */
    expect(left.filter((q) => q.questionnaireId === "qn-one")).toEqual([]);
    // The one still in its window keeps its questions.
    expect(left.filter((q) => q.questionnaireId === "qn-two")).toHaveLength(2);
  });

  it("purges only what is overdue, and keeps the trail", async () => {
    await removedDaysAgo(ORG_A, "qn-one", TRASH_RETENTION_DAYS + 1);
    await removedDaysAgo(ORG_A, "qn-two", TRASH_RETENTION_DAYS - 1);

    const purged = await purgeExpiredQuestionnaires(ORG_A);
    expect(purged.map((q) => q.id)).toEqual(["qn-one"]);
    expect((await readDeletedQuestionnaires(ORG_A)).map((q) => q.id)).toEqual(["qn-two"]);

    const actions = (await readActivityByKind(ORG_A, "questionnaire"))
      .filter((e) => e.subjectId === "qn-one")
      .map((e) => e.action);

    /* Whoever sent it still believes it is being answered. "We never received
     * that" must not become true after the fact. */
    expect(actions).toContain("deleted the questionnaire");
    expect(actions).toContain(
      "permanently removed the questionnaire after its retention window",
    );
  });

  it("will not purge another organization's overdue questionnaire", async () => {
    await removedDaysAgo(ORG_B, "qn-theirs", TRASH_RETENTION_DAYS + 5);
    await removedDaysAgo(ORG_A, "qn-one", TRASH_RETENTION_DAYS + 5);

    await purgeExpiredQuestionnaires(ORG_A);

    expect(await readDeletedQuestionnaires(ORG_B)).toHaveLength(1);
  });
});

describe("exporting questionnaires", () => {
  it("exports the state of the queue, not its contents", async () => {
    const response = await exportQuestionnaires({
      format: "csv",
      columns: ["title", "requester", "requesterType", "status", "questionCount"],
      ids: ["qn-two"],
    });

    const [header, row] = cells(await response.text());
    expect(header).toEqual([
      "Questionnaire",
      "Requester",
      "Requester type",
      "Status",
      "Questions",
    ]);
    expect(row[1]).toBe("Financial Conduct Authority");
    // A regulator's request and a prospect's are the same shape and not the
    // same urgency; the mix is worth being able to count.
    expect(row[2]).toBe("Regulator");
    expect(row[4]).toBe("2");
  });

  it("counts the questions with nothing to cite", async () => {
    const response = await exportQuestionnaires({
      format: "csv",
      columns: ["title", "unsupportedCount"],
      ids: ["qn-one"],
    });

    /* One of the two has a control behind it and the other has nothing — the
     * one somebody will have to answer from memory, or decline. */
    expect(cells(await response.text())[1][1]).toBe("1");
  });

  it("does not call a submitted questionnaire overdue", async () => {
    const response = await exportQuestionnaires({
      format: "csv",
      columns: ["title", "overdue"],
      ids: ["qn-one", "qn-two"],
    });

    const rows = cells(await response.text());
    expect(rows.find((r) => r[0].startsWith("Northwind"))?.[1]).toBe("Yes");
    expect(rows.find((r) => r[0].startsWith("Regulator"))?.[1]).toBe("No");
  });

  it("records the export against the questionnaire register", async () => {
    await exportQuestionnaires({ format: "csv", columns: ["title"], ids: ["qn-one"] });

    const entry = (await readActivityByKind(ORG_A, "organization")).find(
      (e) => e.action === "exported the Questionnaires",
    );

    expect(entry?.after).toContain("1 questionnaire");
  });
});
