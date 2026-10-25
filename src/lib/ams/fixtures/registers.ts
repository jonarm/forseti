/**
 * Risks and findings — the two registers the profile tabs read from.
 *
 * A risk is something that might happen; a finding is something that already
 * did, or that an audit caught. They are kept apart because they close
 * differently: a risk is treated and its residual accepted by a named person, a
 * finding needs a corrective action and a dated verification before anyone may
 * mark it closed.
 *
 * Residual rating is stored here rather than derived because a treatment's
 * effect is a judgement, not arithmetic — but it is never allowed to be zero.
 * A treated risk is a smaller risk, not an absent one.
 */
import type {
  Finding,
  FindingRiskKind,
  FindingRiskLink,
  FindingSource,
  Risk,
} from "../types";

export const RISKS: Risk[] = [
  {
    id: "risk-copilot-oversharing",
    title: "Copilot surfaces over-shared content to people who could technically already reach it",
    systemId: "sys-m365-copilot",
    useCaseId: "uc-copilot-search",
    controlIds: ["ctl-a9-2", "ctl-a6-2-6"],
    inherentLikelihood: 4,
    inherentImpact: 4,
    treatment: "mitigate",
    treatmentSummary:
      "Site-level permission review across the top 200 SharePoint sites, sensitivity labels enforced on the classes that matter, and a standing report on newly over-shared sites. Complete for the top 200; the tail is unreviewed.",
    residualLikelihood: 2,
    residualImpact: 4,
    ownerId: "p-devi",
    status: "treated",
    acceptedById: "p-oyelaran",
    acceptedAt: "2026-07-02",
  },
  {
    id: "risk-studio-wrong-answer",
    title: "Order status agent gives a customer a confidently wrong answer",
    systemId: "sys-copilot-studio",
    useCaseId: "uc-studio-order-status",
    controlIds: ["ctl-a6-2-6", "ctl-a8-2"],
    inherentLikelihood: 4,
    inherentImpact: 3,
    treatment: "mitigate",
    treatmentSummary:
      "The agent answers only from the order system and shipping feed, hands off to a human on any refund or complaint intent, and weekly transcript sampling checks for confident errors. Sampling is manual and covers about 3% of conversations.",
    residualLikelihood: 3,
    residualImpact: 3,
    ownerId: "p-hallberg",
    status: "open",
    acceptedById: null,
    acceptedAt: null,
  },
  {
    id: "risk-talentscreen-adverse",
    title: "Candidate ranking produces different outcomes across protected groups",
    systemId: "sys-talentscreen",
    useCaseId: "uc-talent-screening",
    controlIds: ["ctl-a5-4", "ctl-6-3"],
    inherentLikelihood: 3,
    inherentImpact: 5,
    treatment: "mitigate",
    treatmentSummary:
      "Recruiters see every candidate, not only the shortlist, and the vendor supplies quarterly disparity figures. We have not yet run our own test on our own applicant pool, which is the part that would actually answer this.",
    residualLikelihood: 3,
    residualImpact: 5,
    ownerId: "p-boateng",
    status: "open",
    acceptedById: null,
    acceptedAt: null,
  },
  {
    id: "risk-notetaker-consent",
    title: "External call recorded without the other party being told",
    systemId: "sys-notetaker",
    useCaseId: "uc-notetaker-calls",
    controlIds: ["ctl-a9-2", "ctl-a4-3"],
    inherentLikelihood: 5,
    inherentImpact: 4,
    treatment: "avoid",
    treatmentSummary:
      "Recommendation is to withdraw the tool. It was bought on a team card, has no data processing agreement, hosts in the US and trains on customer data by default. Pending a decision at the September forum.",
    residualLikelihood: 4,
    residualImpact: 4,
    ownerId: "p-quinn",
    status: "open",
    acceptedById: null,
    acceptedAt: null,
  },
  {
    id: "risk-claim-deprioritised",
    title: "A claim is quietly deprioritised and nobody notices",
    systemId: "sys-claim-triage-api",
    useCaseId: "uc-claim-routing",
    controlIds: ["ctl-a5-4", "ctl-a6-2-6"],
    inherentLikelihood: 3,
    inherentImpact: 4,
    treatment: "mitigate",
    treatmentSummary:
      "Every handler override is logged, queue ageing is reported daily, and any claim past the service threshold escalates regardless of its assigned priority.",
    residualLikelihood: 1,
    residualImpact: 4,
    ownerId: "p-ferreira",
    status: "treated",
    acceptedById: "p-oyelaran",
    acceptedAt: "2026-07-16",
  },
  {
    id: "risk-shadow-ai",
    title: "AI tools enter the organisation without passing intake",
    systemId: null,
    useCaseId: null,
    controlIds: ["ctl-a3-2", "ctl-a10-3"],
    inherentLikelihood: 5,
    inherentImpact: 3,
    treatment: "mitigate",
    treatmentSummary:
      "Monthly sweep of single sign-on logs and expense lines against the inventory. Three systems found this way so far, which is the control working and the problem being real at the same time.",
    residualLikelihood: 3,
    residualImpact: 3,
    ownerId: "p-anders",
    status: "open",
    acceptedById: "p-anders",
    acceptedAt: "2026-06-25",
  },
  {
    id: "risk-vendor-training",
    title: "A vendor trains on our data under click-through terms",
    systemId: null,
    useCaseId: null,
    controlIds: ["ctl-a10-2", "ctl-a10-3"],
    inherentLikelihood: 4,
    inherentImpact: 4,
    treatment: "mitigate",
    treatmentSummary:
      "Enterprise agreements prohibit it and are evidenced. Four tools remain on click-through terms, three of which process personal data; consolidating them onto agreements is the open action.",
    residualLikelihood: 3,
    residualImpact: 4,
    ownerId: "p-ibrahim",
    status: "open",
    acceptedById: null,
    acceptedAt: null,
  },
];

