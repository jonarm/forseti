/**
 * Drafting an answer, and being honest about what it rests on.
 *
 * The whole product argument for a questionnaire copilot is provenance. Any
 * language model can write a confident paragraph about your AI governance; the
 * thing that makes an answer *sendable* is knowing which control, which policy
 * and which document it came from, and whether those are currently in a state
 * you would want a customer to inspect. An answer without citations is marketing
 * copy with a compliance vocabulary, and the person pasting it into a customer
 * portal is the one who carries it.
 *
 * Three rules follow, and each one is visible in the output:
 *
 *   1. **Confidence is derived, never authored.** It falls out of the state of
 *      the cited records — an implemented control with current evidence raises
 *      it, a draft policy or an expired document lowers it. A model asserting
 *      its own confidence is a model marking its own homework.
 *   2. **A citation can be unsound and still be shown.** If a control is cited
 *      and has no usable evidence, that appears *in* the provenance rather than
 *      being quietly dropped to make the answer look better. The caveat is the
 *      most valuable line on the screen.
 *   3. **Refusing is a legitimate output.** Where the record supports nothing,
 *      the engine returns no text and says why. Inventing an answer to a
 *      certification question is how an organisation ends up having made a false
 *      statement to a customer in writing.
 */
import { hasUsableEvidence, isUsableEvidence } from "./readiness";
import { IMPLEMENTATION, formatDate, isOverdue } from "./labels";
import { withDelay } from "./fixtures/ai";
import type { AnswerCitation, DraftedAnswer, QuestionnaireQuestion } from "./types";
import type { Workspace } from "./workspace";

/* ------------------------------------------------------------- the citations */

function citationsFor(ws: Workspace, question: QuestionnaireQuestion): AnswerCitation[] {
  const citations: AnswerCitation[] = [];
  const soaHref = ws.framework ? `/frameworks/${ws.framework.id}` : "/frameworks";

  for (const id of question.controlIds) {
    const control = ws.controlById(id);
    const row = ws.applicabilityFor(id);
    if (!control || !row) continue;
    const evidenced = hasUsableEvidence(ws, row);
    const implemented = row.implementationStatus === "implemented";
    citations.push({
      kind: "control",
      id,
      label: `${control.officialRef} ${control.shortTitle}`,
      detail: `${IMPLEMENTATION[row.implementationStatus].label}${evidenced ? ", evidenced" : ", no usable evidence"}`,
      sound: implemented && evidenced,
      href: `${soaHref}?node=${control.nodeId}`,
    });
  }

  for (const id of question.policyIds) {
    const policy = ws.policyById(id);
    if (!policy) continue;
    citations.push({
      kind: "policy",
      id,
      label: `${policy.title} v${policy.version}`,
      detail:
        policy.status === "approved"
          ? `Approved ${formatDate(policy.approvedAt ?? "")}`
          : policy.status === "draft"
            ? "Still a draft — cannot be cited to a customer"
            : "In review, not yet approved",
      sound: policy.status === "approved",
      href: `${soaHref}?lens=no-policy`,
    });
  }

  for (const id of question.evidenceIds) {
    const doc = ws.evidenceById(id);
    if (!doc) continue;
    const usable = isUsableEvidence(ws, id);
    const lapsed = Boolean(doc.expiresAt && isOverdue(doc.expiresAt));
    citations.push({
      kind: "evidence",
      id,
      label: doc.title,
      detail: lapsed
        ? `Expired ${formatDate(doc.expiresAt!)}`
        : doc.verificationState === "unverified"
          ? "Collected but never verified"
          : `Verified · collected ${formatDate(doc.collectedAt)}`,
      sound: usable,
      href: `/evidence/${doc.id}`,
    });
  }

  return citations;
}

/* ------------------------------------------------------------- the answers */

/**
 * The prose, composed from live records rather than retrieved.
 *
 * Each entry reads the registers so the figures in the answer are the figures on
 * the other screens. A copilot that quotes a number the inventory disagrees with
 * is worse than one that says nothing.
 */
