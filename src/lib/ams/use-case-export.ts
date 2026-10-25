/**
 * What a use case looks like in a file.
 *
 * The same shape every other register's catalogue has, read by the same picker
 * and the same three writers. See `export-format.ts` for how a catalogue becomes
 * a file and `record-kinds.ts` for which catalogue belongs to which register.
 *
 * **The two questions are columns, and they export as words.** "Faces
 * customers" and "informs decisions about people" are the two answers carrying
 * most of the regulatory weight, and a spreadsheet of `TRUE`/`FALSE` is a
 * spreadsheet nobody can filter meaningfully in a meeting. They come out as
 * "Yes"/"No" for the same reason `risk-export.ts` writes "Nobody" rather than
 * leaving the acceptor blank — an absence somebody can search for.
 *
 * **The assessment is a status, not an id.** It is derived from the assessment
 * that names this use case, so the column resolves through the workspace rather
 * than reading a stored field that could disagree. A use case with none exports
 * "Covered by system", which is the honest description of the position: a
 * defensible one for a low-risk use and a poor one for anything above it.
 */
import { ASSESSMENT_STATUS, DATA_CATEGORY, OVERSIGHT, RISK_TIER } from "./labels";
import { USE_CASE_STATUS } from "./labels";
import type { ExportColumn } from "./export-format";
import type { AIUseCase } from "./types";

const yesNo = (value: boolean) => (value ? "Yes" : "No");

export const USE_CASE_COLUMNS: ExportColumn<AIUseCase>[] = [
  { id: "name", label: "Use case", group: "Register", resolve: (u) => u.name },
  {
    id: "system",
    label: "System",
    group: "Register",
    /* A use case cannot be organisation-level — the create route refuses an
     * empty set and the unlink route refuses the last one — so an unresolved id
     * here is a broken row rather than a wide one, and the id itself is the most
     * useful thing to print about it.
     *
     * Several systems join with a semicolon rather than a comma: every writer
     * this feeds quotes a cell containing a comma, and a reader opening the CSV
     * in a spreadsheet then sees one column that looks like two. */
    resolve: (u, ws) =>
      u.systemIds.map((id) => ws.systemById(id)?.name ?? id).join("; "),
  },
  {
    id: "description",
    label: "Description",
    group: "Register",
    resolve: (u) => u.description,
  },
  {
    id: "businessUnit",
    label: "Business unit",
    group: "Register",
    resolve: (u) => u.businessUnit,
  },
  {
    id: "owner",
    label: "Owner",
    group: "Register",
    resolve: (u, ws) => (u.ownerId ? ws.personById(u.ownerId).name : "Unassigned"),
  },
  {
    id: "status",
    label: "Status",
    group: "Register",
    resolve: (u) => USE_CASE_STATUS[u.status]?.label ?? u.status,
  },
  {
    id: "riskTier",
    label: "Risk tier",
    group: "Governance",
    /* The purpose's own tier. This file exports the use case register, one
     * row per purpose — a column resolved per pairing would need a row per
     * pairing, which is a different export. */
    resolve: (u) => RISK_TIER[u.riskTier]?.label ?? u.riskTier,
  },
  {
    id: "oversight",
    label: "Human oversight",
    group: "Governance",
    resolve: (u) => OVERSIGHT[u.oversightLevel]?.label ?? u.oversightLevel,
  },
  {
    id: "oversightSummary",
    label: "Oversight summary",
    group: "Governance",
    resolve: (u) => u.oversightSummary,
  },
  {
    id: "facesCustomers",
    label: "Faces customers",
    group: "Governance",
    resolve: (u) => yesNo(u.facesCustomers),
  },
  {
    id: "informsDecisionsAboutPeople",
    label: "Informs decisions about people",
    group: "Governance",
    resolve: (u) => yesNo(u.informsDecisionsAboutPeople),
  },
  {
    id: "dataCategories",
    label: "Data touched",
    group: "Governance",
    resolve: (u) =>
      u.dataCategories.map((dc) => DATA_CATEGORY[dc]?.label ?? dc).join("; "),
  },
  {
    id: "assessment",
    label: "Impact assessment",
    group: "Governance",
    resolve: (u, ws) => {
      if (!u.assessmentId) return "Covered by system";
      const assessment = ws.assessmentById(u.assessmentId);
      return assessment
        ? (ASSESSMENT_STATUS[assessment.status]?.label ?? assessment.status)
        : "Covered by system";
    },
  },
  {
    id: "approxUsers",
    label: "Users",
    group: "Governance",
    resolve: (u) => u.approxUsers,
  },
  { id: "id", label: "Use case ID", group: "Record", resolve: (u) => u.id },
];

/**
 * Ticked when the dialog opens: what the register itself shows.
 *
 * Tier and oversight sit together because the pairing is the finding — a
 * high-risk use case with nobody watching the output is the row somebody
 * exporting this file is usually looking for.
 */
export const DEFAULT_USE_CASE_COLUMNS: string[] = [
  "name",
  "system",
  "businessUnit",
  "owner",
  "status",
  "riskTier",
  "oversight",
  "facesCustomers",
  "informsDecisionsAboutPeople",
];
