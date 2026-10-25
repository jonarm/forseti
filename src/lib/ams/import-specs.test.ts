import { describe, expect, it } from "vitest";

import {
  cellFor,
  guessMapping,
  planImport,
  templateCsv,
  type ImportSpec,
  type ImportWorld,
} from "./import-spec";
import { FINDING_IMPORT, isoDay } from "./import/finding-spec";
import { RISK_IMPORT } from "./import/risk-spec";
import { SYSTEM_IMPORT } from "./import/system-spec";
import { USE_CASE_IMPORT } from "./import/use-case-spec";
import type {
  AIUseCase,
  ColumnMapping,
  Finding,
  ImportRawRow,
  Risk,
} from "./types";

/**
 * What each register will and will not accept from a spreadsheet.
 *
 * The planner is shared, so what is worth testing per register is its
 * *judgement*: which absences it refuses outright, which it fills in with a
 * stated default, and which fields it will not carry across at all however the
 * file was marked. Two of those are governance rules wearing an importer's
 * clothes and both have their own test below — a risk cannot arrive already
 * accepted, and a finding cannot arrive already closed.
 */

const WORLD: ImportWorld = {
  existingNames: [],
  people: [{ id: "p-devi", name: "S. Devi" }],
  businessUnits: ["Sales", "Technology"],
  systems: [{ id: "sys-otter", name: "Otter.ai" }],
  controls: [{ id: "ctl-a6-1", title: "Access review" }],
};

const NOW = new Date("2026-08-20T00:00:00Z");

/** A mapping that points each column at the field of the same name. */
function identity(spec: ImportSpec<unknown>): ColumnMapping {
  return Object.fromEntries(spec.fields.map((f) => [f.label, f.id]));
}

/** One row keyed by the spec's own labels, so the tests read like a sheet. */
function sheetRow(
  spec: ImportSpec<unknown>,
  values: Record<string, string>,
): ImportRawRow {
  const row: ImportRawRow = {};
  for (const field of spec.fields) row[field.label] = values[field.id] ?? "";
  return row;
}

function planOne(
  spec: ImportSpec<unknown>,
  values: Record<string, string>,
  world: ImportWorld = WORLD,
) {
  const mapping = identity(spec);
  const row = sheetRow(spec, values);
  const plan = planImport(spec, [row], mapping, world);
  return { plan, planned: plan.rows[0], mapping, row };
}

const messages = (planned: { issues: { message: string }[] }) =>
  planned.issues.map((i) => i.message).join(" | ");

/* --------------------------------------------------------------- shared */

describe("every spec's template round-trips through its own guesser", () => {
  for (const [name, spec] of [
    ["systems", SYSTEM_IMPORT],
    ["risks", RISK_IMPORT],
    ["findings", FINDING_IMPORT],
    ["use cases", USE_CASE_IMPORT],
  ] as const) {
    it(`maps every column of the ${name} template`, () => {
      const [header] = templateCsv(spec).split("\n");
      /* The template's headers are the spec's own labels, so a guesser that
       * could not read them would be a file we hand somebody that our own
       * mapping screen shrugs at. */
      const columns = header.split(",").map((c) => c.replace(/^"|"$/g, ""));
      const mapping = guessMapping(spec, columns);

      expect(Object.values(mapping).filter((v) => v === null)).toEqual([]);
      expect(new Set(Object.values(mapping))).toEqual(
        new Set(spec.fields.map((f) => f.id)),
      );
    });

    it(`refuses a ${name} file with no column for a required field`, () => {
      const partial: ColumnMapping = { "Some column": null };
      const issues = spec.validateMapping(partial);
      const required = spec.fields.filter((f) => f.required);

      expect(issues.filter((i) => i.level === "error")).toHaveLength(required.length);
    });
  }
});

describe("the same name twice in one file", () => {
  it("takes the first row and refuses the second", () => {
    const mapping = identity(RISK_IMPORT);
    const values = {
      title: "Model drift",
      inherentLikelihood: "4",
      inherentImpact: "4",
      residualLikelihood: "2",
      residualImpact: "2",
    };
    const rows = [sheetRow(RISK_IMPORT, values), sheetRow(RISK_IMPORT, values)];

    const plan = planImport(RISK_IMPORT, rows, mapping, WORLD);

    expect(plan.rows[0].blocked).toBe(false);
    expect(plan.rows[1].blocked).toBe(true);
    expect(messages(plan.rows[1])).toContain("appears earlier in the same file");
  });
});

