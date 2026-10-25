/**
 * The Statement of Applicability, as a join.
 *
 * One row per (framework, control). Add ISO 27001 tomorrow and the same control
 * gets a second row with its own applicability, its own justification and its
 * own owner — because the honest answer genuinely can differ: a control that is
 * out of scope for your AI management system may be squarely in scope for your
 * information security one. Fold these fields onto `FrameworkControl` and the
 * second framework has nowhere to put a different answer, and you end up
 * duplicating the control instead. That is the failure this shape prevents.
 *
 * The posture modelled here is **consumption-only**, which is what a mid-market
 * buyer actually looks like: they run fifteen AI systems and built two of them.
 * So the development controls come back N/A with a justification that names the
 * exception rather than waving it away — the internal demand forecasting model
 * means "we build nothing" would be a lie, and an auditor finds that lie in
 * about four minutes.
 *
 * `appliesToSystemIds` is what makes the inventory's ISO coverage column
 * derivable instead of invented: coverage for a system is the share of
 * applicable controls that claim it and carry evidence.
 */
import type { ControlApplicability } from "../types";

/**
 * The procured estate that has actually been through governance.
 *
 * Deliberately not every procured system. The three found through discovery —
 * the notetaker, the ChatGPT workspace, the contract review trial — are claimed
 * against nothing, so they read 0% and land in the attention list. That is the
 * accurate answer: nobody has claimed a single control against them, which is
 * exactly what "found in an expense report last week" means.
 */
const ALL_CONSUMED = [
  "sys-m365-copilot",
  "sys-copilot-studio",
  "sys-claim-triage-api",
  "sys-github-copilot",
  "sys-docsearch",
  "sys-translate",
  "sys-adcopy",
  "sys-invoice-ocr",
  "sys-talentscreen",
  "sys-churnlens",
];

const BUILT_IN_HOUSE = ["sys-demand-forecast", "sys-leadscore"];

/** The justification reused wherever a control only bites on systems we build. */
const CONSUMPTION_ONLY =
  "We procure AI systems rather than develop them, with one exception: the demand forecasting model built by Data & Analytics. That model is assessed under this control set separately, and the control is marked applicable there. For the procured estate the design and training obligations sit with the vendor, evidenced through the supplier assessment (A.10.3).";

const a = (
  controlId: string,
  applicability: ControlApplicability["applicability"],
  implementationStatus: ControlApplicability["implementationStatus"],
  justification: string,
  ownerId: string | null,
  linkedPolicyId: string | null,
  linkedEvidenceIds: string[],
  appliesToSystemIds: string[],
  lastReviewedAt: string | null,
): ControlApplicability => ({
  frameworkId: "iso-42001",
  controlId,
  applicability,
  justification,
  implementationStatus,
  ownerId,
  linkedPolicyId,
  linkedEvidenceIds,
  appliesToSystemIds,
  lastReviewedAt,
});

