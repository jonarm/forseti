/**
 * What the model proposes, and what a person did about it.
 *
 * One `AiSuggestion` type behind every AI surface in the product — the intake
 * triage recommendation, the SoA justification writer, the per-section
 * assessment assist. Three bespoke cards would make "AI proposes, humans
 * dispose" read as three coincidences instead of one product decision.
 *
 * Two things are load-bearing in the shape of these records:
 *
 *   - **`supportingData` is specific.** Each entry names a record the reader can
 *     go and check. A recommendation that cites "internal data" is unarguable in
 *     the bad sense — the compliance lead has nothing to push back on, so they
 *     either accept it blind or ignore it. Naming the four use cases and the
 *     permission report is what makes disagreement possible.
 *   - **A decided suggestion keeps its history.** `status`, `decidedById` and
 *     `decidedAt` stay on the record after the fact, and the rejected ones stay
 *     too. An assistant that only shows what was accepted is a record of its own
 *     wins; the value to an auditor is seeing that a person said no.
 *
 * Every consumer awaits `SUGGESTION_DELAY` before rendering. The delay is
 * deliberate: an answer that appears instantly reads as a lookup, and the point
 * being made is that something was considered.
 */
import type { AiSuggestion } from "../types";

/** Deliberate. Every mocked AI call waits this long before resolving. */
export const SUGGESTION_DELAY = 800;

export function withDelay<T>(value: T, ms = SUGGESTION_DELAY): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const SUGGESTIONS: AiSuggestion[] = [
  {
    id: "sug-copilot-search-tier",
    target: { kind: "field", id: "uc-copilot-search.riskTier" },
    recommendation: "Raise this use case from Limited to High risk.",
    reasoning:
      "Search is the one Copilot use case with no review step between the model and the reader, and its safety rests entirely on file permissions being correct. The permission review found 34 sites shared organisation-wide that were never meant to be, which means the control this use case depends on was not holding at the time it was rated Limited.",
    supportingData: [
      { label: "Oversight", detail: "Human on the loop — no review before the answer is shown" },
      { label: "Permission review", detail: "34 sites shared organisation-wide in error, top 200 reviewed" },
      { label: "Reach", detail: "610 users, all staff" },
      { label: "Contrast", detail: "The other three Copilot use cases keep a person between output and effect" },
    ],
    confidence: 0.86,
    status: "accepted",
    decidedById: "p-devi",
    decidedAt: "2026-04-02T16:05:00Z",
    editedText: null,
  },
  {
    id: "sug-studio-tier",
    target: { kind: "field", id: "sys-copilot-studio.riskTier" },
    recommendation: "Raise the system from Limited to High risk.",
    reasoning:
      "Copilot Studio is not a tool with a fixed behaviour — it is a platform on which your own team builds agents, so the risk is a function of what you build rather than what Microsoft ships. One of the three agents answers customers directly with no person in between.",
    supportingData: [
      { label: "Use case", detail: "Customer order status agent — public, human on the loop" },
      { label: "Characteristics", detail: "Generative, agentic" },
      { label: "Data", detail: "Personal data and customer content" },
      { label: "Vendor posture", detail: "Enterprise agreement, no training on customer data — mitigates vendor risk, not build risk" },
    ],
    confidence: 0.79,
    status: "accepted",
    decidedById: "p-hallberg",
    decidedAt: "2026-06-14T13:02:00Z",
    editedText: null,
  },
  {
    id: "sug-studio-oversight",
    target: { kind: "field", id: "sys-copilot-studio.oversightLevel" },
    recommendation:
      "Move the order status agent to human in the loop — hold every answer for review before the customer sees it.",
    reasoning:
      "The agent answers customers with no review step, and weekly sampling covers roughly 3% of conversations. Full review would close the wrong-answer risk outright.",
    supportingData: [
      { label: "Current sampling", detail: "~3% of conversations, two reviewers" },
      { label: "Open risk", detail: "Confidently wrong answer to a customer — residual 3×3" },
    ],
    confidence: 0.54,
    status: "rejected",
    decidedById: "p-hallberg",
    decidedAt: "2026-06-14T13:09:00Z",
    editedText: null,
  },
  {
    id: "sug-notetaker-action",
    target: { kind: "field", id: "sys-notetaker.riskTier" },
    recommendation: "Withdraw the tool rather than assess it.",
    reasoning:
      "This system fails on four independent grounds at once, and each one would be a finding on its own. Assessing it would document a position nobody would approve — the shorter route is to remove it and re-procure the capability properly if the team still needs it.",
    supportingData: [
      { label: "Contract", detail: "Click-through terms, no data processing agreement" },
      { label: "Residency", detail: "US only — no regional option on this plan" },
      { label: "Vendor training", detail: "Trains on customer data by default" },
      { label: "Discovery", detail: "Found in expense reports, never registered" },
      { label: "Oversight", detail: "None — recording notice depends on the organiser remembering" },
    ],
    confidence: 0.91,
    status: "pending",
    decidedById: null,
    decidedAt: null,
    editedText: null,
  },
  {
    id: "sug-talentscreen-finding",
    target: { kind: "control", id: "ctl-a5-4" },
    recommendation:
      "Mark A.5.4 as in progress rather than implemented, and cite the expired assessment.",
    reasoning:
      "The control is claimed against three systems that inform decisions about people. Two carry current evidence; TalentScreen's assessment expired on 30 July while the system stayed in live recruitment use. A control evidenced by an expired document is not implemented.",
    supportingData: [
      { label: "Claimed against", detail: "Claim Triage Service, TalentScreen, ChurnLens" },
      { label: "Expired evidence", detail: "TalentScreen impact assessment — lapsed 30 Jul 2026" },
      { label: "Open finding", detail: "High severity, corrective action in progress" },
    ],
    confidence: 0.88,
    status: "accepted",
    decidedById: "p-anders",
    decidedAt: "2026-07-30T09:12:00Z",
    editedText: null,
  },
];

