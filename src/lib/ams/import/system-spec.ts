/**
 * Importing an AI system from a spreadsheet.
 *
 * The inventory's `ImportSpec` — what its fields are, what a bad row looks like
 * and what a good one becomes. How a file is planned, guessed at and templated
 * lives in `import-spec.ts`, which knows nothing about systems.
 *
 * **Nothing is coerced silently.** Every default this spec would write is a
 * warning on the row that would get it, so the person confirming has already
 * read it. An error is different: it means we would be inventing the record
 * rather than importing it, and the row cannot be forced in.
 */
import {
  cellFor,
  coerceBoolean,
  coerceWord,
  isMapped,
  lower,
  matchPerson,
  requiredFieldIssues,
  type ImportSpec,
  type ImportWorld,
} from "../import-spec";
import { newSystemId, reviewWindow } from "../system-create";
import type {
  AISystem,
  ImportIssue,
  LifecycleStage,
  SystemOrigin,
} from "../types";

/*
 * The vocabularies a real tracker is written in, not the ones our enums use.
 * "Bundled with CRM" and "Built by us" are phrases from an actual procurement
 * sheet: an importer that only understood our own words would reject the file
 * it exists to read.
 */
const ORIGIN_WORDS: Record<string, string> = {
  "saas subscription": "procured_saas",
  saas: "procured_saas",
  "bundled with crm": "procured_saas",
  api: "api_integration",
  "api integration": "api_integration",
  "internal build": "internal_model",
  "built by us": "internal_model",
};

const LIFECYCLE_WORDS: Record<string, string> = {
  proposed: "proposed",
  poc: "poc",
  "proof of concept": "poc",
  trial: "poc",
  pilot: "pilot",
  production: "production",
  live: "production",
  deprecated: "deprecated",
  retired: "retired",
};

