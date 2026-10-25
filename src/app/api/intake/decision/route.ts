import { NextResponse } from "next/server";

import { readIntakeRequest, saveIntakeRequest } from "@/lib/ai-store";
import { triage } from "@/lib/ams/fixtures/intake";
import { STATUS_AFTER, isSettled } from "@/lib/ams/intake-create";
import { cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/intake/decision — record what a reviewer settled on.
 *
 * **A settled decision is written once and never edited.** The value of the
 * record is that it says what was decided at the time, so a request that
 * already carries one is refused rather than overwritten — the screen disables
 * its own controls afterwards, and this is the half of that which a second tab
 * cannot get around.
 *
 * **"Needs more info" is the exception, and it is not a hole in the rule.** It
 * is a decision that asks a question rather than answering one: the request
 * stays open, the queue goes on counting the days it has waited, and its own
 * blurb says nothing is registered "until it comes back". Refusing the second
 * decision there protects no record — it strands the request, unanswerable, with
 * no way back into the queue but deleting it and losing the reference somebody
 * has already quoted in an email. `isSettled` is where that line is drawn, and
 * the screen reads the same predicate so it cannot offer what this refuses.
 *
 * **A departure from the recommendation needs a reason, in the route.** The
 * triage rules suggest endorsement or noting; a reviewer may disagree, and the
 * record is only worth keeping if it says why. Same shape as the rule that
 * accepting a residual risk requires a written justification: the screen asks
 * for it, and the route is what makes it true.
 *
 * **The departure is measured against the rules as they stand, recomputed here
 * — not against the stored `reviewType`.** The review screen has always printed
 * the live recommendation as *the* recommendation, so that is what the reviewer
 * is departing from or agreeing with, and the justification they are asked for
 * is only meaningful against the thing they were shown. Reading the stored field
 * instead let the two disagree: a request raised before a rule changed would
 * demand a justification from somebody clicking the button its own screen marked
 * "recommended", and would accept a real departure in silence.
 *
 * The stored field is still written, and still worth having — it is what the
 * rules said when the request was raised, which is what an export and an
 * auditor want. It is simply not a gate.
 *
 * The decision does not mutate the submission. What the requester said and what
 * the reviewer concluded are separate records — collapsing them would lose the
 * ability to show a decision made against an answer that has since changed, and
 * an answer corrected through `PATCH /api/intake/:id` is exactly that case.
 */

const DECISIONS = new Set(Object.keys(STATUS_AFTER));

export async function POST(request: Request) {
  const auth = await requirePermission(
    { intake: ["update"] },
    "decide an intake request",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId, personId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { id, decision, reviewType, overrideJustification, comments } = body as {
    id?: unknown;
    decision?: unknown;
    reviewType?: unknown;
    overrideJustification?: unknown;
    comments?: unknown;
  };

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Which request?" }, { status: 400 });
  }

  if (typeof decision !== "string" || !DECISIONS.has(decision)) {
    return NextResponse.json(
      { error: "That is not a decision this queue recognises." },
      { status: 400 },
    );
  }

  if (reviewType !== "endorsement" && reviewType !== "noting") {
    return NextResponse.json(
      { error: "A decision has to say which kind of review it was." },
      { status: 400 },
    );
  }

  const existing = await readIntakeRequest(organizationId, id);
  if (!existing) {
    return NextResponse.json(
      { error: "That request is not in your queue." },
      { status: 404 },
    );
  }

  if (isSettled(existing.decision)) {
    /* Already settled. Refused rather than overwritten: the record's whole
     * value is that it says what was decided at the time, and a second tab
     * left open is exactly how that gets quietly rewritten. A request returned
     * for more information settled nothing and is not caught here. */
    return NextResponse.json(
      { error: "That request has already been decided." },
      { status: 409 },
    );
  }

  const justification = cleanText(overrideJustification, 2000);
  const departed = reviewType !== triage(existing.submission).suggested;

  if (departed && !justification.trim()) {
    return NextResponse.json(
      {
        error:
          "You have changed the review type the rules suggested. Say why — the record is only useful if it explains the departure.",
      },
      { status: 400 },
    );
  }

  await saveIntakeRequest(
    organizationId,
    {
      ...existing,
      status: STATUS_AFTER[decision] ?? existing.status,
      reviewType,
      overrideJustification: departed ? justification : null,
      decision,
      /* The person behind the account, or nobody — never a guess. A decision
       * attributed to the wrong reviewer is worse than one attributed to none. */
      decidedById: personId ?? "",
      decidedAt: new Date().toISOString().slice(0, 10),
      comments: cleanText(comments, 4000),
    },
    { userId },
  );

  return NextResponse.json({ ok: true });
}