/* ---------------------------------------------------------------- risks */

describe("importing risks", () => {
  const ok = {
    title: "Vendor trains on our data",
    system: "Otter.ai",
    owner: "S. Devi",
    status: "open",
    treatment: "mitigate",
    treatmentSummary: "DPA signed",
    inherentLikelihood: "4",
    inherentImpact: "5",
    residualLikelihood: "2",
    residualImpact: "3",
  };

  it("builds a risk, resolving the system and the owner by name", () => {
    const { planned, mapping } = planOne(RISK_IMPORT, ok);
    expect(planned.blocked).toBe(false);

    const risk = RISK_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Risk;
    expect(risk.title).toBe("Vendor trains on our data");
    expect(risk.systemId).toBe("sys-otter");
    expect(risk.ownerId).toBe("p-devi");
    expect(risk.inherentImpact).toBe(5);
    expect(risk.residualLikelihood).toBe(2);
    expect(risk.treatment).toBe("mitigate");
  });

  it("holds back a row with a missing rating rather than defaulting it", () => {
    const { planned } = planOne(RISK_IMPORT, { ...ok, residualImpact: "" });

    /* A risk imported at 1×1 because a cell was blank looks assessed and is
     * not, and it sorts to the bottom of a register ordered by residual —
     * exactly where nobody will find it again. */
    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("would look assessed and not be");
  });

  it("holds back a rating that is not a number", () => {
    const { planned } = planOne(RISK_IMPORT, { ...ok, inherentLikelihood: "high" });

    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("Ratings are 1 to 5");
  });

  it("warns and clamps a rating outside the scale rather than refusing it", () => {
    const { planned, mapping } = planOne(RISK_IMPORT, { ...ok, inherentImpact: "7" });

    expect(planned.blocked).toBe(false);
    expect(messages(planned)).toContain("outside our 1–5 scale");

    const risk = RISK_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Risk;
    expect(risk.inherentImpact).toBe(5);
  });

  it("lands an unmatched system organisation-wide, with a warning", () => {
    const { planned, mapping } = planOne(RISK_IMPORT, { ...ok, system: "Nothing we own" });

    expect(planned.blocked).toBe(false);
    expect(messages(planned)).toContain("organisation-wide");

    const risk = RISK_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Risk;
    // The store's rule survives the import: a risk naming no system is
    // org-level, not an orphan.
    expect(risk.systemId).toBeNull();
  });

  it("never imports a risk as already accepted", () => {
    const { planned, mapping } = planOne(RISK_IMPORT, { ...ok, status: "accepted" });

    const risk = RISK_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Risk;

    /* The spreadsheet's "accepted" is a status, not an acceptance. Somebody
     * senior accepted a residual level in another system; carrying that across
     * as though they had accepted it here would forge a signature. */
    expect(risk.status).toBe("accepted");
    expect(risk.acceptedById).toBeNull();
    expect(risk.acceptedAt).toBeNull();
  });

  it("refuses a title already in the register", () => {
    const { planned } = planOne(RISK_IMPORT, ok, {
      ...WORLD,
      existingNames: ["vendor trains on our data"],
    });

    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("Already in the register");
  });
});

/* -------------------------------------------------------------- findings */