function businessUnitFor(value: string, world: ImportWorld): string {
  const match = world.businessUnits.find(
    (u) => u.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? "Unassigned";
}

export const SYSTEM_IMPORT: ImportSpec<AISystem> = {
  fields: [
    { id: "name", label: "System name", required: true },
    { id: "vendor", label: "Vendor", required: false },
    { id: "origin", label: "Origin", required: false },
    { id: "isGenAi", label: "GenAI", required: false },
    { id: "businessUnit", label: "Business unit", required: false },
    { id: "owner", label: "Owner", required: false },
    { id: "lifecycleStage", label: "Lifecycle stage", required: false },
  ],

  /*
   * "How we got it" is deliberately absent from the origin list even though it
   * is the header on the sample file. Teaching the guesser one spreadsheet's
   * phrasing would make the demo look smarter and delete the reason the mapping
   * table exists. "Status" is absent from the lifecycle list because in a
   * procurement tracker it means approval status at least as often.
   */
  headerWords: {
    name: ["name", "system", "system name", "ai system", "ai system name", "ai tool", "ai tool name", "tool", "tool name", "application", "app", "product", "service", "solution"],
    vendor: ["vendor", "vendor name", "supplier", "provider", "publisher", "manufacturer"],
    origin: ["origin", "source", "procurement", "procurement type", "acquisition", "acquisition type"],
    isGenAi: ["genai", "gen ai", "generative ai", "uses genai", "is genai", "llm"],
    businessUnit: ["business unit", "unit", "department", "dept", "team", "division", "function"],
    owner: ["owner", "system owner", "business owner", "technical owner", "requested by", "requester", "requestor", "responsible", "accountable", "contact"],
    lifecycleStage: ["lifecycle stage", "lifecycle", "stage", "phase"],
  },

  /* Values the coercions genuinely accept, so the row doubles as documentation
   * of them: "SaaS subscription" and "pilot" import cleanly. */
  templateExample: [
    "Otter.ai",
    "Otter.ai Inc.",
    "SaaS subscription",
    "yes",
    "Sales",
    "Ada Lovelace",
    "pilot",
  ],

  identityOf: (row, mapping) => cellFor(row, mapping, "name"),

  validateMapping(mapping) {
    const issues = requiredFieldIssues(SYSTEM_IMPORT, mapping);

    if (!isMapped(mapping, "origin")) {
      issues.push({
        level: "warning",
        column: "Origin",
        message:
          "No column is mapped to origin, so every row will default to procured SaaS and need review. Try \u201cHow we got it\u201d.",
      });
    }
    if (!isMapped(mapping, "owner")) {
      issues.push({
        level: "warning",
        column: "Owner",
        message: "No column is mapped to owner. Every imported system will be unassigned.",
      });
    }

    return issues;
  },

  validateRow(row, mapping, world, alreadySeen) {
    const issues: ImportIssue[] = [];
    const get = (id: string) => cellFor(row, mapping, id);

    const existingNames = lower(world.existingNames);
    const personNames = lower(world.people.map((p) => p.name));
    const unitNames = lower(world.businessUnits);

    const name = get("name");
    if (isMapped(mapping, "name") && !name) {
      issues.push({
        level: "error",
        column: "System name",
        message: "Blank in the source file. A system cannot be registered without a name.",
      });
    } else if (existingNames.has(name.toLowerCase())) {
      issues.push({
        level: "error",
        column: "System name",
        message: "Already in the inventory. Importing again would create a duplicate record.",
      });
    } else if (alreadySeen.has(name.toLowerCase())) {
      issues.push({
        level: "error",
        column: "System name",
        message:
          "This name appears earlier in the same file. Only the first row can be imported.",
      });
    }

    if (isMapped(mapping, "vendor") && !get("vendor")) {
      issues.push({
        level: "warning",
        column: "Vendor",
        message: "Blank. Will be imported as \u201cUnknown\u201d and flagged for follow-up.",
      });
    }

    if (isMapped(mapping, "origin")) {
      const origin = get("origin").toLowerCase();
      if (origin && !ORIGIN_WORDS[origin]) {
        issues.push({
          level: "warning",
          column: "Origin",
          message: `"${get("origin")}" is not one of our three origins. Will default to procured SaaS.`,
        });
      }
    }

    if (isMapped(mapping, "businessUnit")) {
      const unit = get("businessUnit");
      if (unit && !unitNames.has(unit.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "Business unit",
          message: `"${unit}" is not a business unit we know. Will be imported unassigned.`,
        });
      }
    }

    if (isMapped(mapping, "owner")) {
      const owner = get("owner");
      if (owner && !personNames.has(owner.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "Owner",
          message: `No user matches "${owner}". The system will be imported without an owner.`,
        });
      }
    }

    if (isMapped(mapping, "lifecycleStage")) {
      const stage = get("lifecycleStage").toLowerCase();
      if (stage && !LIFECYCLE_WORDS[stage]) {
        issues.push({
          level: "warning",
          column: "Lifecycle stage",
          message: `"${get("lifecycleStage")}" is not a stage we recognise. Will default to proposed.`,
        });
      }
    }

    return issues;
  },

  /**
   * A planned row, become a system.
   *
   * Everything absent gets an obviously provisional value rather than a
   * plausible one — an imported row lands at minimal risk, not started, no
   * coverage, so it shows up in the attention list as work to do instead of
   * quietly looking assessed. `discoveredVia: "import"` is what lets the
   * inventory tell a row somebody wrote down by hand from one that arrived in a
   * batch.
   *
   * The id is minted by the same function the register form's route uses:
   * `saveAiSystem` upserts, so an id derived from a row's position in a file
   * would collide across two imports and silently overwrite the first one.
   */
  build(row, mapping, world, now) {
    const get = (id: string) => cellFor(row, mapping, id);
    const name = get("name");
    const vendor = get("vendor") || "Unknown";

    return {
      id: newSystemId(name),
      name,
      vendor,
      origin: coerceWord<SystemOrigin>(get("origin"), ORIGIN_WORDS, "procured_saas"),
      isGenAi: coerceBoolean(get("isGenAi")),
      businessUnit: businessUnitFor(get("businessUnit"), world),
      ownerId: matchPerson(get("owner"), world) ?? "",
      lifecycleStage: coerceWord<LifecycleStage>(
        get("lifecycleStage"),
        LIFECYCLE_WORDS,
        "proposed",
      ),
      riskTier: "minimal",
      assessmentStatus: "not_started",
      purpose: "",
      deploymentModel: "vendor_multi_tenant",
      hostingRegions: [],
      dataResidency: "Not recorded",
      userGroups: [],
      approxUsers: 0,
      dataCategories: [],
      characteristics: [],
      vendorDetail: {
        name: vendor,
        subProcessors: [],
        modelProvider: null,
        contractType: "click_through",
        dataProcessingAgreement: false,
        certifications: [],
        trainsOnCustomerData: false,
        renewalDate: null,
      },
      ...reviewWindow(now),
      discoveredVia: "import",
    };
  },
};
