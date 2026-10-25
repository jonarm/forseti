/**
 * Importing a risk from a spreadsheet.
 *
 * The register people most often already keep somewhere else — a risk log in
 * Excel predates every tool that replaces it, which is the whole argument for
 * this existing at all.
 *
 * **The four numbers are the import.** A risk without an inherent and a
 * residual rating is not a risk, it is a sentence; so likelihood and impact are
 * required on both sides and a row missing any of them is held back rather than
 * defaulted. Defaulting them would produce a register full of 1×1 risks that
 * look assessed and are not, which is worse than importing nothing.
 *
 * **A risk that names no system is organisation-level, not broken.** That is the
 * store's rule and it survives the import: an unmatched system name is a
 * warning and the row lands org-wide, because a risk about "our use of AI
 * generally" is the commonest kind in a real log.
 */
import {
  cellFor,
  coerceScale,
  coerceWord,
  isMapped,
  lower,
  matchPerson,
  matchSystem,
  requiredFieldIssues,
  type ImportSpec,
} from "../import-spec";
import { newRiskId } from "../risk-create";
import type { ImportIssue, Risk } from "../types";

/** The words a real risk log uses for the four treatments. */
const TREATMENT_WORDS: Record<string, string> = {
  mitigate: "mitigate",
  mitigated: "mitigate",
  reduce: "mitigate",
  treat: "mitigate",
  accept: "accept",
  accepted: "accept",
  tolerate: "accept",
  transfer: "transfer",
  transferred: "transfer",
  insure: "transfer",
  share: "transfer",
  avoid: "avoid",
  avoided: "avoid",
  terminate: "avoid",
};

const STATUS_WORDS: Record<string, string> = {
  open: "open",
  new: "open",
  active: "open",
  treated: "treated",
  mitigated: "treated",
  accepted: "accepted",
  closed: "closed",
  done: "closed",
  resolved: "closed",
};

/** The four ratings, so the required-and-numeric rule is written once. */
const RATINGS = [
  { id: "inherentLikelihood", label: "Inherent likelihood" },
  { id: "inherentImpact", label: "Inherent impact" },
  { id: "residualLikelihood", label: "Residual likelihood" },
  { id: "residualImpact", label: "Residual impact" },
] as const;

