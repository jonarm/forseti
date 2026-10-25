import { NextResponse } from "next/server";

import { actingPersonId } from "@/lib/acting-person";
import {
  readWorkspace,
  saveApplicability,
  saveAssessmentAnswers,
  saveSuggestion,
} from "@/lib/ai-store";
import { needsMoreJustification } from "@/lib/ams/applicability-patch";
import { workspace } from "@/lib/ams/workspace";
import { cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { Actor } from "@/lib/audit";
import type { SuggestionStatus } from "@/lib/ams/types";

/**
 * POST /api/suggestions  { suggestionId, status, text? }
 *
 * What a person decided about a proposal — and, when they accepted it, the write
 * into the record they decided about.
 *
 * **Both halves or neither.** Persisting the decision without the target write
 * is the subtle failure this route exists to avoid: the card comes back from the
 * database saying "accepted by X" while the justification field is still empty,
 * which is precisely the property `SuggestionCard` claims to guarantee. So an
 * acceptance writes the suggestion *and* the record it was about.
 *
 * The audit trail is not written here. Every store write takes an `Actor`, and
 * this route's actor carries `viaSuggestionId` — so the trail records that the
 * model proposed and this person disposed, without the route having to remember
 * to log it. A trail written by the caller is a trail somebody eventually
 * forgets to write.
 *
 * A rejection writes only the suggestion. The record is left exactly as the
 * person left it, and the rejected proposal stays visible: an assistant that
 * keeps only its accepted suggestions is keeping a record of its own wins, and
 * the thing worth proving is that somebody was able to say no.
 *
 * Not under `/api/ai/` and not rate limited — deciding costs nothing and must
 * never be refused because drafting was noisy. It is a normal mutating route,
 * so it carries a permission and nothing more.
 */

const DECISIONS: SuggestionStatus[] = ["accepted", "edited", "rejected"];

function isDecision(value: unknown): value is SuggestionStatus {
  return typeof value === "string" && (DECISIONS as string[]).includes(value);
}

export async function POST(request: Request) {
  // Deciding writes to the register, so it is a permission rather than mere
  // membership. `answer: ["update"]` is the working loop — evidencing and
  // answering are contributor work, and accepting a drafted justification is
  // the same act. It deliberately is not `control: ["update"]`, which is the
  // library's *shape* and admin-only.
  const auth = await requirePermission(
    { answer: ["update"] },
    "accept or reject a drafted suggestion",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { suggestionId, status, text } = body as Record<string, unknown>;

  if (typeof suggestionId !== "string" || suggestionId.trim() === "") {
    return NextResponse.json({ error: "A suggestion id is required." }, { status: 400 });
  }
  if (!isDecision(status)) {
    return NextResponse.json(
      { error: "A decision must be accepted, edited or rejected." },
      { status: 400 },
    );
  }

  const data = await readWorkspace(organizationId, {});
  const ws = workspace(data);

  // Resolved from this tenant's own workspace, so an id from another
  // organization is simply not found rather than being decided on.
  const suggestion = ws.suggestionById(suggestionId);
  if (!suggestion) {
    return NextResponse.json({ error: "That suggestion no longer exists." }, { status: 404 });
  }
  if (suggestion.status !== "pending") {
    return NextResponse.json(
      { error: "That suggestion has already been decided." },
      { status: 409 },
    );
  }

  const writes = status === "accepted" || status === "edited";

  /*
   * The edited text is the one piece of free text this route accepts, and it
   * goes into a record a customer may eventually read, so it is cleaned. It is
   * never sent to a model from here — but the next feature to read this field
   * will, and text that was stored raw is text somebody has to remember to
   * sanitise later.
   */
  const edited = status === "edited" && typeof text === "string" ? cleanText(text) : null;
  const finalText = edited ?? suggestion.recommendation;

  /*
   * An accepted draft is a write into the applicability row, so it is held to
   * the rule `POST /api/applicability` enforces: a control the organisation has
   * put out of scope cannot end up carrying no reason.
   *
   * The two routes write the same column under the same statement, and the card
   * hands the person a free textarea — so a floor only one of them checked would
   * be a floor anybody could step over by drafting first, then replacing the
   * draft with "n/a". The rule is evaluated against the row as it would end up,
   * the same way it is there.
   *
   * **Refused outright rather than recorded-but-not-applied.** This route's
   * whole argument is both halves or neither, and a decision stored without its
   * write is precisely the state it exists to prevent.
   */
  if (writes && suggestion.target.kind === "control") {
    const row = ws.applicabilityFor(suggestion.target.id);
    if (row && needsMoreJustification({ ...row, justification: finalText })) {
      return NextResponse.json(
        {
          error:
            "This control is out of scope, so its justification cannot be left this short. Say why the organisation does not have to satisfy it.",
        },
        { status: 400 },
      );
    }
  }

  /*
   * `decidedById` is an `ai_person`; the actor is a Better Auth user. They are
   * deliberately different sets — a control owner frequently has no account —
   * and neither is derivable from the other, so the crossing is a claim somebody
   * recorded in `ai_account_person` rather than an inference from a matching
   * name. `requireOrgContext()` resolved it; this reads it.
   *
   * An account nobody has matched still decides unattributed rather than naming
   * a plausible person, and that is the normal path for a new seat rather than a
   * failure. The *account* is recorded correctly either way: `actor` below
   * carries the real `userId` and `writeAudit` persists it. See
   * `acting-person.ts`.
   */
  const decidedById = actingPersonId(auth.ctx);
  const decidedAt = new Date().toISOString();

  const actor: Actor = {
    userId,
    reason:
      status === "rejected"
        ? "Rejected an AI draft."
        : status === "edited"
          ? "Accepted an AI draft after editing it."
          : "Accepted an AI draft as written.",
    // What makes "the model proposed, a person disposed" provable rather than
    // merely plausible: the trail names both halves.
    viaSuggestionId: suggestion.id,
  };

  await saveSuggestion(
    organizationId,
    { ...suggestion, status, decidedById, decidedAt, editedText: edited },
    actor,
  );

  if (writes) {
    await applyToTarget(organizationId, ws, suggestion.target, finalText, actor);
  }

  return NextResponse.json({ ok: true, status, decidedById, decidedAt, text: finalText });
}

/**
 * Write the accepted text into whatever the suggestion was about.
 *
 * Does nothing when the target no longer resolves — a control removed from the
 * framework between drafting and accepting leaves the decision recorded and
 * writes nothing, which is the safe direction to fail. The store writes the
 * trail from `actor`, so there is nothing to report back.
 */
async function applyToTarget(
  organizationId: string,
  ws: ReturnType<typeof workspace>,
  target: { kind: string; id: string },
  text: string,
  actor: Actor,
): Promise<void> {
  if (target.kind === "control") {
    const row = ws.applicabilityFor(target.id);
    if (!row) return;
    // The applicability row, not the control: what changed is this
    // organisation's decision about the control. The control itself is unmoved.
    await saveApplicability(organizationId, { ...row, justification: text }, actor);
    return;
  }

  if (target.kind === "field" || target.kind === "section") {
    // Assessment targets are `<assessmentId>.<fieldId>` — the dotted convention
    // the seeded suggestions already use for a record-plus-attribute address.
    const dot = target.id.indexOf(".");
    if (dot < 1) return;

    const assessmentId = target.id.slice(0, dot);
    const fieldId = target.id.slice(dot + 1);

    if (!ws.assessmentById(assessmentId)) return;

    /*
     * Material, and therefore the sign-off chain resets.
     *
     * A reviewer endorsed a document containing a particular answer; replacing
     * that answer with a drafted one means they endorsed something else. This
     * will surprise somebody mid-review, and it is meant to — carrying an
     * endorsement forward silently is how a signature ends up attached to text
     * nobody read.
     */
    await saveAssessmentAnswers(
      organizationId,
      assessmentId,
      { [fieldId]: text },
      actor,
      { materialChange: true },
    );
    return;
  }

  // `triage` suggestions are decided on the intake screen, which writes the
  // request itself. Nothing to apply here.
}