export const FINDINGS: Finding[] = [
  {
    id: "fnd-notetaker-unregistered",
    title: "Call recording tool in use with no assessment and no DPA",
    severity: "critical",
    status: "open",
    source: "self_identified",
    raisedBy: "Monthly expense-ledger sweep",
    raisedAt: "2026-07-14",
    dueAt: "2026-08-14",
    ownerId: "p-quinn",
    systemId: "sys-notetaker",
    controlId: "ctl-a3-2",
    summary:
      "Found in the expense ledger, not through intake. Records external calls, hosts in the US, trains on customer data by default and has no data processing agreement. Now overdue.",
    rootCause:
      "Software under the departmental card threshold never reaches procurement, so nothing triggers intake. The control assumes purchases are visible; below £200 a month they are not.",
    correctiveAction: null,
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-talentscreen-dpia",
    title: "TalentScreen impact assessment has expired",
    severity: "high",
    status: "corrective_action",
    source: "self_identified",
    raisedBy: "Evidence expiry monitoring",
    raisedAt: "2026-07-30",
    dueAt: "2026-08-29",
    ownerId: "p-boateng",
    systemId: "sys-talentscreen",
    controlId: "ctl-6-3",
    summary:
      "The assessment lapsed on 30 July while the system remained in use for live recruitment. A system that informs decisions about people cannot run on an expired assessment.",
    rootCause:
      "The renewal date sat only in the document itself, so nothing chased it. Nobody was assigned the renewal when the original owner changed role in March.",
    correctiveAction:
      "Reassessment under way with People and Legal, due 29 August. Expiry now tracked in the evidence register with a 60-day warning, and the renewal is assigned to a named owner rather than to the document.",
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-clickthrough-vendors",
    title: "Four AI tools running on click-through terms",
    severity: "high",
    status: "corrective_action",
    source: "internal_audit",
    raisedBy: "Internal Audit — AI management system review, IA-2026-04",
    raisedAt: "2026-05-14",
    dueAt: "2026-09-30",
    ownerId: "p-ibrahim",
    systemId: null,
    controlId: "ctl-a10-2",
    summary:
      "Three of the four process personal data. Procurement is consolidating them onto agreements or withdrawing them; two are already scheduled for withdrawal.",
    rootCause:
      "AI tools were being bought as software rather than as data processors, so the supplier assessment standard was never applied to them.",
    correctiveAction:
      "AI supplier assessment made mandatory at purchase-order stage regardless of value. Two tools scheduled for withdrawal, two moving to enterprise agreements at renewal.",
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-studio-oversight-thin",
    title: "Too few reviewers to sustain the sampling the agent risk assumes",
    severity: "medium",
    status: "open",
    source: "self_identified",
    raisedBy: "R. Andersen, governance review of the Copilot Studio pilot",
    raisedAt: "2026-07-10",
    dueAt: "2026-09-10",
    ownerId: "p-hallberg",
    systemId: "sys-copilot-studio",
    controlId: "ctl-a4-6",
    summary:
      "Weekly transcript sampling is assigned to two team leads alongside their existing work, and covers about 3% of conversations. The treatment for the wrong-answer risk assumes more than that.",
    rootCause: null,
    correctiveAction: null,
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-incident-draft",
    title: "AI incident procedure has been in draft for four months",
    severity: "medium",
    status: "open",
    source: "internal_audit",
    raisedBy: "Internal Audit — AI management system review, IA-2026-04",
    raisedAt: "2026-05-14",
    dueAt: "2026-08-31",
    ownerId: "p-oyelaran",
    systemId: null,
    controlId: "ctl-a8-4",
    summary:
      "AI incidents currently route to the general security process with no AI-specific triggers, so a model behaving badly has no obvious owner in the first hour.",
    rootCause: null,
    correctiveAction: null,
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-customer-questionnaire",
    title: "Unable to answer a customer's AI due diligence questionnaire within the contracted window",
    severity: "medium",
    status: "corrective_action",
    source: "customer",
    raisedBy: "Northwind Retail — annual supplier assurance review",
    raisedAt: "2026-06-20",
    dueAt: "2026-09-20",
    ownerId: "p-larsen",
    systemId: null,
    controlId: "ctl-a10-4",
    summary:
      "A customer asked which AI systems touch their data, what models sit behind them and who reviews the output. Assembling the answer took eleven working days against a five-day contractual commitment.",
    rootCause:
      "The information existed but not in one place: inventory in a spreadsheet, model providers in contracts, oversight in assessment documents. Every answer was reassembled by hand.",
    correctiveAction:
      "Customer-facing AI disclosure drafted from the inventory and kept current, so the answer is generated rather than reassembled.",
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-external-soa-justifications",
    title: "Statement of Applicability exclusions not supported by a documented rationale",
    severity: "high",
    status: "verification",
    source: "external_audit",
    raisedBy: "Kestrel Assurance — ISO 42001 stage 1 readiness review, ref KA-42001-S1-07",
    raisedAt: "2026-06-05",
    dueAt: "2026-08-20",
    ownerId: "p-anders",
    systemId: null,
    controlId: "ctl-7-3",
    summary:
      "The certification body's stage 1 review found four Annex A controls marked not applicable with a one-line justification that did not name the activity being excluded. Stage 2 cannot proceed until each exclusion is argued.",
    rootCause:
      "The first pass at the SoA treated exclusion as an administrative step rather than a position to defend, so justifications were written to fill the field rather than to be read.",
    correctiveAction:
      "Every exclusion rewritten to state the activity not undertaken, name any exception, and commit to a review trigger. Development controls now cite the one internally built model explicitly rather than claiming the organisation builds nothing.",
    verifiedById: "p-oyelaran",
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-residual-acceptance",
    title: "Residual risk accepted without a named acceptor below the high tier",
    severity: "low",
    status: "verification",
    source: "internal_audit",
    raisedBy: "Internal Audit — AI management system review, IA-2026-04",
    raisedAt: "2026-05-14",
    dueAt: "2026-08-15",
    ownerId: "p-anders",
    systemId: null,
    controlId: "ctl-6-2",
    summary:
      "The register now requires a named acceptor on every entry; verification is checking that the backfill actually happened rather than that the field exists.",
    rootCause:
      "Acceptance was implied by the owner field. Owning a risk and accepting what remains of it are different acts, and the register had no way to record the second.",
    correctiveAction:
      "Acceptance recorded as its own field with a name and date, and re-rating a residual now voids any acceptance attached to the previous figure.",
    verifiedById: "p-oyelaran",
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  },
  {
    id: "fnd-copilot-oversharing",
    title: "Over-shared SharePoint sites surfaced through Copilot search",
    severity: "high",
    status: "closed",
    source: "incident",
    raisedBy: "Reported by a staff member through the speak-up channel",
    raisedAt: "2026-04-02",
    dueAt: "2026-06-30",
    ownerId: "p-devi",
    systemId: "sys-m365-copilot",
    controlId: "ctl-a9-2",
    summary:
      "An employee searching for a policy was shown salary review notes from a site shared organisation-wide in error. The content had been reachable for two years; Copilot was what made it findable.",
    rootCause:
      "Organisation-wide sharing links were enabled by default and never reviewed. Permissions that were technically correct but practically obscure became practically reachable the moment search improved.",
    correctiveAction:
      "Permission review across the top 200 sites, sensitivity labels enforced on the classes that matter, organisation-wide links disabled, and a standing report on newly over-shared sites.",
    verifiedById: "p-oyelaran",
    verifiedAt: "2026-07-02",
    verificationNote:
      "Sampled ten of the thirty-four previously flagged sites; all now restricted. Standing report confirmed running weekly with a named recipient. Closure accepted.",
    closedAt: "2026-07-02",
  },
];

