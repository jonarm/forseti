import { describe, expect, it } from "vitest";

import { toolEntries } from "./trust-center";
import { newSystem } from "./system-create";
import { EMPTY_WORKSPACE, workspace } from "./workspace";
import type { AISystem, AIUseCase } from "./types";

/**
 * What the trust centre is willing to say out loud.
 *
 * The page has two audiences and one data set, and the boundary between them is
 * a property of the records rather than a filter at render time — that is this
 * module's opening argument and the reason these tests exist at the data layer
 * rather than in a component.
 *
 * **The case that brought the file into being.** A use case is implemented by
 * several systems, and its *name* is published prose. Deciding shareability one
 * entry at a time publishes that name through whichever parent happens to be
 * approved, while correctly withholding the entry of the parent that is not — so
 * the tool stays hidden and the sentence describing what it is used for goes out
 * anyway. There is no error, no warning, and nothing on screen to notice.
 */

function makeSystem(id: string, name: string, over: Partial<AISystem> = {}): AISystem {
  return {
    ...newSystem(
      id,
      {
        name,
        vendor: name,
        origin: "procured_saas",
        isGenAi: "yes",
        businessUnit: "Technology",
        ownerId: "p-devi",
        purpose: "Does a job somebody asked it to do.",
      },
      new Date("2026-08-01T00:00:00Z"),
    ),
    ...over,
  };
}

function makeUseCase(id: string, name: string, systemIds: string[]): AIUseCase {
  return {
    id,
    systemIds,
    systemOverrides: [],
    name,
    description: "What it does",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary: "Someone reads every output",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal"],
    approxUsers: 10,
    status: "active",
    assessmentId: null,
  };
}

const build = (systems: AISystem[], useCases: AIUseCase[]) =>
  workspace({ ...EMPTY_WORKSPACE, systems, useCases });

const entryFor = (ws: ReturnType<typeof build>, systemId: string) =>
  toolEntries(ws).find((entry) => entry.systemId === systemId);

