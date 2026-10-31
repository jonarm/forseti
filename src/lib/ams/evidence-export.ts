/**
 * What a piece of evidence looks like in a file.
 *
 * The evidence register's column catalogue. See `export-format.ts` for how a
 * catalogue becomes a file and `record-kinds.ts` for which catalogue belongs to
 * which register.
 *
 * **What a document is offered as proof of is the point of the export.** An
 * evidence register read on its own is a filing cabinet; read beside the
 * control library it is the answer to "show me what backs clause A.6". So the
 * linked controls and systems are columns, by reference rather than by title,
 * because the useful thing to do with this file is join it back.
 *
 * **Expiry is stated, not left to arithmetic.** A certificate with a date in the
 * past is worthless and a certificate expiring in three weeks is a task; both
 * are invisible if the file only carries the date and expects the reader to
 * compare it to today in their head.
 */
import { EVIDENCE_TYPE, VERIFICATION, formatDate, isOverdue, utcToday } from "./labels";
import type { ExportColumn } from "./export-format";
import type { Evidence } from "./types";

/** Days until a document expires, or null when it never does. */
function daysToExpiry(evidence: Evidence): number | null {
  if (!evidence.expiresAt) return null;
  return Math.round(
    (new Date(evidence.expiresAt).getTime() - new Date(utcToday()).getTime()) / 86_400_000,
  );
}

export const EVIDENCE_COLUMNS: ExportColumn<Evidence>[] = [
  { id: "title", label: "Document", group: "Register", resolve: (e) => e.title },
  {
    id: "type",
    label: "Type",
    group: "Register",
    resolve: (e) => EVIDENCE_TYPE[e.type] ?? e.type,
  },
  {
    id: "owner",
    label: "Owner",
    group: "Register",
    resolve: (e, ws) => (e.ownerId ? ws.personById(e.ownerId).name : "Unassigned"),
  },
  {
    id: "source",
    label: "Source",
    group: "Register",
    /* Where it came from — a vendor's portal, an internal system, an auditor.
     * The first thing anybody asks when a document's provenance matters. */
    resolve: (e) => e.source,
  },
  {
    id: "verificationState",
    label: "Verification",
    group: "Governance",
    resolve: (e) => VERIFICATION[e.verificationState]?.label ?? e.verificationState,
  },
  {
    id: "collectedAt",
    label: "Collected",
    group: "Governance",
    resolve: (e) => formatDate(e.collectedAt),
  },
  {
    id: "expiresAt",
    label: "Expires",
    group: "Governance",
    // "Does not expire" rather than blank: a policy with no expiry is a
    // deliberate fact about the document, not a field somebody forgot.
    resolve: (e) => (e.expiresAt ? formatDate(e.expiresAt) : "Does not expire"),
  },
  {
    id: "expired",
    label: "Expired",
    group: "Governance",
    resolve: (e) =>
      e.expiresAt && isOverdue(e.expiresAt) ? "Yes" : "No",
  },
  {
    id: "daysToExpiry",
    label: "Days to expiry",
    group: "Governance",
    /* Negative once it has lapsed, which is the useful sort order: the most
     * overdue document ends up at the top of the column rather than mixed in
     * with the ones that never expire. */
    resolve: (e) => daysToExpiry(e) ?? "",
  },
  {
    id: "controlCount",
    label: "Controls backed",
    group: "Governance",
    /* A document backing nothing is not evidence yet — it is a file somebody
     * uploaded. Counting it is how that shows up in a spreadsheet. */
    resolve: (e) => e.linkedControlIds.length,
  },
  {
    id: "controls",
    label: "Controls",
    group: "Governance",
    // By reference rather than title: the point of this column is joining the
    // file back to the control library, and a title cannot be looked up.
    resolve: (e) => e.linkedControlIds.join("; "),
  },
  {
    id: "systems",
    label: "Systems",
    group: "Governance",
    /* Empty means it applies to every system it is claimed against rather than
     * to none — the store's rule for an unscoped document, and it has to
     * survive into the file rather than reading as a gap. */
    resolve: (e, ws) =>
      e.linkedSystemIds.length === 0
        ? "All systems"
        : e.linkedSystemIds
            .map((id) => ws.systemById(id)?.name ?? id)
            .join("; "),
  },
  {
    id: "filename",
    label: "File",
    group: "Record",
    // "Nothing attached" is the finding: a register row claiming proof exists
    // with no document behind it is the thing an auditor samples for.
    resolve: (e) => e.file?.name ?? "Nothing attached",
  },
  {
    id: "fileKind",
    label: "File type",
    group: "Record",
    resolve: (e) => e.file?.mime ?? "",
  },
  {
    id: "fileSizeKb",
    label: "Size (KB)",
    group: "Record",
    resolve: (e) => e.file?.sizeKb ?? "",
  },
  { id: "id", label: "Evidence ID", group: "Record", resolve: (e) => e.id },
];

/** Ticked when the dialog opens: what the register itself shows. */
export const DEFAULT_EVIDENCE_COLUMNS: string[] = [
  "title",
  "type",
  "owner",
  "verificationState",
  "collectedAt",
  "expiresAt",
  "expired",
  "controlCount",
];