export const FINDING_SOURCE: Record<
  FindingSource,
  { label: string; blurb: string; external: boolean }
> = {
  self_identified: {
    label: "Self-identified",
    blurb: "Found by our own monitoring or review before anyone else raised it.",
    external: false,
  },
  internal_audit: {
    label: "Internal audit",
    blurb: "Raised by Internal Audit against a planned review.",
    external: false,
  },
  incident: {
    label: "Incident",
    blurb: "Something went wrong and was reported.",
    external: false,
  },
  external_audit: {
    label: "External audit",
    blurb: "Raised by a certification body or an external assessor.",
    external: true,
  },
  regulator: {
    label: "Regulator",
    blurb: "Raised by a supervisory authority.",
    external: true,
  },
  customer: {
    label: "Customer",
    blurb: "Raised by a customer, usually through a due diligence review.",
    external: true,
  },
  supplier_review: {
    label: "Supplier review",
    blurb: "Surfaced while assessing a supplier.",
    external: true,
  },
};

export const FINDING_STATUS: Record<
  Finding["status"],
  { label: string; blurb: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" }
> = {
  open: {
    label: "Open",
    blurb: "Raised, and nobody has yet said what will be done about it.",
    tone: "critical",
  },
  corrective_action: {
    label: "Corrective action",
    blurb: "A fix is agreed and under way.",
    tone: "warn",
  },
  verification: {
    label: "Verification",
    blurb: "The fix is claimed done and somebody other than the owner is checking.",
    tone: "info",
  },
  closed: {
    label: "Closed",
    blurb: "Verified by a second person and closed on a date.",
    tone: "ok",
  },
};

export const FINDING_SEVERITY: Record<
  Finding["severity"],
  { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" }
> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "warn" },
  high: { label: "High", tone: "critical" },
  critical: { label: "Critical", tone: "critical" },
};

