/**
 * What an AI system looks like in a file.
 *
 * The inventory's column catalogue and nothing else. How a catalogue becomes a
 * CSV, a workbook or a printable page lives in `export-format.ts`, which knows
 * nothing about systems; which catalogue belongs to which register lives in
 * `record-kinds.ts`. This file only answers "what can you put in a column, and
 * what goes in it".
 *
 * **The register is wider than the table.** The inventory shows thirteen
 * columns because that is what fits on a line somebody scans; an export is read
 * in Excel by somebody building a report, and the fields they want — data
 * residency, the DPA, whether the vendor trains on customer data — are on the
 * profile rather than the list. So the catalogue offers all of it and the
 * defaults are the table's columns, which is the shape people expect back.
 *
 * Nothing here is stored. Coverage and use-case counts are derived through the
 * same `Workspace` accessors the screen uses, so an exported figure and the one
 * on the row it came from cannot disagree.
 */
import {
  ASSESSMENT_STATUS,
  CHARACTERISTIC,
  CONTRACT_TYPE,
  DATA_CATEGORY,
  DEPLOYMENT,
  DISCOVERED_VIA,
  LIFECYCLE,
  ORIGIN,
  RISK_TIER,
} from "./labels";
import type { ExportColumn } from "./export-format";
import type { AISystem } from "./types";

const list = (values: readonly string[]) => values.join("; ");
const yesNo = (value: boolean) => (value ? "Yes" : "No");

/**
 * Every column the inventory export can carry, in the order a file lays them
 * out.
 *
 * Order matters and is deliberate: the register's identifying columns first,
 * then what governance thinks of each system, then how it runs, then who sold
 * it. A person picking six columns still gets them in a sensible sequence
 * because the file follows this list rather than the order they ticked — an
 * export whose columns arrive in click order is one nobody can diff against
 * last month's.
 */
