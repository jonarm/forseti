/**
 * What a finding looks like in a file.
 *
 * The findings register's column catalogue. See `export-format.ts` for how a
 * catalogue becomes a file and `record-kinds.ts` for which catalogue belongs to
 * which register.
 *
 * **The closure rule is a column.** A finding closes only with a root cause, a
 * corrective action and a dated verification by somebody other than its owner —
 * that rule lives in `canClose`, and the export runs the same function rather
 * than restating it. "What is blocking this from closing" is the single most
 * useful thing this file can carry into a meeting, and a spreadsheet that
 * computed it differently from the screen would be worse than one that omitted
 * it.
 *
 * **Overdue is stated, not left to arithmetic.** A due date is a date; whether
 * it has passed is the thing somebody sorts by, and asking a reader to compare
 * two columns in their head is how an overdue finding gets missed in a list of
 * forty.
 */
import {
  FINDING_SEVERITY,
  FINDING_SOURCE,
  FINDING_STATUS,
  canClose,
  findingAge,
} from "./fixtures/registers";
import { formatDate, isOverdue } from "./labels";
import type { ExportColumn } from "./export-format";
import type { Finding } from "./types";

export const FINDING_COLUMNS: ExportColumn<Finding>[] = [
  { id: "title", label: "Finding", group: "Register", resolve: (f) => f.title },
  {
    id: "severity",
    label: "Severity",
    group: "Register",
    resolve: (f) => FINDING_SEVERITY[f.severity]?.label ?? f.severity,
  },
  {
    id: "status",
    label: "Status",
    group: "Register",
    resolve: (f) => FINDING_STATUS[f.status]?.label ?? f.status,
  },
  {
    id: "source",
    label: "Source",
    group: "Register",
    /* The mix of sources is a maturity signal in its own right — a register
     * where everything came from an external auditor is a management system
     * that never finds its own problems. The column is what lets somebody
     * count that outside the product. */
    resolve: (f) => FINDING_SOURCE[f.source]?.label ?? f.source,
  },
  {
    id: "raisedBy",
    label: "Raised by",
    group: "Register",
    resolve: (f) => f.raisedBy,
  },
  {
    id: "system",
    label: "System",
    group: "Register",
    resolve: (f, ws) =>
      f.systemId ? (ws.systemById(f.systemId)?.name ?? f.systemId) : "Organisation-wide",
  },
  {
    id: "control",
    label: "Control",
    group: "Register",
    resolve: (f, ws) =>
      f.controlId ? (ws.controlById(f.controlId)?.shortTitle ?? f.controlId) : "",
  },
  {
    id: "owner",
    label: "Owner",
    group: "Register",
    resolve: (f, ws) => (f.ownerId ? ws.personById(f.ownerId).name : "Unassigned"),
  },
  {
    id: "raisedAt",
    label: "Raised",
    group: "Governance",
    resolve: (f) => formatDate(f.raisedAt),
  },
  {
    id: "dueAt",
    label: "Due",
    group: "Governance",
    resolve: (f) => formatDate(f.dueAt),
  },
  {
    id: "overdue",
    label: "Overdue",
    group: "Governance",
    // Closed findings are not overdue, whatever their due date says — the work
    // is done, and flagging them would bury the ones that are not.
    resolve: (f) =>
      f.status !== "closed" && isOverdue(f.dueAt) ? "Yes" : "No",
  },
  {
    id: "ageDays",
    label: "Age (days)",
    group: "Governance",
    /* Days open, through the same function the register's age column uses. A
     * number rather than a date so a spreadsheet can sort and average it. */
    resolve: (f) => findingAge(f),
  },
  {
    id: "rootCause",
    label: "Root cause",
    group: "Governance",
    resolve: (f) => f.rootCause ?? "",
  },
  {
    id: "correctiveAction",
    label: "Corrective action",
    group: "Governance",
    resolve: (f) => f.correctiveAction ?? "",
  },
  {
    id: "verifiedBy",
    label: "Verified by",
    group: "Governance",
    /* Named absence, like the risk register's unaccepted residue: an auditor
     * filtering a spreadsheet for blanks finds nothing, one filtering for
     * "Not verified" finds every finding closed without a second pair of eyes. */
    resolve: (f, ws) =>
      f.verifiedById ? ws.personById(f.verifiedById).name : "Not verified",
  },
  {
    id: "verifiedAt",
    label: "Verified on",
    group: "Governance",
    resolve: (f) => (f.verifiedAt ? formatDate(f.verifiedAt) : ""),
  },
  {
    id: "blockingClosure",
    label: "Blocking closure",
    group: "Governance",
    /* The closure rule, run rather than restated. Empty for a finding that can
     * close — an empty cell here means "nothing in the way", which is the one
     * place in this catalogue where a blank is the useful answer. */
    resolve: (f) => (f.status === "closed" ? "" : canClose(f).reason),
  },
  {
    id: "closedAt",
    label: "Closed",
    group: "Governance",
    resolve: (f) => (f.closedAt ? formatDate(f.closedAt) : ""),
  },
  { id: "summary", label: "Summary", group: "Record", resolve: (f) => f.summary },
  { id: "id", label: "Finding ID", group: "Record", resolve: (f) => f.id },
];

/** Ticked when the dialog opens: what the register itself shows. */
export const DEFAULT_FINDING_COLUMNS: string[] = [
  "title",
  "severity",
  "status",
  "source",
  "system",
  "owner",
  "dueAt",
  "overdue",
  "verifiedBy",
];