/** Confidence renders as a band plus the figure, never a bare percentage. */
export function confidenceBand(confidence: number): {
  label: string;
  tone: "ok" | "warn" | "critical";
} {
  if (confidence >= 0.8) return { label: "High confidence", tone: "ok" };
  if (confidence >= 0.6) return { label: "Moderate confidence", tone: "warn" };
  return { label: "Low confidence", tone: "critical" };
}

/* ------------------------------------------- the SoA justification writer */

/**
 * Draft a justification for a control whose applicability just changed.
 *
 * Composed from the control's own fields and the organisation's posture rather
 * than retrieved from a list, because the interaction being demonstrated is a
 * model writing *into a specific empty field* — the moment where the temptation
 * to auto-apply is strongest and where refusing to auto-apply is the whole
 * product argument. It still returns an `AiSuggestion` like every other AI
 * surface, so it renders through the same card and carries the same
 * Accept / Edit / Reject.
 *
 * Confidence is genuinely lower for an exclusion than for an N/A: "we do not
 * build models" is a fact about the organisation, while "this control does not
 * apply to us" is an argument someone has to stand behind in an audit.
 */
export function draftJustification(
  control: { id: string; officialRef: string; shortTitle: string; developmentOnly: boolean },
  applicability: "yes" | "no" | "na",
): Promise<AiSuggestion> {
  const base = {
    id: `sug-just-${control.id}-${applicability}`,
    target: { kind: "control" as const, id: control.id },
    status: "pending" as const,
    decidedById: null,
    decidedAt: null,
    editedText: null,
  };

  if (applicability === "na") {
    return withDelay({
      ...base,
      recommendation: control.developmentOnly
        ? `Not applicable. We procure AI systems rather than develop them, with one exception: the demand forecasting model built by Data & Analytics, which is assessed against ${control.officialRef} separately. For the procured estate the design and training obligations sit with the vendor and are evidenced through the supplier assessment under A.10.3.`
        : `Not applicable. ${control.shortTitle} addresses an activity this organisation does not currently undertake. This position is reviewed whenever the AI estate changes materially, and the review date is recorded against this control.`,
      reasoning: control.developmentOnly
        ? "This control only bites on systems you build yourself. Your inventory holds two internally built models and thirteen procured systems, so a blanket exclusion would be untrue — the draft names the exception rather than hiding it, which is the version that survives an auditor finding the demand forecasting model."
        : "Marking a control not applicable needs an argument, not an assertion. The draft states the activity you do not undertake and commits to a review trigger, which is the shape auditors accept.",
      supportingData: [
        { label: "Inventory", detail: "13 procured systems, 2 built in house" },
        { label: "Exception named", detail: "Demand Forecasting Model — Data & Analytics" },
        { label: "Pattern", detail: "Matches the justification already accepted on 7 other development controls" },
      ],
      confidence: control.developmentOnly ? 0.89 : 0.62,
    });
  }

  if (applicability === "no") {
    return withDelay({
      ...base,
      recommendation: `Excluded from scope. ${control.shortTitle} relates to an obligation we are not currently subject to. The position is reassessed each time our regulatory footing changes, and the date of the last assessment is recorded against this control.`,
      reasoning:
        "An exclusion is the hardest position to defend, because it says a requirement of the standard does not reach you. The draft is deliberately conservative and ties the exclusion to a reassessment trigger — but this one is worth a lawyer reading before you accept it.",
      supportingData: [
        { label: "Control", detail: `${control.officialRef} — ${control.shortTitle}` },
        { label: "Comparable", detail: "2 other controls are currently excluded on scope grounds" },
        { label: "Caution", detail: "Exclusions are the first thing an auditor samples" },
      ],
      confidence: 0.44,
    });
  }

  return withDelay({
    ...base,
    recommendation: `Applicable. ${control.shortTitle} applies to our use of AI and is implemented through the policies and evidence linked to this control.`,
    reasoning:
      "Applicable controls need a justification too, but a short one: it records why the control is in scope so a later reviewer does not have to re-derive it. What carries the weight here is the linked evidence, not this sentence.",
    supportingData: [
      { label: "Control", detail: `${control.officialRef} — ${control.shortTitle}` },
      { label: "Note", detail: "Evidence, not prose, is what demonstrates this one" },
    ],
    confidence: 0.71,
  });
}

