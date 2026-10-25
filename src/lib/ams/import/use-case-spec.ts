/**
 * Importing a use case from a spreadsheet.
 *
 * The second register people already keep somewhere else. An organisation part
 * way through an AI audit usually has a tab called "AI usage" with a row per
 * team and a sentence about what they do with it — which is a use-case register
 * that has never been called one.
 *
 * **The system is required, and that is the difference from every other spec
 * here.** `RISK_IMPORT` treats an unmatched system name as a warning and lands
 * the row organisation-wide, because a risk about "our use of AI generally" is
 * the commonest kind in a real log. A use case has nowhere to land: the column
 * is not null and its foreign key is composite with the organisation, so an
 * unmatched name is an error and the row is held back. Importing it against some
 * default system would file somebody's HR screening tool under whatever happened
 * to be first in the inventory.
 *
 * **The tier is a warning, not an error, and this is the opposite call to the
 * risk importer's ratings.** A missing likelihood makes a risk *look* assessed at
 * 1×1; a missing tier defaults to minimal, which is the same failure — so why
 * not an error? Because the row still carries the two questions, and a use case
 * that says "yes, it informs decisions about people" while sitting at minimal is
 * visibly wrong on the register rather than invisibly wrong. The rating on a risk
 * has no such second witness. The warning names the default so nobody is
 * surprised by it.
 *
 * **Neither question is inferred from the other.** A blank "faces customers"
 * cell imports as no, and the mapping validator says so before anything is
 * applied. Guessing yes from a customer-sounding name would put a fairness
 * section into an assessment on the strength of a word in a spreadsheet.
 */
import {
  cellFor,
  coerceWord,
  isMapped,
  lower,
  matchPerson,
  matchSystem,
  requiredFieldIssues,
  type ImportSpec,
} from "../import-spec";
import { newUseCaseId } from "../use-case-create";
import type { AIUseCase, ImportIssue } from "../types";

/** The words a real usage sheet uses for the four tiers. */
const TIER_WORDS: Record<string, string> = {
  minimal: "minimal",
  low: "minimal",
  none: "minimal",
  limited: "limited",
  medium: "limited",
  moderate: "limited",
  high: "high",
  significant: "high",
  critical: "high",
  unacceptable: "unacceptable",
  prohibited: "unacceptable",
  banned: "unacceptable",
};

const OVERSIGHT_WORDS: Record<string, string> = {
  "human in the loop": "human_in_the_loop",
  human_in_the_loop: "human_in_the_loop",
  hitl: "human_in_the_loop",
  reviewed: "human_in_the_loop",
  "every output reviewed": "human_in_the_loop",
  "human on the loop": "human_on_the_loop",
  human_on_the_loop: "human_on_the_loop",
  hotl: "human_on_the_loop",
  monitored: "human_on_the_loop",
  "human in command": "human_in_command",
  human_in_command: "human_in_command",
  supervised: "human_in_command",
  none: "none",
  no: "none",
  unsupervised: "none",
  automatic: "none",
};

const STATUS_WORDS: Record<string, string> = {
  active: "active",
  live: "active",
  "in use": "active",
  production: "active",
  piloting: "piloting",
  pilot: "piloting",
  trial: "piloting",
  poc: "piloting",
  proposed: "proposed",
  planned: "proposed",
  requested: "proposed",
  retired: "retired",
  stopped: "retired",
  decommissioned: "retired",
};

/** The words a spreadsheet uses for yes. Everything else, including blank, is no. */
const YES = new Set(["yes", "y", "true", "1", "x", "✓", "yes - customer facing"]);

const truthy = (value: string) => YES.has(value.trim().toLowerCase());

