/**
 * What an intake request looks like in a file.
 *
 * The queue is the record that somebody asked permission, so the export is
 * about the *asking* and the answering: who wanted what, what the rules
 * recommended, what a reviewer decided, and how long it took. The submission's
 * origin-specific answers are deliberately not columns — they differ per
 * question set, so a column per field would be a file whose shape changes with
 * its contents, the same reason assessment answers are absent from theirs.
 *
 * **The override is the column worth having.** A reviewer who departs from the
 * triage recommendation has to say why, and a register that carried the
 * decision without carrying whether it went against the rules would hide the
 * only judgement in the record.
 */
import { ORIGIN, formatDate } from "./labels";
import { REQUEST_STATUS, daysWaiting } from "./fixtures/requests";
import type { ExportColumn } from "./export-format";
import type { IntakeRequest } from "./types";

const REVIEW_TYPE: Record<string, string> = {
  endorsement: "Endorsement",
  noting: "Noting",
};

const DECISION: Record<string, string> = {
  endorse: "Endorsed",
  note: "Noted",
  reject: "Rejected",
  more_info: "More information needed",
};

const tri = (value: boolean | null) =>
  value === null ? "Not answered" : value ? "Yes" : "No";

export const INTAKE_COLUMNS: ExportColumn<IntakeRequest>[] = [
  {
    id: "reference",
    label: "Reference",
    group: "Register",
    /* What people quote in an email, and the reason a removed request keeps
     * hold of it — a reference must never later belong to a different one. */
    resolve: (r) => r.reference,
  },
  {
    id: "name",
    label: "What was asked for",
    group: "Register",
    resolve: (r) => r.submission.name,
  },
  {
    id: "vendor",
    label: "Vendor",
    group: "Register",
    resolve: (r) => r.submission.vendor,
  },
  {
    id: "businessUnit",
    label: "Business unit",
    group: "Register",
    resolve: (r) => r.submission.businessUnit,
  },
  {
    id: "origin",
    label: "Origin",
    group: "Register",
    // Null is a real state here: the requester was not sure, and the reviewer
    // has to establish it. "Not stated" says that; a blank would not.
    resolve: (r) => (r.submission.origin ? ORIGIN[r.submission.origin].label : "Not stated"),
  },
  {
    id: "isGenAi",
    label: "GenAI",
    group: "Register",
    resolve: (r) => tri(r.submission.isGenAi),
  },
  {
    id: "submittedBy",
    label: "Submitted by",
    group: "Register",
    resolve: (r, ws) =>
      r.submittedById ? ws.personById(r.submittedById).name : "Unattributed",
  },
  {
    id: "submittedAt",
    label: "Submitted",
    group: "Register",
    resolve: (r) => formatDate(r.submittedAt),
  },
  {
    id: "status",
    label: "Status",
    group: "Governance",
    resolve: (r) => REQUEST_STATUS[r.status]?.label ?? r.status,
  },
  {
    id: "daysWaiting",
    label: "Days waiting",
    group: "Governance",
    /* Through the same function the queue's column uses, so a spreadsheet
     * cannot disagree with the screen about what is stale. */
    resolve: (r) => daysWaiting(r),
  },
  {
    id: "reviewType",
    label: "Review type",
    group: "Governance",
    resolve: (r) => (r.reviewType ? (REVIEW_TYPE[r.reviewType] ?? r.reviewType) : ""),
  },
  {
    id: "decision",
    label: "Decision",
    group: "Governance",
    // "Not yet decided" rather than blank — the queue's whole purpose is the
    // difference between undecided and decided-and-recorded.
    resolve: (r) =>
      r.decision ? (DECISION[r.decision] ?? r.decision) : "Not yet decided",
  },
  {
    id: "decidedBy",
    label: "Decided by",
    group: "Governance",
    resolve: (r, ws) => (r.decidedById ? ws.personById(r.decidedById).name : ""),
  },
  {
    id: "decidedAt",
    label: "Decided",
    group: "Governance",
    resolve: (r) => (r.decidedAt ? formatDate(r.decidedAt) : ""),
  },
  {
    id: "overridden",
    label: "Went against the recommendation",
    group: "Governance",
    /* The only judgement in the record. A file carrying the decision without
     * this would hide it. */
    resolve: (r) => (r.overrideJustification ? "Yes" : "No"),
  },
  {
    id: "overrideJustification",
    label: "Why it went against it",
    group: "Governance",
    resolve: (r) => r.overrideJustification ?? "",
  },
  {
    id: "facesCustomers",
    label: "Faces customers",
    group: "Deployment",
    resolve: (r) => tri(r.submission.facesCustomers),
  },
  {
    id: "informsDecisionsAboutPeople",
    label: "Informs decisions about people",
    group: "Deployment",
    /* The two answers that carry most of the regulatory weight, and the two a
     * requester is most likely to have got wrong. */
    resolve: (r) => tri(r.submission.informsDecisionsAboutPeople),
  },
  {
    id: "description",
    label: "Description",
    group: "Record",
    resolve: (r) => r.submission.description,
  },
  {
    id: "comments",
    label: "Reviewer comments",
    group: "Record",
    resolve: (r) => r.comments,
  },
  {
    id: "createdSystemId",
    label: "Became system",
    group: "Record",
    // Points outward at the inventory. Blank means the request never produced a
    // row — which for a rejected request is correct and for an endorsed one is
    // a gap somebody should chase.
    resolve: (r, ws) =>
      r.createdSystemId
        ? (ws.systemById(r.createdSystemId)?.name ?? r.createdSystemId)
        : "",
  },
  { id: "id", label: "Request ID", group: "Record", resolve: (r) => r.id },
];

/** Ticked when the dialog opens: what the queue itself shows. */
export const DEFAULT_INTAKE_COLUMNS: string[] = [
  "reference",
  "name",
  "businessUnit",
  "origin",
  "submittedBy",
  "status",
  "daysWaiting",
  "decision",
];