describe("what the trust centre publishes", () => {
  it("names the purposes of an approved system", async () => {
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [makeUseCase("uc-notes", "Meeting summarisation", ["sys-a"])],
    );

    const entry = entryFor(ws, "sys-a");
    expect(entry?.audience).toBe("both");
    expect(entry?.useFor).toEqual(["Meeting summarisation"]);
  });

  it("withholds a shared purpose until every system implementing it is shareable", () => {
    /* The leak this rule exists to close. Alpha is approved and Beta is not, so
     * Beta's entry is correctly withheld — and without the rule Alpha would go
     * on to publish the name of a job Beta also does, describing the withheld
     * tool's purpose while withholding the tool. */
    const ws = build(
      [
        makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" }),
        makeSystem("sys-b", "Beta", { assessmentStatus: "submitted" }),
      ],
      [
        makeUseCase("uc-shared", "Meeting summarisation", ["sys-a", "sys-b"]),
        makeUseCase("uc-own", "Drafting replies", ["sys-a"]),
      ],
    );

    expect(entryFor(ws, "sys-b")?.audience).toBe("internal_only");

    const alpha = entryFor(ws, "sys-a");
    expect(alpha?.audience).toBe("both");
    // Its own purpose is named; the one it shares with a withheld tool is not.
    expect(alpha?.useFor).toEqual(["Drafting replies"]);
  });

  it("keeps the whole list for the system that is itself withheld", () => {
    /* Internally there is nothing to withhold: the reader can already open both
     * systems, and hiding the list would cost them the fact the page is for. */
    const ws = build(
      [
        makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" }),
        makeSystem("sys-b", "Beta", { assessmentStatus: "submitted" }),
      ],
      [makeUseCase("uc-shared", "Meeting summarisation", ["sys-a", "sys-b"])],
    );

    expect(entryFor(ws, "sys-b")?.useFor).toEqual(["Meeting summarisation"]);
  });

  it("lets a retired system share a purpose without vetoing it", () => {
    /* A retired tool has no entry on the page, so there is nothing about it to
     * infer — and retirement is a lifecycle fact rather than a reason to
     * withhold. Letting one veto would hide the purpose forever with nothing on
     * screen explaining why: the mirror of the leak, and just as quiet. */
    const ws = build(
      [
        makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" }),
        makeSystem("sys-old", "Legacy", { lifecycleStage: "retired" }),
      ],
      [makeUseCase("uc-shared", "Meeting summarisation", ["sys-a", "sys-old"])],
    );

    expect(toolEntries(ws).map((e) => e.systemId)).toEqual(["sys-a"]);
    expect(entryFor(ws, "sys-a")?.useFor).toEqual(["Meeting summarisation"]);
  });

  it("publishes the weakest oversight of the lot, and says that is what it is", () => {
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [
        { ...makeUseCase("uc-1", "Watched", ["sys-a"]) },
        {
          ...makeUseCase("uc-2", "Unwatched", ["sys-a"]),
          oversightLevel: "none",
          oversightSummary: "Nobody reviews the output",
        },
      ],
    );

    const entry = entryFor(ws, "sys-a");
    expect(entry?.oversight).toBe("Nobody reviews the output");
    // Said out loud, or a reader takes the floor for the arrangement.
    expect(entry?.oversightBasis).toMatch(/least supervised of 2/i);
  });

  it("treats an oversight level it cannot read as the weakest, not the strongest", () => {
    /* The lookup used to fall back to the *strongest* bucket, so a value this
     * map had never heard of was published as the most supervised arrangement
     * there is and could never be selected as the floor. */
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [
        { ...makeUseCase("uc-1", "Watched", ["sys-a"]) },
        {
          ...makeUseCase("uc-2", "Unknown", ["sys-a"]),
          oversightLevel: "something_new" as AIUseCase["oversightLevel"],
          oversightSummary: "An arrangement this build does not recognise",
        },
      ],
    );

    expect(entryFor(ws, "sys-a")?.oversight).toBe(
      "An arrangement this build does not recognise",
    );
  });

  it("reports the highest tier of any purpose, not an average of them", () => {
    /* Scoping attaches to the intended purpose: one high-risk job puts the tool
     * in scope for high-risk obligations however ordinary the other three are.
     * An average would let them dilute it. */
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [
        makeUseCase("uc-1", "Ordinary", ["sys-a"]),
        { ...makeUseCase("uc-2", "Minimal", ["sys-a"]), riskTier: "minimal" },
        { ...makeUseCase("uc-3", "Serious", ["sys-a"]), riskTier: "high" },
        { ...makeUseCase("uc-4", "Also minimal", ["sys-a"]), riskTier: "minimal" },
      ],
    );

    const entry = entryFor(ws, "sys-a");
    expect(entry?.highestTier).toBe("high");
    expect(entry?.governedUseCases).toBe(4);
  });

  it("reads the tier of the pairing, so one tool can publish a worse one than another", () => {
    /* The point of a pair-level override, and the case the plain maximum could
     * not express: the same job is limited risk inside an enterprise tenant and
     * high risk in a consumer chatbot. Publishing one answer against both would
     * be wrong about one of them. */
    const ws = build(
      [
        makeSystem("sys-safe", "Enterprise", { assessmentStatus: "approved" }),
        makeSystem("sys-loose", "Consumer", { assessmentStatus: "approved" }),
      ],
      [
        {
          ...makeUseCase("uc-shared", "Meeting summarisation", ["sys-safe", "sys-loose"]),
          riskTier: "limited",
          systemOverrides: [
            {
              systemId: "sys-loose",
              riskTier: "high",
              oversightLevel: null,
              oversightSummary: null,
            },
          ],
        },
      ],
    );

    expect(entryFor(ws, "sys-safe")?.highestTier).toBe("limited");
    expect(entryFor(ws, "sys-loose")?.highestTier).toBe("high");
  });

  it("reads the oversight of the pairing, so the floor differs per tool", () => {
    const ws = build(
      [
        makeSystem("sys-safe", "Enterprise", { assessmentStatus: "approved" }),
        makeSystem("sys-loose", "Consumer", { assessmentStatus: "approved" }),
      ],
      [
        {
          ...makeUseCase("uc-shared", "Meeting summarisation", ["sys-safe", "sys-loose"]),
          oversightSummary: "An analyst reads every summary",
          systemOverrides: [
            {
              systemId: "sys-loose",
              riskTier: null,
              oversightLevel: "none",
              oversightSummary: "Nobody reviews what it writes here",
            },
          ],
        },
      ],
    );

    expect(entryFor(ws, "sys-safe")?.oversight).toBe("An analyst reads every summary");
    expect(entryFor(ws, "sys-loose")?.oversight).toBe(
      "Nobody reviews what it writes here",
    );
  });

  it("leaves the tier unanswered when no purpose is recorded", () => {
    /* Null rather than "minimal". A tool nobody has recorded a purpose for has
     * not been assessed as low risk — it has not been assessed, and collapsing
     * the two is how an unexamined tool comes to look like a safe one. */
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [],
    );

    expect(entryFor(ws, "sys-a")?.highestTier).toBeNull();
  });

  it("counts every purpose, including ones it may not name", () => {
    /* `governedUseCases` is what exists; `useFor` is what may be said out loud.
     * They differ exactly when a purpose is shared with a withheld system, and
     * the gap is the fact an internal reader needs. */
    const ws = build(
      [
        makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" }),
        makeSystem("sys-b", "Beta", { assessmentStatus: "submitted" }),
      ],
      [
        makeUseCase("uc-shared", "Meeting summarisation", ["sys-a", "sys-b"]),
        makeUseCase("uc-own", "Drafting replies", ["sys-a"]),
      ],
    );

    const alpha = entryFor(ws, "sys-a");
    expect(alpha?.governedUseCases).toBe(2);
    expect(alpha?.useFor).toEqual(["Drafting replies"]);
  });

  it("is not fully governed while one of its purposes is unassessed", () => {
    /* A conjunction over purposes. The system-level status cannot say this — it
     * reads the system's own assessment and knows nothing about the jobs. */
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [
        { ...makeUseCase("uc-1", "Assessed", ["sys-a"]), assessmentId: "asmt-1" },
        { ...makeUseCase("uc-2", "Not assessed", ["sys-a"]), assessmentId: null },
      ],
    );

    const entry = entryFor(ws, "sys-a");
    expect(entry?.status).toBe("approved");
    expect(entry?.everyUseCaseAssessed).toBe(false);
  });

  it("says so when no use case is recorded separately", () => {
    const ws = build(
      [makeSystem("sys-a", "Alpha", { assessmentStatus: "approved" })],
      [],
    );

    const entry = entryFor(ws, "sys-a");
    expect(entry?.useFor).toEqual([]);
    expect(entry?.oversightBasis).toMatch(/no use case/i);
  });
});
