/**
 * Importing a finding from a spreadsheet.
 *
 * Findings arrive from somewhere else more often than any other register: an
 * external auditor sends a report, and what lands in somebody's inbox is a
 * table of observations with dates against them. That table is what this reads.
 *
 * **A finding cannot be imported closed.** Closure needs a root cause, a
 * corrective action and a dated verification by somebody other than the owner —
 * a rule the product enforces at `canClose` and cannot enforce over a
 * spreadsheet, because nothing in a file proves who verified what. So a row
 * marked closed comes in at its real state and says so, and somebody closes it
 * here where the rule applies. Importing it closed would let a register launder
 * an unverified fix into a verified one.
 *
 * **Dates are required.** A finding without a raised date has no age and one
 * without a due date is never overdue, which makes both of them invisible in
 * the only two views that matter.
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
import { newFindingId } from "../finding-create";
import type { Finding, ImportIssue } from "../types";

const SEVERITY_WORDS: Record<string, string> = {
  low: "low",
  minor: "low",
  medium: "medium",
  moderate: "medium",
  major: "high",
  high: "high",
  critical: "critical",
  severe: "critical",
};

const SOURCE_WORDS: Record<string, string> = {
  "internal audit": "internal_audit",
  internal: "internal_audit",
  "external audit": "external_audit",
  external: "external_audit",
  auditor: "external_audit",
  "self identified": "self_identified",
  self: "self_identified",
  incident: "incident",
  regulator: "regulator",
  customer: "customer",
  "supplier review": "supplier_review",
  supplier: "supplier_review",
  vendor: "supplier_review",
};

/**
 * A date a spreadsheet might hold, as an ISO day.
 *
 * Only the unambiguous forms. `03/04/2026` is deliberately refused rather than
 * guessed at: it is the third of April to half the world and the fourth of
 * March to the other half, and a finding due date wrong by a month is worse
 * than one the importer asked somebody to fix.
 */
export function isoDay(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  // 2026-06-30, and what a spreadsheet exports as an ISO timestamp.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 30 June 2026 / 30 Jun 2026, and the American order of the same words.
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed) && /[a-z]/i.test(raw)) {
    /*
     * Read back in local time, not through `toISOString()`.
     *
     * `Date.parse("30 September 2026")` is local midnight, and converting that
     * to UTC lands on the 29th for anybody east of Greenwich — so every
     * text-format date would import one day early, silently, for most of the
     * world. The calendar fields are what the author of the spreadsheet meant.
     */
    const date = new Date(parsed);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  return null;
}

const DATES = [
  { id: "raisedAt", label: "Raised" },
  { id: "dueAt", label: "Due" },
] as const;

