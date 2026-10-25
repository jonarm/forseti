/**
 * What an impact assessment looks like in a file.
 *
 * **The sign-off chain is the export.** An assessment's answers are a form
 * somebody filled in; the thing anybody outside the product wants to know is
 * how far it got and who put their name to it. So the columns are the chain —
 * which stage it is at, who is waiting on whom, and how many signatures are
 * actually against it — rather than the hundred answer fields, which differ per
 * template and would make a spreadsheet nobody can compare across systems.
 *
 * Answers are deliberately absent for that reason: the field set depends on the
 * template and on the system's origin, so a column per field would be a file
 * whose shape changes with its contents. The assessment's own page is where
 * answers are read.
 */
import { ASSESSMENT_STATUS, formatDate, isOverdue } from "./labels";
import type { ExportColumn } from "./export-format";
import type { AssessmentInstance, SignOffStep } from "./types";

const signOff = (a: AssessmentInstance): SignOffStep[] => a.signOff ?? [];

export const ASSESSMENT_COLUMNS: ExportColumn<AssessmentInstance>[] = [
  {
    id: "system",
    label: "System",
    group: "Register",
    /* The assessment's own id means nothing to a reader; the system it is about
     * is what they came for, so it leads. */
    resolve: (a, ws) => ws.systemById(a.systemId)?.name ?? a.systemId,
  },
  {
    id: "useCase",
    label: "Use case",
    group: "Register",
    // Blank means the assessment covers the system as a whole, which is a
    // different claim from covering one of its use cases.
    resolve: (a, ws) =>
      a.useCaseId ? (ws.getUseCase(a.useCaseId)?.name ?? a.useCaseId) : "Whole system",
  },
  {
    id: "status",
    label: "Status",
    group: "Governance",
    resolve: (a) => ASSESSMENT_STATUS[a.status]?.label ?? a.status,
  },
  {
    id: "templateId",
    label: "Template",
    group: "Register",
    resolve: (a) => a.templateId,
  },
  {
    id: "dueAt",
    label: "Due",
    group: "Governance",
    resolve: (a) => formatDate(a.dueAt),
  },
  {
    id: "overdue",
    label: "Overdue",
    group: "Governance",
    // An approved assessment is finished, whatever its due date says.
    resolve: (a) =>
      a.status !== "approved" && isOverdue(a.dueAt) ? "Yes" : "No",
  },
  {
    id: "currentStage",
    label: "Waiting on",
    group: "Governance",
    /* The one question a register of assessments exists to answer. "Nobody"
     * covers both ends — not started, and finished — and the status column
     * beside it says which. */
    resolve: (a, ws) => {
      const current = signOff(a).find((step) => step.state === "current");
      if (!current) return "Nobody";
      const who = current.assigneeId ? ws.personById(current.assigneeId).name : "Unassigned";
      return `${current.label} — ${who}`;
    },
  },
  {
    id: "signaturesComplete",
    label: "Signatures given",
    group: "Governance",
    resolve: (a) => signOff(a).filter((step) => step.state === "complete").length,
  },
  {
    id: "signaturesTotal",
    label: "Signatures required",
    group: "Governance",
    /* Given and required as two numbers rather than "2 of 4" in one cell,
     * because a spreadsheet can subtract two numbers and cannot subtract a
     * sentence. */
    resolve: (a) => signOff(a).length,
  },
  {
    id: "signedBy",
    label: "Signed by",
    group: "Governance",
    resolve: (a, ws) =>
      signOff(a)
        .filter((step) => step.state === "complete")
        .map((step) => {
          const who = step.assigneeId ? ws.personById(step.assigneeId).name : "Unassigned";
          return step.completedAt ? `${who} (${formatDate(step.completedAt)})` : who;
        })
        .join("; "),
  },
  {
    id: "outstandingStages",
    label: "Stages outstanding",
    group: "Governance",
    resolve: (a) =>
      signOff(a)
        .filter((step) => step.state !== "complete")
        .map((step) => step.label)
        .join("; "),
  },
  {
    id: "updatedAt",
    label: "Last updated",
    group: "Record",
    resolve: (a) => formatDate(a.updatedAt.slice(0, 10)),
  },
  { id: "id", label: "Assessment ID", group: "Record", resolve: (a) => a.id },
];

/** Ticked when the dialog opens: what the register itself shows. */
export const DEFAULT_ASSESSMENT_COLUMNS: string[] = [
  "system",
  "useCase",
  "status",
  "dueAt",
  "overdue",
  "currentStage",
  "signaturesComplete",
  "signaturesTotal",
];
