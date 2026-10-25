/**
 * What a risk looks like in a file.
 *
 * The risk register's column catalogue and nothing else — the same shape the
 * inventory's has, read by the same picker and the same three writers. See
 * `export-format.ts` for how a catalogue becomes a file and `record-kinds.ts`
 * for which catalogue belongs to which register.
 *
 * **Scores are computed, not stored.** `riskScore` is the same function the
 * register sorts by and the heat map colours by, so a spreadsheet cannot
 * disagree with the screen it came from. Both the inherent and the residual
 * score are offered because the difference between them *is* the treatment's
 * claim, and a register that exported only one of them could not be checked.
 *
 * **The unaccepted residue is a column.** "Who accepted what remains" is the
 * question this register exists to answer and the one most often unanswered, so
 * it exports as a named absence rather than an empty cell — an auditor
 * filtering a spreadsheet for blanks finds nothing; one filtering for "Nobody"
 * finds the gap.
 */
import { formatDate } from "./labels";
import { RISK_STATUS, TREATMENT, riskBand } from "./risk-scale";
/* The same scoring function the register sorts by and the heat map colours by.
 * It lives in `fixtures/registers.ts` for historical reasons — `audit-pack.ts`
 * reaches for it there too — and importing it rather than restating likelihood
 * times impact is the point: a file that scored differently from the screen it
 * came from would be wrong in the least visible way. */
import { riskScore } from "./fixtures/registers";
import type { ExportColumn } from "./export-format";
import type { Risk } from "./types";

const scoreOf = (likelihood: number, impact: number) => riskScore(likelihood, impact);

export const RISK_COLUMNS: ExportColumn<Risk>[] = [
  { id: "title", label: "Risk", group: "Register", resolve: (r) => r.title },
  {
    id: "system",
    label: "System",
    group: "Register",
    /* A risk with no system is an organisation-level risk, not an orphan — the
     * store's rule, and it has to survive into the file. */
    resolve: (r, ws) =>
      r.systemId ? (ws.systemById(r.systemId)?.name ?? r.systemId) : "Organisation-wide",
  },
  {
    id: "useCase",
    label: "Use case",
    group: "Register",
    resolve: (r, ws) => (r.useCaseId ? (ws.getUseCase(r.useCaseId)?.name ?? r.useCaseId) : ""),
  },
  {
    id: "owner",
    label: "Owner",
    group: "Register",
    resolve: (r, ws) => (r.ownerId ? ws.personById(r.ownerId).name : "Unassigned"),
  },
  {
    id: "status",
    label: "Status",
    group: "Governance",
    resolve: (r) => RISK_STATUS[r.status]?.label ?? r.status,
  },
  {
    id: "treatment",
    label: "Treatment",
    group: "Governance",
    resolve: (r) => TREATMENT[r.treatment]?.label ?? r.treatment,
  },
  {
    id: "treatmentSummary",
    label: "Treatment summary",
    group: "Governance",
    resolve: (r) => r.treatmentSummary,
  },
  {
    id: "inherentLikelihood",
    label: "Inherent likelihood",
    group: "Governance",
    resolve: (r) => r.inherentLikelihood,
  },
  {
    id: "inherentImpact",
    label: "Inherent impact",
    group: "Governance",
    resolve: (r) => r.inherentImpact,
  },
  {
    id: "inherentScore",
    label: "Inherent score",
    group: "Governance",
    resolve: (r) => scoreOf(r.inherentLikelihood, r.inherentImpact),
  },
  {
    id: "residualLikelihood",
    label: "Residual likelihood",
    group: "Governance",
    resolve: (r) => r.residualLikelihood,
  },
  {
    id: "residualImpact",
    label: "Residual impact",
    group: "Governance",
    resolve: (r) => r.residualImpact,
  },
  {
    id: "residualScore",
    label: "Residual score",
    group: "Governance",
    resolve: (r) => scoreOf(r.residualLikelihood, r.residualImpact),
  },
  {
    id: "residualBand",
    label: "Residual band",
    group: "Governance",
    // The word the screen shows beside the number, so a reader who does not
    // know the scale still knows whether 12 is bad.
    resolve: (r) => riskBand(scoreOf(r.residualLikelihood, r.residualImpact)).label,
  },
  {
    id: "acceptedBy",
    label: "Residue accepted by",
    group: "Governance",
    resolve: (r, ws) =>
      r.acceptedById ? ws.personById(r.acceptedById).name : "Nobody",
  },
  {
    id: "acceptedAt",
    label: "Accepted on",
    group: "Governance",
    resolve: (r) => (r.acceptedAt ? formatDate(r.acceptedAt) : ""),
  },
  {
    id: "controls",
    label: "Controls relied on",
    group: "Governance",
    /* The treatment's evidence, by reference. Titles would be more readable and
     * would make the column unusable for its actual purpose, which is joining
     * this file back to the control library. */
    resolve: (r) => r.controlIds.join("; "),
  },
  {
    id: "openFindings",
    label: "Open findings against the treatment",
    group: "Governance",
    /* Derived through the same accessor the register's warning triangle uses. A
     * treated risk with an open finding against its treatment is not treated,
     * and that is the single most useful thing this file can carry. */
    resolve: (r, ws) => ws.underminingFindings(r.id).length,
  },
  { id: "id", label: "Risk ID", group: "Record", resolve: (r) => r.id },
];

/**
 * Ticked when the dialog opens: what the register itself shows.
 *
 * The residual score and its band come first among the numbers because that is
 * the column the table sorts by — the file somebody gets without thinking
 * should be the list they were looking at, in the order they were looking at it.
 */
export const DEFAULT_RISK_COLUMNS: string[] = [
  "title",
  "system",
  "owner",
  "status",
  "treatment",
  "residualScore",
  "residualBand",
  "acceptedBy",
  "openFindings",
];