export const SYSTEM_COLUMNS: ExportColumn<AISystem>[] = [
  {
    id: "name",
    label: "System name",
    group: "Register",
    resolve: (s) => s.name,
  },
  { id: "vendor", label: "Vendor", group: "Register", resolve: (s) => s.vendor },
  {
    id: "origin",
    label: "Origin",
    group: "Register",
    resolve: (s) => ORIGIN[s.origin].label,
  },
  {
    id: "isGenAi",
    label: "GenAI",
    group: "Register",
    resolve: (s) => yesNo(s.isGenAi),
  },
  {
    id: "businessUnit",
    label: "Business unit",
    group: "Register",
    resolve: (s) => s.businessUnit,
  },
  {
    id: "owner",
    label: "Owner",
    group: "Register",
    // Unassigned rather than blank: an empty cell reads as "we did not export
    // this", and an unowned system is a finding, not a gap in the file.
    resolve: (s, ws) => (s.ownerId ? ws.personById(s.ownerId).name : "Unassigned"),
  },
  {
    id: "lifecycleStage",
    label: "Lifecycle stage",
    group: "Register",
    resolve: (s) => LIFECYCLE[s.lifecycleStage].label,
  },
  {
    id: "riskTier",
    label: "Risk tier",
    group: "Governance",
    resolve: (s) => RISK_TIER[s.riskTier].label,
  },
  {
    id: "assessmentStatus",
    label: "Assessment",
    group: "Governance",
    resolve: (s) => ASSESSMENT_STATUS[s.assessmentStatus].label,
  },
  {
    id: "useCases",
    /* Named for what it counts. A use case reaches as many systems as
     * implement it, so summing this column down a spreadsheet overshoots the
     * use case register's own total — and a column labelled "Use cases" invites
     * exactly that addition from somebody who never saw this file. */
    label: "Use cases reaching",
    group: "Governance",
    resolve: (s, ws) => ws.getUseCasesForSystem(s.id).length,
  },
  {
    id: "coverage",
    label: "ISO 42001 coverage (%)",
    group: "Governance",
    // Derived through the same accessor the column on screen uses, so the file
    // and the row it came from cannot disagree.
    resolve: (s, ws) => ws.coverageForSystem(s.id).percent,
  },
  {
    id: "coverageClaimed",
    label: "Controls claimed",
    group: "Governance",
    resolve: (s, ws) => ws.coverageForSystem(s.id).claimed,
  },
  {
    id: "coverageEvidenced",
    label: "Controls evidenced",
    group: "Governance",
    resolve: (s, ws) => ws.coverageForSystem(s.id).evidenced,
  },
  {
    id: "nextReviewDate",
    label: "Next review",
    group: "Governance",
    resolve: (s) => s.nextReviewDate,
  },
  {
    id: "purpose",
    label: "Purpose",
    group: "Deployment",
    resolve: (s) => s.purpose,
  },
  {
    id: "deploymentModel",
    label: "Deployment model",
    group: "Deployment",
    resolve: (s) => DEPLOYMENT[s.deploymentModel],
  },
  {
    id: "hostingRegions",
    label: "Hosting regions",
    group: "Deployment",
    resolve: (s) => list(s.hostingRegions),
  },
  {
    id: "dataResidency",
    label: "Data residency",
    group: "Deployment",
    resolve: (s) => s.dataResidency,
  },
  {
    id: "userGroups",
    label: "User groups",
    group: "Deployment",
    resolve: (s) => list(s.userGroups),
  },
  {
    id: "approxUsers",
    label: "Users",
    group: "Deployment",
    resolve: (s) => s.approxUsers,
  },
  {
    id: "dataCategories",
    label: "Data categories",
    group: "Deployment",
    resolve: (s) => list(s.dataCategories.map((c) => DATA_CATEGORY[c].label)),
  },
  {
    id: "characteristics",
    label: "AI characteristics",
    group: "Deployment",
    resolve: (s) => list(s.characteristics.map((c) => CHARACTERISTIC[c])),
  },
  {
    id: "modelProvider",
    label: "Model provider",
    group: "Vendor",
    resolve: (s) => s.vendorDetail.modelProvider ?? "",
  },
  {
    id: "contractType",
    label: "Contract type",
    group: "Vendor",
    resolve: (s) => CONTRACT_TYPE[s.vendorDetail.contractType] ?? s.vendorDetail.contractType,
  },
  {
    id: "dataProcessingAgreement",
    label: "DPA in place",
    group: "Vendor",
    resolve: (s) => yesNo(s.vendorDetail.dataProcessingAgreement),
  },
  {
    id: "trainsOnCustomerData",
    label: "Trains on our data",
    group: "Vendor",
    resolve: (s) => yesNo(s.vendorDetail.trainsOnCustomerData),
  },
  {
    id: "certifications",
    label: "Certifications",
    group: "Vendor",
    resolve: (s) => list(s.vendorDetail.certifications),
  },
  {
    id: "subProcessors",
    label: "Sub-processors",
    group: "Vendor",
    resolve: (s) => list(s.vendorDetail.subProcessors),
  },
  {
    id: "renewalDate",
    label: "Renewal date",
    group: "Vendor",
    resolve: (s) => s.vendorDetail.renewalDate ?? "",
  },
  {
    id: "id",
    label: "System ID",
    group: "Record",
    resolve: (s) => s.id,
  },
  {
    id: "registeredAt",
    label: "Registered",
    group: "Record",
    resolve: (s) => s.registeredAt,
  },
  {
    id: "discoveredVia",
    label: "How it was found",
    group: "Record",
    // Null means somebody registered it by hand, which is a fact worth stating
    // rather than an absence — the whole point of the column is shadow AI.
    resolve: (s) =>
      s.discoveredVia ? (DISCOVERED_VIA[s.discoveredVia] ?? s.discoveredVia) : "Registered by hand",
  },
];



/**
 * What is ticked when the dialog opens: the columns the table itself shows.
 *
 * The file somebody gets by pressing Export without thinking should be the list
 * they were looking at. Everything else is there for the person who came for a
 * particular field and knows it.
 */
export const DEFAULT_SYSTEM_COLUMNS: string[] = [
  "name",
  "vendor",
  "origin",
  "isGenAi",
  "businessUnit",
  "owner",
  "lifecycleStage",
  "riskTier",
  "assessmentStatus",
  "useCases",
  "approxUsers",
  "coverage",
  "nextReviewDate",
];
