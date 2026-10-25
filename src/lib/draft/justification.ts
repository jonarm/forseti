import { APPLICABILITY } from "../ams/labels";
import type { Workspace } from "../ams/workspace";
import type { AiSuggestion } from "../ams/types";
import {
  controlSupport,
  nowIso,
  stall,
  supportingDataFor,
} from "./grounding";

/**
 * Why a control is excluded, written from the organization's own records.
 *
 * **This module does not call a model yet.** It returns canned prose assembled
 * from the workspace, and the seam where the call goes is marked below. That is
 * deliberate for this slice: the whole point of the feature is the loop — a
 * proposal arrives, a person interrogates it, accepts or rejects, and the
 * decision leaves a mark. Every part of that loop is real here. Only the
 * sentence-writing is stubbed, and it is the part that changes least.
 *
 * What is **not** stubbed, because stubbing it would prove nothing:
 *
 *   - The facts are read from the tenant's own workspace, never from the
 *     request body. A caller that could supply the supporting records could
 *     supply the conclusion.
 *   - `supportingData` names real controls, policies and documents by id, with
 *     their real standing — including the expired ones. Filtering those out
 *     would make the card claim better support than the control has.
 *   - Confidence is derived from how much actually backs the control, so a
 *     thinly-supported exclusion arrives visibly uncertain rather than
 *     arriving polished and wrong.
 *
 * Justification is only required when a control is excluded or not applicable,
 * so that is the only case this drafts. A control that *is* applicable needs
 * implementation, not an explanation.
 */

/** What the route hands back. `null` when there is nothing honest to say. */
export type JustificationDraft =
  | { ok: true; suggestion: AiSuggestion }
  | { ok: false; reason: string };

/**
 * Confidence, derived rather than asserted.
 *
 * A model asked for its own confidence gives you a number that correlates with
 * fluency. This one correlates with evidence, which is the thing a reader
 * actually wants it to mean: an exclusion backed by a named system boundary and
 * a current policy is one we can stand behind, and one backed by nothing is a
 * guess however well it reads.
 */
function confidenceFrom(support: NonNullable<ReturnType<typeof controlSupport>>): number {
  let score = 0.45;
  if (support.systems.length > 0) score += 0.15;
  if (support.policy && support.policy.status === "approved") score += 0.15;
  if (support.sound.length > 0) score += 0.12;
  if (support.owner) score += 0.08;
  // Never present a stub as certain. The ceiling is the honest part.
  return Math.min(score, 0.88);
}

export async function draftJustification(
  ws: Workspace,
  controlId: string,
): Promise<JustificationDraft> {
  const support = controlSupport(ws, controlId);
  if (!support) {
    return { ok: false, reason: "That control is not in this organisation's framework." };
  }

  const row = ws.applicabilityFor(controlId);
  if (!row) {
    return {
      ok: false,
      reason: "Decide whether the control is applicable first — a justification explains a decision that has been made.",
    };
  }
  if (row.applicability === "yes") {
    return {
      ok: false,
      reason: "An applicable control needs implementation, not a justification. Justifications are for controls you exclude.",
    };
  }

  /*
   * ---------------------------------------------------------------------
   * The model call goes here.
   *
   * When it does: system prompt above the fold with a cache breakpoint, the
   * workspace facts as a trailing block, and every string that came from a
   * person — control titles, policy summaries, extracted document text — through
   * `cleanText` + `asUntrustedBlock()` first. The facts below are ours, computed
   * from our own tables, which is why they are safe to interpolate directly.
   * See `.claude/skills/ai-route/`.
   * ---------------------------------------------------------------------
   */
  await stall();

  const { control } = support;
  const excluded = row.applicability === "no";
  const verb = excluded ? "excluded" : "not applicable";

  const scope =
    support.systems.length > 0
      ? `The systems this control was considered against — ${support.systems.map((s) => s.name).join(", ")} — do not exercise the capability it governs.`
      : "No system in the inventory exercises the capability this control governs.";

  const basis = support.policy
    ? `${support.policy.title} records the position, and the boundary it describes is the one relied on here.`
    : support.sound.length > 0
      ? `${support.sound[0].title} is the record relied on for the boundary.`
      : "The boundary rests on the inventory alone; no policy or document states it yet.";

  const recommendation = [
    `${APPLICABILITY[row.applicability].label} — ${control.officialRef} (${control.shortTitle}) is ${verb} because the organisation does not perform the activity it requires.`,
    scope,
    basis,
    support.owner
      ? `${support.owner} owns this control and would be the person to revisit it if that changes.`
      : "No owner is named, so nothing prompts a review if the boundary moves.",
  ].join(" ");

  const gaps: string[] = [];
  if (support.systems.length === 0) gaps.push("the control is not claimed against any system");
  if (!support.policy) gaps.push("no policy states the boundary");
  if (support.sound.length === 0 && support.evidence.length > 0) {
    gaps.push("every document attached to it is expired, unverified or missing its file");
  }
  if (support.evidence.length === 0) gaps.push("nothing is attached as evidence");

  const reasoning = [
    `An exclusion is a claim an auditor will test, so this is written from what the register actually holds rather than from what the control is about.`,
    support.systems.length > 0
      ? `The ${support.systems.length === 1 ? "system" : `${support.systems.length} systems`} named above ${support.systems.length === 1 ? "is" : "are"} the scope the exclusion covers; anything added later is outside what this justification says.`
      : `Nothing in the inventory is linked to this control, which is why the scope sentence names none — an exclusion that cannot say what it excludes is the weakest form of this claim.`,
    gaps.length > 0
      ? `Read it with the gaps in mind: ${gaps.join("; ")}. Those are why the confidence is not higher.`
      : `A named scope, an approved policy and current evidence all point the same way, which is why this reads as settled.`,
  ].join(" ");

  return {
    ok: true,
    suggestion: {
      /*
       * Unique per attempt, deliberately — a redraft is a new proposal, not a
       * revision of the old one.
       *
       * A deterministic id would upsert over the previous record, and the
       * previous record is frequently the one worth keeping: a rejection is the
       * evidence that a person was able to say no. It would also strand the
       * control, because a decided suggestion cannot be decided again and the
       * row would have nothing left to offer.
       */
      id: `sug-just-${control.id}-${Date.now()}`,
      target: { kind: "control", id: control.id },
      recommendation,
      reasoning,
      supportingData: supportingDataFor(support),
      confidence: confidenceFrom(support),
      status: "pending",
      decidedById: null,
      decidedAt: null,
      editedText: null,
    },
  };
}

/** Exported for the decision route, which must know what a control suggestion writes into. */
export function justificationTargetControlId(suggestion: AiSuggestion): string | null {
  return suggestion.target.kind === "control" ? suggestion.target.id : null;
}

export { nowIso };
