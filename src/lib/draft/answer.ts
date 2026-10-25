import type { Workspace } from "../ams/workspace";
import type { AnswerCitation, DraftedAnswer, QuestionnaireQuestion } from "../ams/types";
import {
  caveatsFor,
  citationsFor,
  controlSupport,
  lastVerifiedAmong,
  policyStanding,
  stall,
} from "./grounding";

/**
 * An answer to one customer question, drawn from the registers — or a refusal.
 *
 * **This module does not call a model yet**; the seam is marked below. Two
 * behaviours around it are real, and they are the two that matter:
 *
 * **Refusing is a legitimate output.** When the records behind a question do not
 * support an answer, this returns `text: null` and says why. That is not a
 * degraded result, it is the correct one — an answer sent to a customer is a
 * written statement by the company, and a confident paragraph about a
 * certification you do not hold is how an organisation ends up having lied in
 * writing. The refusal path is therefore checked *first*, before any prose is
 * assembled, so it cannot be reached only when the sentence-writing happens to
 * fail.
 *
 * **The provenance is the product.** Any model writes a plausible paragraph
 * about AI governance; what makes an answer sendable is knowing which control,
 * policy and document it rests on and whether those would survive being looked
 * at. Every citation carries its real standing, and an expired document is
 * marked unsound rather than quietly dropped.
 *
 * Nothing here is persisted, and that is deliberate — see the route.
 */

/**
 * Enough to answer with, or not.
 *
 * A question is answerable when something the company has actually adopted backs
 * it: a control that is applicable and implemented, or an approved policy. A
 * question whose linked records are all drafts, expiries and unverified uploads
 * is one where the honest output is a refusal, however much text could be
 * generated from them.
 */
function supportIsAnswerable(
  ws: Workspace,
  question: QuestionnaireQuestion,
): { answerable: boolean; why: string } {
  const controls = question.controlIds
    .map((id) => controlSupport(ws, id))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const implemented = controls.filter(
    (c) => c.implementation === "implemented" && c.applicability === "yes",
  );

  const approvedPolicies = question.policyIds
    .map((id) => ws.policyById(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .filter((p) => policyStanding(p).sound);

  if (implemented.length === 0 && approvedPolicies.length === 0) {
    if (controls.length === 0 && question.policyIds.length === 0) {
      return {
        answerable: false,
        why: "Nothing in the register is linked to this question — no control, no policy, no document. Drafting anything here would be composing a claim rather than reporting one.",
      };
    }
    const inFlight = controls.filter((c) => c.implementation !== "implemented");
    return {
      answerable: false,
      why:
        inFlight.length > 0
          ? `The controls behind this question are ${[...new Set(inFlight.map((c) => c.implementation.replace(/_/g, " ")))].join(" and ")}, and no policy covering it has been approved. Stating anything more affirmative than that would be a false statement in writing to a customer.`
          : "No approved policy and no implemented control stands behind this question, so there is nothing to report that would survive being checked.",
    };
  }

  return { answerable: true, why: "" };
}

export async function draftAnswer(
  ws: Workspace,
  question: QuestionnaireQuestion,
): Promise<DraftedAnswer> {
  const gate = supportIsAnswerable(ws, question);

  const controls = question.controlIds
    .map((id) => controlSupport(ws, id))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const evidence = question.evidenceIds
    .map((id) => ws.evidenceById(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  const citations: AnswerCitation[] = controls.flatMap(citationsFor);
  const caveats = controls.flatMap(caveatsFor);

  /*
   * ---------------------------------------------------------------------
   * The model call goes here.
   *
   * The question text is the one piece of person-written input in this feature
   * and it arrives from a customer's spreadsheet, so it must be `cleanLine`'d
   * and wrapped with `asUntrustedBlock()` before it reaches a prompt — it is a
   * *question*, never an instruction. Control titles and policy summaries get
   * the same treatment. See `.claude/skills/ai-route/`.
   * ---------------------------------------------------------------------
   */
  await stall();

  if (!gate.answerable) {
    return {
      questionId: question.id,
      text: null,
      refusal: gate.why,
      // The citations still go back. A refusal that shows its working is one the
      // owner can act on — it names exactly which record would have to change.
      citations,
      confidence: 0,
      lastVerified: null,
      caveats,
    };
  }

  const implemented = controls.filter((c) => c.implementation === "implemented");
  const policies = question.policyIds
    .map((id) => ws.policyById(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  const approved = policies.filter((p) => policyStanding(p).sound);

  const sentences: string[] = [];

  if (implemented.length > 0) {
    sentences.push(
      `Yes. ${implemented.length === 1 ? "The control" : `All ${implemented.length} controls`} covering this ${implemented.length === 1 ? "is" : "are"} implemented and claimed against the systems in scope: ${implemented.map((c) => `${c.control.officialRef} ${c.control.shortTitle}`).join(", ")}.`,
    );
  }

  if (approved.length > 0) {
    sentences.push(
      `${approved.length === 1 ? "It is" : "They are"} governed by ${approved.map((p) => `${p.title} (v${p.version})`).join(" and ")}, approved and within ${approved.length === 1 ? "its" : "their"} review period.`,
    );
  }

  const soundEvidence = evidence.filter((e) =>
    citations.some((c) => c.kind === "evidence" && c.id === e.id && c.sound),
  );
  if (soundEvidence.length > 0) {
    sentences.push(
      `Supporting records are available on request: ${soundEvidence.map((e) => e.title).join(", ")}.`,
    );
  }

  const systems = [...new Set(implemented.flatMap((c) => c.systems.map((s) => s.name)))];
  if (systems.length > 0) {
    sentences.push(`This covers ${systems.join(", ")}.`);
  }

  if (caveats.length > 0) {
    sentences.push(
      `One qualification before this is sent: ${caveats.length === 1 ? "see the caveat below" : `see the ${caveats.length} caveats below`}.`,
    );
  }

  /*
   * Confidence tracks the citations, not the prose.
   *
   * An unsound citation drags it down even when the sentence reads well, which
   * is the whole point — the reader needs the number to mean "how well does the
   * register back this", not "how fluent is it".
   */
  const sound = citations.filter((c) => c.sound).length;
  const confidence = citations.length === 0 ? 0.4 : Math.min(0.45 + (sound / citations.length) * 0.45, 0.9);

  return {
    questionId: question.id,
    text: sentences.join(" "),
    refusal: null,
    citations,
    lastVerified: lastVerifiedAmong(evidence),
    confidence,
    caveats,
  };
}