describe("importing findings", () => {
  const ok = {
    title: "Access reviews are not evidenced",
    severity: "major",
    source: "external audit",
    raisedBy: "KPMG",
    system: "Otter.ai",
    owner: "S. Devi",
    raisedAt: "2026-05-14",
    dueAt: "2026-09-30",
    summary: "No record kept.",
  };

  it("builds a finding, mapping a real auditor's vocabulary onto ours", () => {
    const { planned, mapping } = planOne(FINDING_IMPORT, ok);
    expect(planned.blocked).toBe(false);

    const finding = FINDING_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Finding;
    // "major" and "external audit" are what a report says; the enums are ours.
    expect(finding.severity).toBe("high");
    expect(finding.source).toBe("external_audit");
    expect(finding.systemId).toBe("sys-otter");
    expect(finding.raisedAt).toBe("2026-05-14");
    expect(finding.dueAt).toBe("2026-09-30");
  });

  it("never imports a finding as closed or verified", () => {
    const { planned, mapping } = planOne(FINDING_IMPORT, ok);
    const finding = FINDING_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Finding;

    /* Closure needs a root cause, a corrective action and a dated verification
     * by somebody other than the owner. Nothing in a file proves who verified
     * what, so importing one closed would launder an unverified fix into a
     * verified one. */
    expect(finding.status).toBe("open");
    expect(finding.rootCause).toBeNull();
    expect(finding.correctiveAction).toBeNull();
    expect(finding.verifiedById).toBeNull();
    expect(finding.verifiedAt).toBeNull();
    expect(finding.closedAt).toBeNull();
  });

  it("holds back a row with no due date", () => {
    const { planned } = planOne(FINDING_IMPORT, { ...ok, dueAt: "" });

    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("never overdue");
  });

  it("refuses an ambiguous date rather than guessing at it", () => {
    const { planned } = planOne(FINDING_IMPORT, { ...ok, dueAt: "03/04/2026" });

    /* The third of April to half the world and the fourth of March to the
     * other half. A due date wrong by a month is worse than one the importer
     * asked somebody to fix. */
    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("without guessing");
  });

  it("reads the date formats it can read without guessing", () => {
    expect(isoDay("2026-09-30")).toBe("2026-09-30");
    expect(isoDay("2026-09-30T10:00:00.000Z")).toBe("2026-09-30");
    expect(isoDay("30 September 2026")).toBe("2026-09-30");
    expect(isoDay("Sep 30, 2026")).toBe("2026-09-30");
    expect(isoDay("03/04/2026")).toBeNull();
    expect(isoDay("")).toBeNull();
    expect(isoDay("soon")).toBeNull();
  });

  it("warns rather than refusing when the owner is not a user here", () => {
    const { planned, mapping } = planOne(FINDING_IMPORT, { ...ok, owner: "A. Stranger" });

    expect(planned.blocked).toBe(false);
    expect(messages(planned)).toContain("No user matches");

    const finding = FINDING_IMPORT.build(planned.raw, mapping, WORLD, NOW) as Finding;
    expect(finding.ownerId).toBe("");
  });
});

/* --------------------------------------------------------------- systems */

/* ------------------------------------------------------------ use cases */