export const FINDING_IMPORT: ImportSpec<Finding> = {
  fields: [
    { id: "title", label: "Finding", required: true },
    { id: "severity", label: "Severity", required: false },
    { id: "source", label: "Source", required: false },
    { id: "raisedBy", label: "Raised by", required: false },
    { id: "system", label: "System", required: false },
    { id: "owner", label: "Owner", required: false },
    { id: "raisedAt", label: "Raised", required: true },
    { id: "dueAt", label: "Due", required: true },
    { id: "summary", label: "Summary", required: false },
  ],

  headerWords: {
    title: ["finding", "title", "finding title", "observation", "issue", "nonconformity", "non conformity", "name"],
    severity: ["severity", "rating", "risk rating", "priority", "grade"],
    source: ["source", "raised by type", "origin", "audit type"],
    raisedBy: ["raised by", "auditor", "reference", "audit reference", "identified by", "reported by"],
    system: ["system", "ai system", "asset", "application", "tool", "system name"],
    owner: ["owner", "action owner", "assigned to", "responsible", "accountable"],
    raisedAt: ["raised", "raised at", "raised on", "date raised", "identified", "date identified", "opened"],
    dueAt: ["due", "due at", "due date", "target date", "deadline", "target"],
    summary: ["summary", "detail", "details", "description", "observation detail"],
  },

  templateExample: [
    "Access reviews are not evidenced",
    "high",
    "internal audit",
    "Internal Audit",
    "Otter.ai",
    "Ada Lovelace",
    "2026-05-14",
    "2026-09-30",
    "Quarterly reviews are performed but no record is kept.",
  ],

  identityOf: (row, mapping) => cellFor(row, mapping, "title"),

  validateMapping(mapping) {
    const issues = requiredFieldIssues(FINDING_IMPORT, mapping);

    if (!isMapped(mapping, "owner")) {
      issues.push({
        level: "warning",
        column: "Owner",
        message:
          "No column is mapped to owner. Every imported finding will be unassigned, and a finding nobody owns is not being fixed.",
      });
    }
    if (!isMapped(mapping, "severity")) {
      issues.push({
        level: "warning",
        column: "Severity",
        message: "No column is mapped to severity, so every finding will be imported as medium.",
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
        column: "Finding",
        message: "Blank in the source file. A finding cannot be raised without a title.",
      });
    } else if (existing.has(title.toLowerCase())) {
      issues.push({
        level: "error",
        column: "Finding",
        message: "Already in the register. Importing again would create a duplicate.",
      });
    } else if (alreadySeen.has(title.toLowerCase())) {
      issues.push({
        level: "error",
        column: "Finding",
        message: "This title appears earlier in the same file. Only the first row can be imported.",
      });
    }

    for (const date of DATES) {
      if (!isMapped(mapping, date.id)) continue;

      const raw = get(date.id);
      if (!raw) {
        issues.push({
          level: "error",
          column: date.label,
          message:
            date.id === "dueAt"
              ? "Blank. A finding with no due date is never overdue, which makes it invisible."
              : "Blank. A finding with no raised date has no age.",
        });
      } else if (!isoDay(raw)) {
        issues.push({
          level: "error",
          column: date.label,
          message: `"${raw}" is not a date we can read without guessing. Use 2026-09-30, or 30 September 2026.`,
        });
      }
    }

    if (isMapped(mapping, "system")) {
      const system = get("system");
      if (system && !systemNames.has(system.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "System",
          message: `No system called "${system}" is in the inventory. The finding will be imported as organisation-wide.`,
        });
      }
    }

    if (isMapped(mapping, "owner")) {
      const owner = get("owner");
      if (owner && !personNames.has(owner.toLowerCase())) {
        issues.push({
          level: "warning",
          column: "Owner",
          message: `No user matches "${owner}". The finding will be imported without an owner.`,
        });
      }
    }

    if (isMapped(mapping, "severity")) {
      const severity = get("severity").toLowerCase();
      if (severity && !SEVERITY_WORDS[severity]) {
        issues.push({
          level: "warning",
          column: "Severity",
          message: `"${get("severity")}" is not a severity we recognise. Will default to medium.`,
        });
      }
    }

    if (isMapped(mapping, "source")) {
      const source = get("source").toLowerCase();
      if (source && !SOURCE_WORDS[source]) {
        issues.push({
          level: "warning",
          column: "Source",
          message: `"${get("source")}" is not a source we recognise. Will be imported as self-identified.`,
        });
      }
    }

    return issues;
  },

  /**
   * A planned row, become a finding.
   *
   * **It always arrives open.** Root cause, corrective action and verification
   * are all null however the spreadsheet was marked, because nothing in a file
   * proves who verified what — and a finding imported closed would be an
   * unverified fix wearing a verified one's badge. Somebody closes it here,
   * where `canClose` applies.
   */
  build(row, mapping, world, now) {
    const get = (id: string) => cellFor(row, mapping, id);
    const today = now.toISOString().slice(0, 10);

    return {
      id: newFindingId(get("title")),
      title: get("title"),
      severity: coerceWord<Finding["severity"]>(get("severity"), SEVERITY_WORDS, "medium"),
      status: "open",
      source: coerceWord<Finding["source"]>(get("source"), SOURCE_WORDS, "self_identified"),
      raisedBy: get("raisedBy"),
      raisedAt: isoDay(get("raisedAt")) ?? today,
      dueAt: isoDay(get("dueAt")) ?? today,
      ownerId: matchPerson(get("owner"), world) ?? "",
      systemId: matchSystem(get("system"), world),
      controlId: null,
      summary: get("summary"),
      rootCause: null,
      correctiveAction: null,
      verifiedById: null,
      verifiedAt: null,
      verificationNote: null,
      closedAt: null,
    };
  },
};