export const USE_CASE_IMPORT: ImportSpec<AIUseCase> = {
  fields: [
    { id: "name", label: "Use case", required: true },
    { id: "system", label: "System", required: true },
    { id: "description", label: "Description", required: false },
    { id: "businessUnit", label: "Business unit", required: false },
    { id: "owner", label: "Owner", required: false },
    { id: "riskTier", label: "Risk tier", required: false },
    { id: "oversight", label: "Human oversight", required: false },
    { id: "oversightSummary", label: "Oversight summary", required: false },
    { id: "facesCustomers", label: "Faces customers", required: false },
    {
      id: "informsDecisionsAboutPeople",
      label: "Informs decisions about people",
      required: false,
    },
    { id: "status", label: "Status", required: false },
    { id: "approxUsers", label: "Users", required: false },
  ],

  headerWords: {
    name: ["use case", "use case name", "usage", "purpose", "activity", "task", "job", "name"],
    system: ["system", "ai system", "tool", "application", "app", "vendor", "product", "system name"],
    description: ["description", "what it does", "detail", "details", "notes", "summary"],
    businessUnit: ["business unit", "unit", "department", "team", "function", "division"],
    owner: ["owner", "use case owner", "accountable", "responsible", "assigned to"],
    riskTier: ["risk tier", "tier", "risk level", "risk", "risk classification", "classification"],
    oversight: ["oversight", "human oversight", "oversight level", "human involvement", "review"],
    oversightSummary: ["oversight summary", "how it is reviewed", "review process", "controls"],
    facesCustomers: ["faces customers", "customer facing", "external", "customer impact"],
    informsDecisionsAboutPeople: [
      "informs decisions about people",
      "affects people",
      "decisions about people",
      "human impact",
      "automated decision making",
    ],
    status: ["status", "state", "stage", "lifecycle"],
    approxUsers: ["users", "user count", "number of users", "approx users", "headcount"],
  },

  templateExample: [
    "Summarising customer support calls",
    "Otter.ai",
    "Transcribes and summarises recorded support calls for the account team",
    "Sales",
    "Ada Lovelace",
    "limited",
    "human in the loop",
    "The account manager reads every summary before it reaches the CRM",
    "no",
    "no",
    "active",
    "40",
  ],

  identityOf: (row, mapping) => cellFor(row, mapping, "name"),

  validateMapping(mapping) {
    const issues = requiredFieldIssues(USE_CASE_IMPORT, mapping);

    if (!isMapped(mapping, "riskTier")) {
      issues.push({
        level: "warning",
        column: "Risk tier",
        message:
          "No column is mapped to risk tier. Every imported use case will land at minimal, which is the tier that gets the least attention.",
      });
    }
    if (!isMapped(mapping, "oversight")) {
      issues.push({
        level: "warning",
        column: "Human oversight",
        message:
          "No column is mapped to oversight. Every imported use case will claim a human in the loop.",
      });
    }
    if (!isMapped(mapping, "owner")) {
      issues.push({
        level: "warning",
        column: "Owner",
        message: "No column is mapped to owner. Every imported use case will be unassigned.",
      });
    }
    if (!isMapped(mapping, "informsDecisionsAboutPeople")) {
      issues.push({
        level: "warning",
        column: "Informs decisions about people",
        message:
          "No column is mapped to it, so every use case imports as no — the answer that keeps the fairness section out of an assessment.",
      });
    }

    return issues;
  },

  validateRow(row, mapping, world, alreadySeen) {
    const issues: ImportIssue[] = [];
    const get = (id: string) => cellFor(row, mapping, id);

    const existing = lower(world.existingNames);
    const personNames = lower(world.people.map((p) => p.name));
    const systemNames = lower(world.systems.map((s) => s.name));

    const name = get("name");
    if (isMapped(mapping, "name") && !name) {
      issues.push({
        level: "error",
        column: "Use case",
        message: "Blank in the source file. A use case cannot be recorded without a name.",
      });
    } else if (existing.has(name.toLowerCase())) {
      issues.push({
        level: "error",
        column: "Use case",
        message: "Already in the register. Importing again would create a duplicate.",
      });
    } else if (alreadySeen.has(name.toLowerCase())) {
      issues.push({
        level: "error",
        column: "Use case",
        message: "This name appears earlier in the same file. Only the first row can be imported.",
      });
    }

    /*
     * The one error the other specs make a warning. A use case has no
     * organisation-level form to fall back to, so an unmatched system is a row
     * with nowhere to go rather than a row that goes somewhere wider.
     */
    if (isMapped(mapping, "system")) {
      const named = splitSystems(get("system"));
      if (named.length === 0) {
        issues.push({
          level: "error",
          column: "System",
          message:
            "Blank. A use case is implemented by at least one system; there is nowhere else to file it.",
        });
      } else {
        /* Every name has to resolve, not just the first. A row naming three
         * tools of which one is unregistered is a row somebody has half of, and
         * importing the half silently would record a purpose as narrower than
         * the file says it is. */
        const missing = named.filter((name) => !systemNames.has(name.toLowerCase()));
        for (const name of missing) {
          issues.push({
            level: "error",
            column: "System",
            message: `No system called "${name}" is in the inventory. Register it first, or correct the name — a use case cannot be imported without one.`,
          });
        }
      }
    }

    if (isMapped(mapping, "owner")) {
      const owner = get("owner");
      if (owner && !personNames.has(owner.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "Owner",
          message: `No user matches "${owner}". The use case will be imported without an owner.`,
        });
      }
    }

    if (isMapped(mapping, "riskTier")) {
      const tier = get("riskTier").toLowerCase();
      if (tier && !TIER_WORDS[tier]) {
        issues.push({
          level: "warning",
          column: "Risk tier",
          message: `"${get("riskTier")}" is not one of our four tiers. Will default to minimal.`,
        });
      }
    }

    if (isMapped(mapping, "oversight")) {
      const oversight = get("oversight").toLowerCase();
      if (oversight && !OVERSIGHT_WORDS[oversight]) {
        issues.push({
          level: "warning",
          column: "Human oversight",
          message: `"${get("oversight")}" is not an oversight level we recognise. Will default to a human in the loop.`,
        });
      }
    }

    if (isMapped(mapping, "status")) {
      const status = get("status").toLowerCase();
      if (status && !STATUS_WORDS[status]) {
        issues.push({
          level: "warning",
          column: "Status",
          message: `"${get("status")}" is not a status we recognise. Will default to proposed.`,
        });
      }
    }

    if (isMapped(mapping, "approxUsers")) {
      const users = get("approxUsers");
      if (users && !Number.isFinite(Number(users))) {
        issues.push({
          level: "warning",
          column: "Users",
          message: `"${users}" is not a number. Will be imported as not yet in use.`,
        });
      }
    }

    return issues;
  },

  /**
   * A planned row, become a use case.
   *
   * **`assessmentId` is null however the spreadsheet was marked**, and there is
   * no column that could set it. The link lives on the assessment and is joined
   * back on read; a file asserting one would be claiming an assessment covers
   * this use case when the assessment says nothing of the kind — the same forged
   * signature the risk importer refuses to carry across in its acceptance.
   *
   * `systemIds` is non-empty by the time this runs: `validateRow` errors on a
   * blank cell and on every unmatched name, and the planner never builds a row
   * it held back. The `filter` below is the type's floor, not a fallback
   * anybody reaches.
   */
  build(row, mapping, world) {
    const get = (id: string) => cellFor(row, mapping, id);

    const users = Number(get("approxUsers"));

    return {
      id: newUseCaseId(get("name")),
      systemOverrides: [],
      systemIds: splitSystems(get("system"))
        .map((name) => matchSystem(name, world))
        .filter((id): id is string => Boolean(id)),
      name: get("name"),
      description: get("description"),
      businessUnit: get("businessUnit"),
      ownerId: matchPerson(get("owner"), world) ?? "",
      riskTier: coerceWord<AIUseCase["riskTier"]>(get("riskTier"), TIER_WORDS, "minimal"),
      oversightLevel: coerceWord<AIUseCase["oversightLevel"]>(
        get("oversight"),
        OVERSIGHT_WORDS,
        "human_in_the_loop",
      ),
      oversightSummary: get("oversightSummary"),
      facesCustomers: truthy(get("facesCustomers")),
      informsDecisionsAboutPeople: truthy(get("informsDecisionsAboutPeople")),
      dataCategories: [],
      approxUsers: Number.isFinite(users) && users > 0 ? Math.round(users) : 0,
      status: coerceWord<AIUseCase["status"]>(get("status"), STATUS_WORDS, "proposed"),
      assessmentId: null,
    };
  },
};

/**
 * The names in a System cell.
 *
 * One purpose is often served by several tools, so the cell holds a list.
 * Semicolons rather than commas, and that is the round trip: `use-case-export`
 * writes `"; "` because a comma inside a CSV cell forces the writer to quote it
 * and a spreadsheet then shows one column looking like two. A cell with no
 * separator is a list of one, so every file written before this change still
 * imports unchanged.
 */
function splitSystems(value: string): string[] {
  return value
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean);
}
