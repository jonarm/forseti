import { ORIGIN, OVERSIGHT, RISK_TIER } from "../ams/labels";
import type { Workspace } from "../ams/workspace";
import type { AiSuggestion, TemplateField } from "../ams/types";
import { evidenceStanding, stall, type SupportingDatum } from "./grounding";

/**
 * A first draft of one impact-assessment answer, from what the register knows.
 *
 * **This module does not call a model yet** — the seam is marked below. What is
 * real is everything around it: the facts come from the tenant's own workspace,
 * the citations name records by id, and accepting the result is a *material*
 * change that resets the sign-off chain.
 *
 * The scoping rule this module exists to enforce: an assessment answer is about
 * **one system or use case**, not about the organisation. Drafting from the
 * whole register would produce a paragraph that is true of the company and
 * unfalsifiable about the thing being assessed, which is the failure mode of
 * every "AI-assisted questionnaire" a compliance lead has already been burned
 * by. So the draft is assembled from the assessed system's own record — its
 * origin, its oversight, its use cases, the evidence attached to it — and says
 * so.
 */

export type FieldDraft =
  | { ok: true; suggestion: AiSuggestion }
  | { ok: false; reason: string };

/**
 * Confidence from how much the assessed system's record actually supports an
 * answer, never from how fluent the sentence is.
 */
function confidenceFrom(useCases: number, evidence: number, hasPurpose: boolean): number {
  let score = 0.42;
  if (hasPurpose) score += 0.14;
  if (useCases > 0) score += 0.16;
  if (evidence > 0) score += 0.14;
  return Math.min(score, 0.85);
}

export async function draftAssessmentField(
  ws: Workspace,
  assessmentId: string,
  fieldId: string,
  field: Pick<TemplateField, "id" | "label" | "help"> | null,
): Promise<FieldDraft> {
  const assessment = ws.assessmentById(assessmentId);
  if (!assessment) {
    return { ok: false, reason: "That assessment is not in this organisation." };
  }

  const system = ws.systemById(assessment.systemId);
  if (!system) {
    return {
      ok: false,
      reason: "The system this assessment is about is no longer in the inventory, so there is nothing to describe.",
    };
  }

  const useCase = assessment.useCaseId ? ws.getUseCase(assessment.useCaseId) : undefined;
  const useCases = useCase ? [useCase] : ws.getUseCasesForSystem(system.id);
  const evidence = ws.evidenceForSystem(system.id);
  const sound = evidence.filter((e) => evidenceStanding(e).sound);

  /*
   * ---------------------------------------------------------------------
   * The model call goes here.
   *
   * The field label and help text below are ours. Anything originating with a
   * person — the system's `purpose`, a use case description, extracted document
   * text — must go through `cleanText` + `asUntrustedBlock()` before it reaches
   * a prompt, and the system prompt must state that the block is data. See
   * `.claude/skills/ai-route/`.
   * ---------------------------------------------------------------------
   */
  await stall();

  const label = field?.label ?? fieldId;
  const origin = ORIGIN[system.origin];
  const tier = RISK_TIER[system.riskTier];

  const purpose = system.purpose?.trim()
    ? system.purpose.trim().replace(/\s+$/, "")
    : `No purpose has been recorded for ${system.name}`;

  /* Resolved against the system this assessment is about: the drafted prose
   * describes a particular tool doing a particular job, and the purpose's
   * baseline may not be what this tool actually implements. */
  const oversight = useCase
    ? OVERSIGHT[ws.effectiveOversight(useCase.id, system.id).level]
    : null;

  const recommendation = [
    `${purpose}${purpose.endsWith(".") ? "" : "."}`,
    `${system.name} is ${origin.short.toLowerCase()} from ${system.vendor}, currently rated ${tier.label.toLowerCase()} risk and owned by ${system.businessUnit}.`,
    useCases.length > 0
      ? `It is used for ${useCases.length === 1 ? "one recorded purpose" : `${useCases.length} recorded purposes`}: ${useCases.map((u) => u.name).join(", ")}.`
      : `No use case has been recorded against it, so what it is actually used for is not written down anywhere.`,
    oversight
      ? `Oversight is ${oversight.label.toLowerCase()} — ${oversight.blurb.toLowerCase()}`
      : `The level of human oversight has not been recorded.`,
  ].join(" ");

  const gaps: string[] = [];
  if (!system.purpose?.trim()) gaps.push("the system has no recorded purpose");
  if (useCases.length === 0) gaps.push("no use case is recorded against it");
  if (evidence.length === 0) gaps.push("no evidence is attached to it");
  else if (sound.length === 0) gaps.push("every document attached to it is expired, unverified or missing its file");
  if (!oversight) gaps.push("the oversight level is unset");

  const reasoning = [
    `Drafted from ${system.name}'s own record rather than from the organisation's, because "${label}" is a question about this system and an answer that is merely true of the company cannot be checked against anything.`,
    sound.length > 0
      ? `${sound.length} of ${evidence.length} attached document${evidence.length === 1 ? "" : "s"} currently hold${sound.length === 1 ? "s" : ""} up, and ${sound.length === 1 ? "it is" : "they are"} cited below.`
      : `Nothing currently attached to the system supports a claim, so this describes the register rather than citing proof.`,
    gaps.length > 0
      ? `Treat it as a starting point: ${gaps.join("; ")}. Filling those in the inventory would produce a better answer than editing this one.`
      : `The record is complete enough that this needs checking rather than rewriting.`,
    `Accepting it is a material change, so any completed review on this assessment resets — a reviewer endorsed a different answer.`,
  ].join(" ");

  const supportingData: SupportingDatum[] = [
    { label: "System", detail: `${system.name} — ${system.vendor}, ${origin.label}`, href: `/inventory/${system.id}` },
    { label: "Risk tier", detail: `${tier.label} — ${system.lifecycleStage.replace(/_/g, " ")}` },
  ];

  if (useCases.length > 0) {
    supportingData.push({
      label: useCases.length === 1 ? "Use case" : `Use cases (${useCases.length})`,
      detail: useCases.map((u) => u.name).join(", "),
      href: `/use-cases/${useCases[0].id}`,
    });
  } else {
    supportingData.push({ label: "Use cases", detail: "None recorded" });
  }

  for (const e of sound.slice(0, 2)) {
    supportingData.push({ label: e.title, detail: evidenceStanding(e).detail, href: `/evidence/${e.id}` });
  }
  if (evidence.length > 0 && sound.length === 0) {
    supportingData.push({
      label: "Evidence",
      detail: `${evidence.length} attached, none currently usable`,
    });
  }

  return {
    ok: true,
    suggestion: {
      // One record per attempt — a redraft is a new proposal, and the previous
      // one is frequently the rejection worth keeping.
      id: `sug-field-${assessmentId}-${fieldId}-${Date.now()}`,
      // The dotted address the seeded suggestions already use for
      // record-plus-attribute. The decision route splits on the first dot.
      target: { kind: "field", id: `${assessmentId}.${fieldId}` },
      recommendation,
      reasoning,
      supportingData,
      confidence: confidenceFrom(useCases.length, sound.length, Boolean(system.purpose?.trim())),
      status: "pending",
      decidedById: null,
      decidedAt: null,
      editedText: null,
    },
  };
}
