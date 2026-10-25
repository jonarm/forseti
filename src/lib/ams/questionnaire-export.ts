/**
 * What a questionnaire looks like in a file.
 *
 * **The answers are not in it, and cannot be.** Questionnaire answers are
 * ephemeral runtime state in this product — drafted, read, sent, never written
 * to a table — so there is nothing to export even if a column asked for it. The
 * register is a queue of promises made to people outside the company, and this
 * file is that queue: who asked, what they asked about, when it is owed and
 * whether anyone has started.
 *
 * That constraint makes the columns more useful rather than less. A file of
 * answers would be a snapshot of drafts nobody had approved; a file of *state*
 * is what somebody takes into a Monday morning and works down.
 */
import { formatDate, isOverdue } from "./labels";
import type { ExportColumn } from "./export-format";
import type { Questionnaire } from "./types";

/** The four states a questionnaire moves through, in the words the screen uses. */
const STATUS: Record<Questionnaire["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  in_review: "In review",
  submitted: "Submitted",
};

const REQUESTER_TYPE: Record<string, string> = {
  customer: "Customer",
  prospect: "Prospect",
  regulator: "Regulator",
  partner: "Partner",
  auditor: "Auditor",
};

export const QUESTIONNAIRE_COLUMNS: ExportColumn<Questionnaire>[] = [
  { id: "title", label: "Questionnaire", group: "Register", resolve: (q) => q.title },
  {
    id: "requester",
    label: "Requester",
    group: "Register",
    /* Who is waiting. The single most useful column, because a questionnaire's
     * cost is somebody else's patience. */
    resolve: (q) => q.requester,
  },
  {
    id: "requesterType",
    label: "Requester type",
    group: "Register",
    // A regulator's request and a prospect's are the same shape and not the
    // same urgency; the mix is worth being able to count.
    resolve: (q) => REQUESTER_TYPE[q.requesterType] ?? q.requesterType,
  },
  {
    id: "owner",
    label: "Owner",
    group: "Register",
    resolve: (q, ws) => (q.ownerId ? ws.personById(q.ownerId).name : "Unassigned"),
  },
  {
    id: "status",
    label: "Status",
    group: "Governance",
    resolve: (q) => STATUS[q.status] ?? q.status,
  },
  {
    id: "receivedAt",
    label: "Received",
    group: "Governance",
    resolve: (q) => formatDate(q.receivedAt),
  },
  {
    id: "dueAt",
    label: "Due",
    group: "Governance",
    resolve: (q) => formatDate(q.dueAt),
  },
  {
    id: "overdue",
    label: "Overdue",
    group: "Governance",
    // A submitted questionnaire is finished, whatever its due date says.
    resolve: (q) => (q.status !== "submitted" && isOverdue(q.dueAt) ? "Yes" : "No"),
  },
  {
    id: "questionCount",
    label: "Questions",
    group: "Governance",
    /* How much work is in it. Two questionnaires due the same day are not the
     * same commitment if one has nine questions and the other two hundred. */
    resolve: (q) => q.questions.length,
  },
  {
    id: "unsupportedCount",
    label: "Questions with nothing to cite",
    group: "Governance",
    /* The questions that have no control, policy or evidence behind them — the
     * ones somebody will have to answer from memory, or decline. Derived from
     * the same three id arrays the workbench reads, so the file agrees with the
     * screen about which questions are the hard ones. */
    resolve: (q) =>
      q.questions.filter(
        (question) =>
          question.controlIds.length === 0 &&
          question.policyIds.length === 0 &&
          question.evidenceIds.length === 0,
      ).length,
  },
  { id: "note", label: "Note", group: "Record", resolve: (q) => q.note },
  { id: "id", label: "Questionnaire ID", group: "Record", resolve: (q) => q.id },
];

/** Ticked when the dialog opens: what the register itself shows. */
export const DEFAULT_QUESTIONNAIRE_COLUMNS: string[] = [
  "title",
  "requester",
  "requesterType",
  "owner",
  "status",
  "dueAt",
  "overdue",
  "questionCount",
];