describe("importing use cases", () => {
  const ok = {
    name: "Summarising customer support calls",
    system: "Otter.ai",
    description: "Transcribes and summarises recorded support calls",
    businessUnit: "Sales",
    owner: "S. Devi",
    riskTier: "limited",
    oversight: "human in the loop",
    oversightSummary: "The account manager reads every summary",
    facesCustomers: "no",
    informsDecisionsAboutPeople: "no",
    status: "active",
    approxUsers: "40",
  };

  it("builds a use case, resolving the system and the owner by name", () => {
    const { planned, mapping } = planOne(USE_CASE_IMPORT, ok);
    expect(planned.blocked).toBe(false);

    const useCase = USE_CASE_IMPORT.build(planned.raw, mapping, WORLD, NOW) as AIUseCase;
    expect(useCase.name).toBe("Summarising customer support calls");
    expect(useCase.systemIds).toEqual(["sys-otter"]);
    expect(useCase.ownerId).toBe("p-devi");
    expect(useCase.riskTier).toBe("limited");
    expect(useCase.oversightLevel).toBe("human_in_the_loop");
    expect(useCase.approxUsers).toBe(40);
    expect(useCase.status).toBe("active");
  });

  it("refuses an unmatched system rather than landing it anywhere", () => {
    /*
     * The one judgement this spec makes differently from every other. A risk
     * with no system is organisation-level and the importer says so with a
     * warning; a use case has nowhere to land, because `ai_use_case.system_id`
     * is not null. Importing it against some default would file somebody's HR
     * screening tool under whatever happened to be first in the inventory.
     */
    const { planned } = planOne(USE_CASE_IMPORT, { ...ok, system: "Nothing we own" });

    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("Register it first");
  });

  it("refuses a blank system too", () => {
    const { planned } = planOne(USE_CASE_IMPORT, { ...ok, system: "" });

    expect(planned.blocked).toBe(true);
    expect(messages(planned)).toContain("nowhere else to file it");
  });

  it("warns and defaults an unrecognised tier rather than refusing the row", () => {
    /* The opposite call to the risk importer's ratings, and deliberately: the
     * row still carries the two questions, so a minimal-tier use case claiming
     * it informs decisions about people is visibly wrong on the register rather
     * than invisibly wrong. */
    const { planned, mapping } = planOne(USE_CASE_IMPORT, {
      ...ok,
      riskTier: "quite spicy",
    });

    expect(planned.blocked).toBe(false);
    expect(messages(planned)).toContain("Will default to minimal");

    const useCase = USE_CASE_IMPORT.build(planned.raw, mapping, WORLD, NOW) as AIUseCase;
    expect(useCase.riskTier).toBe("minimal");
  });

  it("reads the words a real usage sheet uses for the two questions", () => {
    const { planned, mapping } = planOne(USE_CASE_IMPORT, {
      ...ok,
      facesCustomers: "TRUE",
      informsDecisionsAboutPeople: "Y",
    });

    const useCase = USE_CASE_IMPORT.build(planned.raw, mapping, WORLD, NOW) as AIUseCase;
    expect(useCase.facesCustomers).toBe(true);
    expect(useCase.informsDecisionsAboutPeople).toBe(true);
  });

  it("treats anything it does not recognise as no, and never infers one from the other", () => {
    const { planned, mapping } = planOne(USE_CASE_IMPORT, {
      ...ok,
      name: "Answering customer emails",
      facesCustomers: "yes",
      informsDecisionsAboutPeople: "",
    });

    const useCase = USE_CASE_IMPORT.build(planned.raw, mapping, WORLD, NOW) as AIUseCase;
    expect(useCase.facesCustomers).toBe(true);
    /* Guessing yes from a customer-sounding name would put a fairness section
     * into an assessment on the strength of a word in a spreadsheet. */
    expect(useCase.informsDecisionsAboutPeople).toBe(false);
  });

  it("cannot carry an assessment across", () => {
    // There is no field for it, and the built record says so. The link lives on
    // the assessment and is joined back on read.
    expect(USE_CASE_IMPORT.fields.map((f) => f.id)).not.toContain("assessmentId");

    const { planned, mapping } = planOne(USE_CASE_IMPORT, ok);
    const useCase = USE_CASE_IMPORT.build(planned.raw, mapping, WORLD, NOW) as AIUseCase;
    expect(useCase.assessmentId).toBeNull();
  });

  it("warns when nothing is mapped to the question that matters most", () => {
    const mapping: ColumnMapping = { "Use case": "name", System: "system" };
    const issues = USE_CASE_IMPORT.validateMapping(mapping);

    expect(
      issues.some(
        (i) =>
          i.level === "warning" &&
          i.column === "Informs decisions about people",
      ),
    ).toBe(true);
  });
});

describe("importing systems still behaves as it did", () => {
  it("applies the coercions the warnings promised", () => {
    const mapping = identity(SYSTEM_IMPORT);
    const row = sheetRow(SYSTEM_IMPORT, {
      name: "Otter.ai",
      vendor: "",
      origin: "Built by us",
      isGenAi: "yes",
      businessUnit: "Nowhere",
      owner: "Nobody At All",
      lifecycleStage: "trial",
    });

    const plan = planImport(SYSTEM_IMPORT, [row], mapping, WORLD);
    expect(plan.rows[0].blocked).toBe(false);

    const system = SYSTEM_IMPORT.build(row, mapping, WORLD, NOW) as {
      vendor: string;
      origin: string;
      lifecycleStage: string;
      businessUnit: string;
      ownerId: string;
      discoveredVia: string | null;
    };

    expect(system.vendor).toBe("Unknown");
    expect(system.origin).toBe("internal_model");
    expect(system.lifecycleStage).toBe("poc");
    expect(system.businessUnit).toBe("Unassigned");
    expect(system.ownerId).toBe("");
    // What lets the inventory tell a hand-written row from a batch.
    expect(system.discoveredVia).toBe("import");
  });

  it("still finds the value a mapping points at", () => {
    const mapping: ColumnMapping = { Tool: "name", Notes: null };
    expect(cellFor({ Tool: " Otter.ai ", Notes: "x" }, mapping, "name")).toBe("Otter.ai");
    expect(cellFor({ Tool: "Otter.ai" }, mapping, "vendor")).toBe("");
  });
});