export const RISK_IMPORT: ImportSpec<Risk> = {
  fields: [
    { id: "title", label: "Risk", required: true },
    { id: "system", label: "System", required: false },
    { id: "owner", label: "Owner", required: false },
    { id: "status", label: "Status", required: false },
    { id: "treatment", label: "Treatment", required: false },
    { id: "treatmentSummary", label: "Treatment summary", required: false },
    { id: "inherentLikelihood", label: "Inherent likelihood", required: true },
    { id: "inherentImpact", label: "Inherent impact", required: true },
    { id: "residualLikelihood", label: "Residual likelihood", required: true },
    { id: "residualImpact", label: "Residual impact", required: true },
  ],

  headerWords: {
    title: ["risk", "title", "risk title", "risk name", "description", "risk description", "name"],
    system: ["system", "ai system", "ai system name", "asset", "application", "tool", "system name"],
    owner: ["owner", "risk owner", "accountable", "responsible", "assigned to"],
    status: ["status", "risk status", "state"],
    treatment: ["treatment", "response", "risk response", "strategy", "treatment strategy"],
    treatmentSummary: ["treatment summary", "mitigation", "mitigations", "controls", "action", "treatment plan"],
    inherentLikelihood: ["inherent likelihood", "gross likelihood", "likelihood before", "raw likelihood"],
    inherentImpact: ["inherent impact", "gross impact", "impact before", "raw impact"],
    residualLikelihood: ["residual likelihood", "net likelihood", "likelihood after", "current likelihood"],
    residualImpact: ["residual impact", "net impact", "impact after", "current impact"],
  },

  templateExample: [
    "Vendor trains on our customer data",
    "Otter.ai",
    "Ada Lovelace",
    "open",
    "mitigate",
    "Contract amended; DPA signed",
    "4",
    "5",
    "2",
    "4",
  ],

  identityOf: (row, mapping) => cellFor(row, mapping, "title"),

  validateMapping(mapping) {
    const issues = requiredFieldIssues(RISK_IMPORT, mapping);

    if (!isMapped(mapping, "owner")) {
      issues.push({
        level: "warning",
        column: "Owner",
        message: "No column is mapped to owner. Every imported risk will be unassigned.",
      });
    }
    if (!isMapped(mapping, "system")) {
      issues.push({
        level: "warning",
        column: "System",
        message:
          "No column is mapped to system, so every risk will be imported as organisation-wide.",
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

    const title = get("title");
    if (isMapped(mapping, "title") && !title) {
      issues.push({
        level: "error",
        column: "Risk",
        message: "Blank in the source file. A risk cannot be registered without a title.",
      });
    } else if (existing.has(title.toLowerCase())) {
      issues.push({
        level: "error",
        column: "Risk",
        message: "Already in the register. Importing again would create a duplicate.",
      });
    } else if (alreadySeen.has(title.toLowerCase())) {
      issues.push({
        level: "error",
        column: "Risk",
        message: "This title appears earlier in the same file. Only the first row can be imported.",
      });
    }

    /*
     * The ratings are errors, not warnings. A risk imported at 1×1 because its
     * likelihood cell was blank looks assessed and is not, and it sorts to the
     * bottom of a register ordered by residual — which is exactly where nobody
     * will find it again.
     */
    for (const rating of RATINGS) {
      if (!isMapped(mapping, rating.id)) continue;

      const raw = get(rating.id);
      if (!raw) {
        issues.push({
          level: "error",
          column: rating.label,
          message: "Blank. A risk imported without a rating would look assessed and not be.",
        });
        continue;
      }

      const n = Number(raw);
      if (!Number.isFinite(n)) {
        issues.push({
          level: "error",
          column: rating.label,
          message: `"${raw}" is not a number. Ratings are 1 to 5.`,
        });
      } else if (n < 1 || n > 5) {
        issues.push({
          level: "warning",
          column: rating.label,
          message: `${raw} is outside our 1–5 scale. Will be brought to ${Math.min(5, Math.max(1, Math.round(n)))}.`,
        });
      }
    }

    if (isMapped(mapping, "system")) {
      const system = get("system");
      if (system && !systemNames.has(system.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "System",
          message: `No system called "${system}" is in the inventory. The risk will be imported as organisation-wide.`,
        });
      }
    }

    if (isMapped(mapping, "owner")) {
      const owner = get("owner");
      if (owner && !personNames.has(owner.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "Owner",
          message: `No user matches "${owner}". The risk will be imported without an owner.`,
        });
      }
    }

    if (isMapped(mapping, "treatment")) {
      const treatment = get("treatment").toLowerCase();
      if (treatment && !TREATMENT_WORDS[treatment]) {
        issues.push({
          level: "warning",
          column: "Treatment",
          message: `"${get("treatment")}" is not one of our four treatments. Will default to mitigate.`,
        });
      }
    }

    if (isMapped(mapping, "status")) {
      const status = get("status").toLowerCase();
      if (status && !STATUS_WORDS[status]) {
        issues.push({
          level: "warning",
          column: "Status",
          message: `"${get("status")}" is not a status we recognise. Will default to open.`,
        });
      }
    }

    return issues;
  },

  /**
   * A planned row, become a risk.
   *
   * **`acceptedById` is null however the spreadsheet was marked.** A risk
   * imported as "accepted" has a status, not an acceptance: somebody senior
   * accepted a residual level in another system, and carrying that across as
   * though they had accepted it here would forge a signature. The register
   * shows it as nobody having accepted the residue, which is true, and the
   * whole point of that column.
   */
  build(row, mapping, world) {
    const get = (id: string) => cellFor(row, mapping, id);
    const scale = (id: string, fallback: number) => coerceScale(get(id), fallback);

    return {
      id: newRiskId(get("title")),
      title: get("title"),
      systemId: matchSystem(get("system"), world),
      useCaseId: null,
      controlIds: [],
      inherentLikelihood: scale("inherentLikelihood", 3) as Risk["inherentLikelihood"],
      inherentImpact: scale("inherentImpact", 3) as Risk["inherentImpact"],
      treatment: coerceWord<Risk["treatment"]>(
        get("treatment"),
        TREATMENT_WORDS,
        "mitigate",
      ),
      treatmentSummary: get("treatmentSummary"),
      residualLikelihood: scale("residualLikelihood", 3) as Risk["residualLikelihood"],
      residualImpact: scale("residualImpact", 3) as Risk["residualImpact"],
      ownerId: matchPerson(get("owner"), world) ?? "",
      status: coerceWord<Risk["status"]>(get("status"), STATUS_WORDS, "open"),
      acceptedById: null,
      acceptedAt: null,
    };
  },
};