/* --------------------------------------------- the assessment section assist */

/**
 * Draft an answer for one assessment field.
 *
 * The context passed in is the system and use case the assessment hangs off, so
 * the draft can cite facts the assessor can check — the oversight level already
 * recorded, the data categories already declared — rather than producing plausible
 * prose from nothing. A draft that cannot be checked is one people accept without
 * reading, which is the failure mode this whole pattern exists to avoid.
 *
 * Confidence is lower here than on the SoA, deliberately. A justification for a
 * control is a statement about a policy; an answer in an impact assessment is a
 * claim about how a system behaves in the world, and the model is guessing at
 * more of it.
 */
export function draftFieldAnswer(
  field: { id: string; label: string },
  context: { systemName: string; facts: { label: string; detail: string }[]; draft: string },
): Promise<AiSuggestion> {
  return withDelay({
    id: `sug-field-${field.id}`,
    target: { kind: "section" as const, id: field.id },
    recommendation: context.draft,
    reasoning: `Drafted from what is already recorded about ${context.systemName} — the facts below are from the inventory and the use case, not invented for this answer. Treat it as a first pass by someone who has read the file: it will be roughly right about the shape and wrong about the specifics only you know.`,
    supportingData: context.facts,
    confidence: 0.63,
    status: "pending" as const,
    decidedById: null,
    decidedAt: null,
    editedText: null,
  });
}