/**
 * Whether a finding may be closed.
 *
 * The gate the whole type exists for: a corrective action is a claim, and a
 * claim checked by the person who made it is a self-assessment. Verification
 * has to be somebody else, and it has to be dated — an auditor sampling closed
 * findings is looking for exactly the ones that are not.
 */
export function canClose(finding: Finding): { ok: boolean; reason: string } {
  if (!finding.rootCause) {
    return { ok: false, reason: "No root cause recorded — the symptom may be fixed and the cause still there." };
  }
  if (!finding.correctiveAction) {
    return { ok: false, reason: "No corrective action recorded." };
  }
  if (!finding.verifiedById) {
    return { ok: false, reason: "Nobody has verified the fix." };
  }
  if (finding.verifiedById === finding.ownerId) {
    return {
      ok: false,
      reason: "Verified by the person who owns it. Verification has to be somebody else, or it is a self-assessment.",
    };
  }
  if (!finding.verifiedAt) {
    return { ok: false, reason: "Verification has no date against it." };
  }
  return { ok: true, reason: "Root cause, corrective action and an independent dated verification are all recorded." };
}

/** Days a finding has been open, or how long it took to close. */
export function findingAge(finding: Finding, today = "2026-08-10"): number {
  const end = finding.closedAt ?? today;
  return Math.max(
    0,
    Math.round(
      (new Date(end).getTime() - new Date(finding.raisedAt).getTime()) / 86_400_000,
    ),
  );
}