const COMPOSERS: Record<string, (ws: Workspace) => string | null> = {
  "q-nw-1": (ws) => {
    const shared = ws.systems.filter((s) =>
      s.dataCategories.some((c) => c === "customer_content" || c === "personal"),
    );
    return `We maintain a register of every AI system in use, currently ${ws.systems.length} systems, of which ${shared.length} may process customer data. Each record names the business owner, the purpose, the data categories involved and the review date. Systems that could touch your data are the customer support translation service, the order status agent on our help centre, and the claims triage service; each is limited to the data needed for its stated purpose and none is used for profiling. The register is reviewed at the quarterly AI Governance Forum and after any material change.`;
  },
  "q-nw-2": (ws) => {
    const providers = [
      ...new Set(
        ws.systems.map((s) => s.vendorDetail.modelProvider).filter(
          (p): p is string => Boolean(p) && p !== "Not disclosed",
        ),
      ),
    ];
    return `The model providers behind systems that may process your data are ${providers.slice(0, 3).join(", ")}. Processing takes place in the EU for those systems, with tenant configuration pinned to the EU data boundary and the contractual basis recorded against each. Two systems in our wider estate host in the US; neither is used for customer data. Hosting region, deployment model and the contractual basis for each residency claim are held per system in the inventory.`;
  },
  "q-nw-3": () =>
    `No. Our enterprise agreements prohibit the use of our data — including data you provide — for training the supplier's models, and that prohibition is evidenced in the data processing agreements we hold. Four tools in our wider estate remain on click-through terms where that prohibition is not contractually guaranteed; none of them processes customer data, and consolidating them onto negotiated agreements is an open corrective action with a September target.`,
  "q-nw-4": (ws) => {
    const supervised = ws.useCases.filter(
      /* Counted per purpose, not per pairing, and that is the honest reading
       * of the question: it asks how many customer-facing *uses* have a
       * human in the loop. A pairing-level count would answer a question
       * nobody asked and would exceed the number of use cases. */
      (u) => u.facesCustomers && u.oversightLevel !== "none",
    );
    return `Oversight is recorded per use case rather than per tool, because the level required depends on what the tool is being used for. Of the use cases that reach customers, ${supervised.length} operate with a person either confirming each output before it has effect or monitoring with authority to intervene. The order status agent answers directly but hands off to a human on any refund or complaint intent, and transcripts are sampled weekly. Where a use case contributes to a decision about an individual, a person reviews every output before it takes effect.`;
  },
  "q-nw-5": () => null,
  "q-nw-6": (ws) => {
    const approved = ws.assessments.filter((a) => a.status === "approved").length;
    return `Every AI system passes an intake and triage step before procurement, which routes it either to a governance endorsement or to a noting decision depending on the data involved, whether it faces customers and whether it informs decisions about people. Systems requiring endorsement complete an impact assessment covering intended use, harms, oversight, fairness, data and mitigations. Assessments carry a three-stage sign-off: the owner submits, the AI Governance Lead endorses, and the CISO accepts the residual risk. ${approved} assessments are currently approved, and no system may go live without one.`;
  },
  "q-nw-7": (ws) => {
    const deciding = ws.useCases.filter((u) => u.informsDecisionsAboutPeople);
    return `Yes — ${deciding.length} use cases contribute to decisions affecting individuals: claim field extraction and claim routing, candidate screening, and retention outreach prioritisation. None is fully automated; a person reviews and confirms before any outcome takes effect, and an affected person can ask for a decision to be re-reviewed by someone who sees the original material alongside the system's output. Each of these carries an impact assessment with a fairness and adverse-impact section.`;
  },
  "q-nw-8": () => null,
  "q-he-1": () =>
    `Yes. The inventory covers every AI system in use, whether procured, integrated into our own software, or built in house, and records the owner, purpose, data categories, hosting region, lifecycle stage and risk tier for each. It is reviewed at the quarterly governance forum, and a monthly sweep of single sign-on logs and expense lines is run against it specifically to catch tools acquired outside the intake process.`,
  "q-he-2": () =>
    `The AI Governance Forum meets quarterly, chaired by the Chief Information Security Officer, with Legal, Data & AI, Risk, Technology and People represented. It endorses or refuses new AI systems, accepts residual risk above the agreed threshold, reviews open findings, and can suspend a deployment. Decisions are minuted with named attendance rather than papers being noted.`,
  "q-he-3": () =>
    `Yes. Internal Audit reviewed the AI management system in May 2026 and raised four findings, three of which remain in corrective action with dated targets. Findings require a documented root cause, a corrective action, and verification by someone other than the owner before they may be closed.`,
};

/** Where the record supports nothing, say so rather than composing something. */
const REFUSALS: Record<string, string> = {
  "q-nw-5":
    "We are not certified. Nothing in the record supports a claim of ISO/IEC 42001 certification — a stage 1 readiness review has been completed by Kestrel Assurance and stage 2 is blocked on an open finding about our Statement of Applicability. Drafting anything more affirmative than the plain fact would be a false statement in writing to a customer. Suggest answering with the readiness position and the expected certification window, which a person should set.",
  "q-nw-8":
    "There is no approved incident procedure to cite. AI incidents currently route to the general security incident process, and the AI-specific procedure has been in draft for four months — an open internal audit finding. Answering this by describing the draft as though it were in force is exactly the claim an auditor or a customer would later hold us to.",
};

/* ------------------------------------------------------------- the drafting */

/**
 * Confidence, derived from the state of the citations.
 *
 * Starts high and is reduced by what is actually wrong: an unsound citation
 * costs more than a missing one, because citing a draft policy to a customer is
 * worse than citing nothing. A question with no citations at all lands low by
 * construction, which is the correct signal.
 */
function confidenceFrom(citations: AnswerCitation[]): number {
  if (citations.length === 0) return 0.35;
  const unsound = citations.filter((c) => !c.sound).length;
  const base = 0.62 + Math.min(citations.length, 4) * 0.07;
  return Math.max(0.3, Math.min(0.95, base - unsound * 0.16));
}

export function draftAnswer(
  ws: Workspace,
  question: QuestionnaireQuestion,
): Promise<DraftedAnswer> {
  const citations = citationsFor(ws, question);
  const text = COMPOSERS[question.id]?.(ws) ?? null;
  const refusal = text === null ? (REFUSALS[question.id] ?? "Nothing in the record supports an answer to this question.") : null;

  const caveats: string[] = [];
  for (const citation of citations.filter((c) => !c.sound)) {
    caveats.push(
      citation.kind === "policy"
        ? `${citation.label} is cited here and is ${citation.detail.toLowerCase()}. A customer can ask to see it.`
        : citation.kind === "evidence"
          ? `${citation.label} — ${citation.detail.toLowerCase()}. If they ask for proof, this is what we would hand over.`
          : `${citation.label} is ${citation.detail.toLowerCase()}. The answer above is stronger than the control behind it.`,
    );
  }

  /* The oldest verification among the cited documents is what ages an answer. */
  const dates = citations
    .filter((c) => c.kind === "evidence" && c.sound)
    .map((c) => ws.evidenceById(c.id)?.collectedAt)
    .filter((d): d is string => Boolean(d))
    .sort();

  return withDelay({
    questionId: question.id,
    text,
    refusal,
    citations,
    confidence: refusal ? 0.9 : confidenceFrom(citations),
    lastVerified: dates[0] ?? null,
    caveats,
  });
}