export const APPLICABILITY: ControlApplicability[] = [
  a("ctl-4-1", "yes", "implemented",
    "The management system covers every AI system used by the organisation, whether procured, integrated or built. The inventory is the scope statement.",
    "p-anders", "pol-ai-governance", ["ev-inventory-export"], [...ALL_CONSUMED, ...BUILT_IN_HOUSE], "2026-06-25"),
  a("ctl-4-2", "yes", "implemented",
    "Staff, customers, job applicants and our regulators are all affected by how we use AI. The stakeholder register names each and the obligation we owe them.",
    "p-anders", "pol-ai-governance", [], [], "2026-06-25"),
  a("ctl-4-3", "yes", "in_progress",
    "Intake, assessment, risk and findings connect as one process. The link from findings back into scheduled review is the part not yet demonstrable end to end.",
    "p-anders", "pol-ai-governance", [], [], "2026-06-25"),
  a("ctl-5-1", "yes", "implemented",
    "The AI Governance Forum meets quarterly, chaired by the CISO, with decisions minuted rather than papers noted.",
    "p-oyelaran", "pol-ai-governance", ["ev-governance-minutes"], [], "2026-06-25"),
  a("ctl-5-2", "yes", "implemented",
    "The AI Acceptable Use Policy is approved at version 2.1 and communicated firm-wide.",
    "p-anders", "pol-ai-use", ["ev-copilot-training"], [], "2026-03-12"),
  a("ctl-5-3", "yes", "implemented",
    "The governance policy names who may approve a system, who owns a risk and who can suspend a deployment.",
    "p-anders", "pol-ai-governance", [], [], "2026-01-28"),
  a("ctl-6-1", "yes", "implemented",
    "The impact assessment procedure defines the risk method, and every assessment follows it.",
    "p-anders", "pol-impact-assessment", ["ev-copilot-dpia"], ALL_CONSUMED, "2026-02-19"),
  a("ctl-6-2", "yes", "in_progress",
    "Risks are recorded with inherent rating, treatment and residual rating. Named acceptance of residual risk is inconsistent below the high tier.",
    "p-anders", "pol-ai-governance", [], [], "2026-06-25"),
  a("ctl-6-3", "yes", "in_progress",
    "Impact assessments are required before go-live. Two production systems predate the procedure and are being assessed retrospectively.",
    "p-anders", "pol-impact-assessment", ["ev-copilot-dpia", "ev-talentscreen-dpia"], ALL_CONSUMED, "2026-07-10"),
  a("ctl-6-4", "yes", "planned",
    "AI objectives are set for 2027 but not yet measurable in the form this control needs.",
    "p-anders", null, [], [], null),
  a("ctl-7-1", "yes", "in_progress",
    "Competence criteria exist for the governance roles. The system owners named in the inventory are not all covered yet.",
    "p-anders", null, ["ev-copilot-training"], [], "2026-05-30"),
  a("ctl-7-2", "yes", "implemented",
    "Acceptable-use training is mandatory for anyone with a licence for a generative tool, with completion tracked.",
    "p-anders", "pol-ai-use", ["ev-copilot-training"], ALL_CONSUMED, "2026-05-30"),
  a("ctl-7-3", "yes", "implemented",
    "Policies and procedures carry a version, an owner and a review date in the document register.",
    "p-larsen", "pol-ai-governance", [], [], "2026-04-02"),
  a("ctl-8-1", "yes", "implemented",
    "Intake decisions, assessments and approvals are all recorded and attributable.",
    "p-anders", "pol-ai-governance", ["ev-inventory-export"], ALL_CONSUMED, "2026-06-25"),
  a("ctl-9-1", "yes", "in_progress",
    "Coverage and overdue-review figures are produced monthly. Finding age is not yet tracked.",
    "p-anders", null, [], [], "2026-07-01"),
  a("ctl-9-2", "yes", "implemented",
    "Internal Audit reviewed the AI management system in May 2026 and raised four findings.",
    "p-anders", null, ["ev-internal-audit"], [], "2026-05-14"),
  a("ctl-9-3", "yes", "implemented",
    "Management review runs quarterly alongside the governance forum, with actions and owners recorded.",
    "p-oyelaran", "pol-ai-governance", ["ev-governance-minutes"], [], "2026-06-25"),
  a("ctl-10-1", "yes", "in_progress",
    "Findings carry a root cause and a corrective action. Dated verification before closure is newly introduced and not yet true of every closed finding.",
    "p-anders", null, ["ev-internal-audit"], [], "2026-06-25"),

  a("ctl-a2-2", "yes", "implemented",
    "The AI Acceptable Use Policy is in force and has already been used to refuse two requests and withdraw one tool.",
    "p-anders", "pol-ai-use", ["ev-copilot-training"], [], "2026-03-12"),
  a("ctl-a2-3", "yes", "implemented",
    "The AI policy references the data classification and security policies rather than restating them, and the three were reviewed together.",
    "p-anders", "pol-data-classification", [], [], "2026-03-12"),
  a("ctl-a2-4", "yes", "implemented",
    "Annual review cycle, plus a trigger for any material change in how AI is used. Last reviewed March 2026.",
    "p-anders", "pol-ai-use", [], [], "2026-03-12"),
  a("ctl-a3-2", "yes", "implemented",
    "Every system in the inventory has a named owner. Rows arriving through discovery are assigned within ten working days.",
    "p-anders", "pol-ai-governance", ["ev-inventory-export"], [...ALL_CONSUMED, ...BUILT_IN_HOUSE], "2026-08-01"),
  a("ctl-a3-3", "yes", "planned",
    "Concerns currently route through the general speak-up channel. An AI-specific route with a tracked log is planned for Q4.",
    "p-anders", null, [], [], null),
  a("ctl-a4-2", "yes", "in_progress",
    "Data, hosting and oversight are recorded per system. Tooling and compute dependencies are recorded only for the systems we built.",
    "p-devi", null, ["ev-copilot-tenant-config"], ALL_CONSUMED, "2026-06-18"),
  a("ctl-a4-3", "yes", "implemented",
    "Data categories are recorded against every system and checked against the vendor's own documentation during supplier assessment.",
    "p-marek", "pol-data-classification", ["ev-studio-agent-config", "ev-claim-prompt-retention"], ALL_CONSUMED, "2026-07-21"),
  a("ctl-a4-5", "yes", "implemented",
    "Hosting region, deployment model and the contractual basis for each residency claim are recorded per system.",
    "p-devi", null, ["ev-copilot-tenant-config"], ALL_CONSUMED, "2026-06-18"),
  a("ctl-a4-6", "yes", "in_progress",
    "Oversight roles are named per system. The honest count of reviewers is thin for the Copilot Studio agents, which is raised as a finding.",
    "p-anders", "pol-human-oversight", [], ALL_CONSUMED, "2026-07-10"),
  a("ctl-a5-2", "yes", "implemented",
    "The impact assessment procedure defines the trigger rules that decide which systems need one.",
    "p-anders", "pol-impact-assessment", [], [], "2026-02-19"),
  a("ctl-a5-3", "yes", "in_progress",
    "Completed assessments carry the full three-stage sign-off. Two are still awaiting the approver.",
    "p-anders", "pol-impact-assessment", ["ev-copilot-dpia"], ALL_CONSUMED, "2026-07-10"),
  a("ctl-a5-4", "yes", "in_progress",
    "The fairness and adverse-impact sections are completed wherever a system informs decisions about people. TalentScreen's is out of date, which is an open finding.",
    "p-boateng", "pol-impact-assessment", ["ev-claim-override-log", "ev-talentscreen-dpia"], ["sys-claim-triage-api", "sys-talentscreen", "sys-churnlens"], "2026-07-10"),
  a("ctl-a5-5", "yes", "implemented",
    "Societal impact is considered in each assessment. For most of our internal-facing systems the recorded answer is a reasoned 'not material', which we treat as a valid answer when it is argued.",
    "p-anders", "pol-impact-assessment", [], [], "2026-06-25"),

  a("ctl-a6-1-2", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, [], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a6-2-2", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, [], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a6-2-3", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, ["ev-forecast-model-card"], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a6-2-4", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, ["ev-forecast-model-card"], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a6-2-5", "yes", "implemented",
    "No system reaches production without a completed assessment and a recorded approval. This applies to procured systems as much as built ones — deploying a vendor tool to six hundred people is a deployment.",
    "p-devi", "pol-ai-governance", ["ev-copilot-tenant-config"], ALL_CONSUMED, "2026-06-18"),
  a("ctl-a6-2-6", "yes", "in_progress",
    "Monitoring is real for the claim triage service and the Copilot estate. For the smaller procured tools it amounts to waiting for a complaint, which is not monitoring.",
    "p-ferreira", null, ["ev-claim-override-log", "ev-studio-handoff-test", "ev-copilot-sharing-review"], ["sys-m365-copilot", "sys-copilot-studio", "sys-claim-triage-api"], "2026-07-28"),
  a("ctl-a6-2-8", "yes", "implemented",
    "Prompt and response logs are retained for thirty days in our own account for the systems we integrate; vendor-side logging is covered by the supplier assessment.",
    "p-ferreira", null, ["ev-claim-prompt-retention"], ["sys-claim-triage-api", "sys-docsearch"], "2026-06-09"),

  a("ctl-a7-2", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, [], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a7-3", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, [], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a7-4", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, ["ev-forecast-model-card"], BUILT_IN_HOUSE, "2026-04-11"),
  a("ctl-a7-5", "na", "not_applicable", CONSUMPTION_ONLY, "p-nakamura", null, [], BUILT_IN_HOUSE, "2026-04-11"),

  a("ctl-a8-2", "yes", "in_progress",
    "Guidance exists for the Copilot estate and the claim triage service. The stated limitations are the weak part — most guidance says what a tool does and not what it cannot be trusted with.",
    "p-devi", "pol-ai-use", ["ev-studio-handoff-test"], ALL_CONSUMED, "2026-07-28"),
  a("ctl-a8-3", "no", "not_applicable",
    "We are not currently subject to an external AI reporting obligation: we place no AI system on the market, and none of our uses meets the threshold that would trigger one. This is reviewed each time the regulatory position changes, and the assessment is dated below.",
    "p-larsen", null, [], [], "2026-06-25"),
  a("ctl-a8-4", "yes", "planned",
    "AI incidents route to the existing security incident process, but the AI-specific triggers are still in draft. A draft procedure cannot satisfy the control.",
    "p-oyelaran", "pol-incident", [], [], null),
  a("ctl-a9-2", "yes", "implemented",
    "Acceptable use is defined per system and enforced technically where possible — data-class blocks on the tools that support them, and the SharePoint over-sharing remediation for Copilot.",
    "p-devi", "pol-ai-use", ["ev-copilot-tenant-config", "ev-copilot-sharing-review", "ev-copilot-training"], ALL_CONSUMED, "2026-07-02"),
  a("ctl-a9-3", "yes", "in_progress",
    "Responsible use objectives are documented and referenced by assessments. Making them testable rather than aspirational is the open work.",
    "p-anders", "pol-ai-use", [], [], "2026-06-25"),
  a("ctl-a9-4", "yes", "in_progress",
    "Intended use is recorded per system and per use case. Periodic confirmation that actual use still matches is done for the four Copilot use cases and nothing else yet.",
    "p-anders", "pol-ai-use", ["ev-studio-agent-config"], ALL_CONSUMED, "2026-07-21"),
  a("ctl-a10-2", "yes", "implemented",
    "The responsibility split is documented for every enterprise agreement. For click-through tools it is not — which is the argument for consolidating them.",
    "p-larsen", "pol-vendor-ai", ["ev-ms-dpa"], ["sys-m365-copilot", "sys-copilot-studio", "sys-claim-triage-api", "sys-github-copilot", "sys-docsearch", "sys-translate"], "2026-04-02"),
  a("ctl-a10-3", "yes", "in_progress",
    "Suppliers on enterprise agreements are assessed and re-assessed annually. The trial and click-through vendors are the gap, and three of them process personal data.",
    "p-ibrahim", "pol-vendor-ai", ["ev-ms-dpa"], ALL_CONSUMED, "2026-04-02"),
  a("ctl-a10-4", "no", "not_applicable",
    "We do not supply AI features to customers as part of our own products. The customer-facing order status agent is a support channel we operate, not a product we sell, and is covered under A.9.2 and A.8.2 instead.",
    "p-larsen", null, [], [], "2026-06-25"),
];
