import { NextResponse } from "next/server";

import { readIntakeRequest, saveIntakeRequest } from "@/lib/ai-store";
import { QUESTION_SETS, triage } from "@/lib/ams/fixtures/intake";
import { isSettled } from "@/lib/ams/intake-create";
import { INTAKE_PATCH_SCHEMA } from "@/lib/ams/intake-patch";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { IntakeSubmission, SystemOrigin } from "@/lib/ams/types";

/**
 * PATCH /api/intake/:id — correct what a request says about itself.
 *
 * A sub-path rather than the bare one, because intake inverts the convention
 * the other registers follow: `POST /api/intake` is already the *create* route,
 * so the edit route takes the id in the path the way `PATCH /api/systems/:id`
 * does — which is also the route the shared field editors are built against.
 *
 * **Read, merge, write — and the read is the tenant boundary, not a null check.**
 * `saveIntakeRequest` upserts on `(organizationId, id)`, so patching an id
 * belonging to another organisation would not fail: it would create a new row
 * here carrying their id, plausibly and silently. Resolving the row inside this
 * organisation first is what makes that a 404. The merge matters twice over —
 * the upsert sets every column, and the schema only ever names fields inside
 * `submission`, so writing the patch straight through would blank the record.
 *
 * **The decision is untouchable from here, by omission rather than by a check.**
 * `INTAKE_PATCH_SCHEMA` cannot name `decision`, `status`, `decidedAt` or the
 * rest, and it is `strict()`, so an attempt to send one is refused at the door.
 * A decided request is still editable — the submission and the decision are
 * separate records on purpose, and the panel is built to show a decision made
 * against an answer that has since changed rather than to hide the disagreement.
 *
 * **The stored recommendation follows the answers while the request is open.**
 * `reviewType` holds what triage suggested, and the review screen offers it as
 * the reviewer's starting position. Left stale after a correction it would
 * pre-select a review type the rules no longer recommend, on the same screen
 * that is printing the current recommendation beside it. So it is recomputed
 * here from the merged submission — including for a request returned for more
 * information, which is precisely the case where the answers are expected to
 * change. Once a decision has *settled* the request, `reviewType` is no longer a
 * recommendation but what the reviewer chose, and it does not move again.
 *
 * The activity trail is not written here. `saveIntakeRequest` diffs the stored
 * row against the one it is handed and records the entries itself, down to the
 * individual answer.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  // First, and before the body or the row is read.
  const auth = await requirePermission(
    { intake: ["update"] },
    "edit an intake request",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  const { requestId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = INTAKE_PATCH_SCHEMA.safeParse(body ?? {});
  if (!parsed.success) {
    // Per field, so the editor that sent it can say what to retype. "That could
    // not be saved" on a screen of editors names nothing.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That change could not be saved as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const existing = await readIntakeRequest(organizationId, requestId);
  if (!existing) {
    return NextResponse.json(
      { error: "That request is not in your queue." },
      { status: 404 },
    );
  }

  const { originAnswers, ...fields } = parsed.data;
  const before = existing.submission;
  const origin = fields.origin ?? before.origin;

  /*
   * Moving the origin empties the answers, and this is a correctness rule
   * rather than tidiness. `toValueBag` spreads `originAnswers` to the top level
   * so a triage rule can name `saas_dpa` directly — a leftover "the vendor may
   * train on our data" answer would keep escalating a request that is now an
   * internal model with no vendor in it at all. The answers cannot be carried
   * across because the two question sets share no field ids, so the honest move
   * is to clear them, visibly, with the audit entries saying what was cleared.
   */
  const kept = fields.origin && fields.origin !== before.origin ? {} : before.originAnswers;

  const submission: IntakeSubmission = {
    ...before,
    ...fields,
    name: fields.name === undefined ? before.name : cleanLine(fields.name),
    description:
      fields.description === undefined
        ? before.description
        : cleanText(fields.description, 4000),
    businessUnit:
      fields.businessUnit === undefined
        ? before.businessUnit
        : cleanLine(fields.businessUnit),
    vendor: fields.vendor === undefined ? before.vendor : cleanLine(fields.vendor),
    originAnswers: originAnswers
      ? { ...kept, ...answersFor(origin, originAnswers) }
      : kept,
  };

  await saveIntakeRequest(
    organizationId,
    {
      ...existing,
      submission,
      reviewType: isSettled(existing.decision)
        ? existing.reviewType
        : triage(submission).suggested,
    },
    { userId },
  );

  // Return the saved row so the screen picks up what was actually stored rather
  // than believing the value it sent.
  const saved = await readIntakeRequest(organizationId, requestId);
  return NextResponse.json({ ok: true, request: saved });
}

/**
 * The answers this origin's question set actually asks for, cleaned.
 *
 * Keys outside the set are dropped rather than stored, and that is the second
 * half of the rule above: without it a caller could write `saas_dpa` onto an
 * internal-model request and escalate it through a rule whose question was
 * never put to anybody. Free text is cleaned here rather than at the point it
 * is read, so every later reader — the triage panel, an export, a prompt —
 * gets the cleaned value without having to remember to ask.
 */
function answersFor(
  origin: SystemOrigin | null,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  if (!origin) return {};

  const asked = new Set(QUESTION_SETS[origin].fields.map((field) => field.id));
  const out: Record<string, unknown> = {};

  for (const [id, value] of Object.entries(answers)) {
    if (!asked.has(id)) continue;

    if (typeof value === "string") out[id] = cleanText(value, 2000);
    else if (Array.isArray(value)) {
      out[id] = value.map((item) => cleanLine(item)).filter(Boolean);
    } else out[id] = value;
  }

  return out;
}