/** Inherent and residual both reduce to one number the same way. */
export function riskScore(likelihood: number, impact: number): number {
  return likelihood * impact;
}

/* ------------------------------------------------ findings ↔ risks */

/**
 * How the two registers connect.
 *
 * Kept as a join so the relationship can carry its own kind and its own
 * reasoning. Two patterns are worth seeing in the fixture data:
 *
 *   - **One finding, two risks.** The unregistered notetaker both revealed a
 *     consent risk specific to that tool and materialised the standing
 *     shadow-AI risk — the thing we said might happen, happening.
 *   - **Two findings, one risk.** The shadow-AI risk is fed by the notetaker
 *     and by the click-through vendor finding, which share a root cause:
 *     purchases below the procurement threshold never reach intake.
 */
export const FINDING_RISK_LINKS: FindingRiskLink[] = [
  {
    findingId: "fnd-studio-oversight-thin",
    riskId: "risk-studio-wrong-answer",
    kind: "undermines",
    note:
      "The treatment for this risk assumes weekly transcript sampling. The finding says that sampling is two team leads covering about 3% of conversations alongside their day jobs — so the residual rating rests on a control that is not resourced to do what the treatment claims.",
  },
  {
    findingId: "fnd-talentscreen-dpia",
    riskId: "risk-talentscreen-adverse",
    kind: "undermines",
    note:
      "The treatment leans on the impact assessment and the disparity figures inside it. That assessment expired on 30 July, so the evidence the residual rating depends on is no longer current.",
  },
  {
    findingId: "fnd-copilot-oversharing",
    riskId: "risk-copilot-oversharing",
    kind: "revealed",
    note:
      "An employee was shown salary review notes through Copilot search. The risk was raised the same week — the incident is why it is in the register rather than something that happened to a risk already there.",
  },
  {
    findingId: "fnd-notetaker-unregistered",
    riskId: "risk-notetaker-consent",
    kind: "revealed",
    note:
      "Finding the tool is what put the consent risk on the register. Nobody had assessed the recording of external calls because nobody knew it was happening.",
  },
  {
    findingId: "fnd-notetaker-unregistered",
    riskId: "risk-shadow-ai",
    kind: "materialised",
    note:
      "The standing risk is that AI tools enter without passing intake. This is that risk happening: a tool bought on a team card, in use for weeks, found in the expense ledger rather than declared.",
  },
  {
    findingId: "fnd-clickthrough-vendors",
    riskId: "risk-shadow-ai",
    kind: "materialised",
    note:
      "Four tools acquired without the supplier assessment being applied. Same root cause as the notetaker — purchases under the procurement threshold never reach intake.",
  },
  {
    findingId: "fnd-clickthrough-vendors",
    riskId: "risk-vendor-training",
    kind: "revealed",
    note:
      "The audit found the click-through terms; the risk names what those terms permit. Three of the four process personal data.",
  },
];

export const FINDING_RISK_KIND: Record<
  FindingRiskKind,
  { label: string; blurb: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" }
> = {
  revealed: {
    label: "Revealed this risk",
    blurb: "The finding is why the risk is on the register.",
    tone: "info",
  },
  materialised: {
    label: "Risk materialised",
    blurb: "The thing we said might happen, happening.",
    tone: "critical",
  },
  undermines: {
    label: "Undermines the treatment",
    blurb: "Direct evidence against the residual rating above.",
    tone: "warn",
  },
};
