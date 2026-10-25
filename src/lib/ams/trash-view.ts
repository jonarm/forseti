/**
 * What the trash shows, across every register.
 *
 * Eight tables carry tombstones and each holds a different kind of record, so
 * the screen needs one shape it can render without knowing which. That shape is
 * deliberately thin: an id, something to call it, when it went, who removed it,
 * and how long is left. Anything more would be eight column layouts, and a
 * trash is not a place anybody reads records — it is a place they recognise one
 * and decide whether to bring it back.
 *
 * `daysLeft` is derived here from `deletedAt` and the retention window, never
 * stored, and computed against one instant passed in so every row on the page
 * counts from the same moment.
 */
import { daysUntilPurge } from "./trash";
import type { RecordKind } from "./record-kinds";

export interface TrashItem {
  kind: RecordKind;
  id: string;
  /** What to call it: a name, a title, a filename, a reference. */
  label: string;
  /** A second line, where the register has one worth showing. */
  detail: string;
  deletedAt: string;
  deletedBy: string | null;
  daysLeft: number;
}

/**
 * What to call a removed record.
 *
 * Registers name their rows differently and the trash has to show all of them
 * in one list. Falling back to the id is honest rather than blank: it is what
 * somebody would see in the URL, and a row labelled with nothing is a row they
 * cannot decide about.
 */
function labelOf(row: Record<string, unknown>): string {
  for (const field of ["name", "title", "reference", "filename"]) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  const id = row.id;
  return typeof id === "string" ? id : "(unnamed record)";
}

/**
 * The second line, where one helps.
 *
 * An assessment has no name at all — it is "the assessment for X" — so its
 * detail is doing the work its label cannot. A questionnaire's requester and a
 * document's type are the next thing somebody looks at when deciding whether a
 * removal was a mistake.
 */
function detailOf(kind: RecordKind, row: Record<string, unknown>): string {
  const text = (field: string) => {
    const value = row[field];
    return typeof value === "string" ? value : "";
  };

  switch (kind) {
    case "system":
      return text("vendor");
    /* The business unit, not the status. Two teams routinely record a use case
     * with near enough the same name against the same tool, and the unit is what
     * tells somebody deciding on a restore which of them this was. */
    case "useCase":
      return text("businessUnit");
    case "risk":
    case "finding":
      return text("status");
    case "evidence":
      return text("source");
    case "assessment":
      return text("status");
    case "questionnaire":
      return text("requester");
    case "intake":
      return text("status");
    default:
      return "";
  }
}

/** One register's tombstones, in the shape the trash renders. */
export function toTrashItems(
  kind: RecordKind,
  rows: readonly { id: string; deletedAt: string; deletedBy: string | null }[],
  now: Date,
): TrashItem[] {
  return rows.map((row) => {
    const record = row as unknown as Record<string, unknown>;
    return {
      kind,
      id: row.id,
      label: labelOf(record),
      detail: detailOf(kind, record),
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
      daysLeft: daysUntilPurge(row.deletedAt, now),
    };
  });
}
