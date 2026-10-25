import { NextResponse } from "next/server";

import { linkAccountToPerson, unlinkAccountFromPerson } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/account-people  { userId, personId | null, reason? }
 *
 * Which account is which person — the one crossing between Better Auth's users
 * and `ai_person`, and the reason `acting-person.ts` no longer has to record
 * every AI decision as unattributed.
 *
 * **This is a claim, not an inference.** Nothing here matches on name or email:
 * "R. Andersen" the person and `lead@…` the account look like the same human
 * and a product that assumes it will eventually put the wrong name on a
 * signature. Somebody with `member: ["update"]` says so, and the trail records
 * that they said it.
 *
 * **It is deliberately an admin permission rather than a self-service one.**
 * Choosing which person you act as is choosing which records you are the owner,
 * the assignee and the approver of — a member who could set their own would be
 * appointing themselves to a stage, which is exactly what `review: ["assign"]`
 * is kept away from reviewers to prevent. Nothing here treats the caller
 * specially, so an admin setting their own is an ordinary, audited act.
 *
 * A `personId` of null clears the link, so both halves of one decision take one
 * shape and one guard. Clearing says nothing about the past: records already
 * written keep the person they name, and history is never back-filled.
 *
 * The audit row is not written here. `linkAccountToPerson` takes an `Actor` and
 * emits its own entry against the `member` subject, which is where the access
 * trail on the members screen reads from.
 */

export async function POST(request: Request) {
  // Guard before the body is read: work done ahead of the check is work an
  // unauthorised caller got for free. `route-guards.test.ts` asserts it.
  const auth = await requirePermission(
    { member: ["update"] },
    "say which person an account acts as",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId: actorUserId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { userId, personId, reason } = body as Record<string, unknown>;

  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "A user id is required." }, { status: 400 });
  }

  /* Saying who somebody is, is a governed act — so a note is carried when one is
   * given and not demanded when it is not. The common case is filling an empty
   * seat, which needs no justification, and demanding one there trains people to
   * type "n/a". */
  const actor = {
    userId: actorUserId,
    reason: typeof reason === "string" ? cleanLine(reason) : null,
  };

  if (personId === null || personId === undefined || personId === "") {
    await unlinkAccountFromPerson(organizationId, userId, actor);
    return NextResponse.json({ ok: true, userId, personId: null });
  }

  if (typeof personId !== "string") {
    return NextResponse.json(
      { error: "A person id must be a string, or null to clear the link." },
      { status: 400 },
    );
  }

  const outcome = await linkAccountToPerson(organizationId, { userId, personId }, actor);

  if (!outcome.ok) {
    /* Refused rather than 500ed, and named rather than generic: each of these
     * has a different fix, and a caller told only "that failed" cannot pick one.
     * A stale id in a form is an ordinary mistake, not an exceptional one. */
    const message: Record<typeof outcome.reason, string> = {
      not_a_member: "That account is not a member of this organization.",
      unknown_person: "There is no such person in this organization.",
      person_taken:
        "Another account already acts as that person. Clear that one first — two accounts acting as one person would make every approval check pass for both.",
    };
    return NextResponse.json(
      { error: message[outcome.reason] },
      { status: outcome.reason === "person_taken" ? 409 : 400 },
    );
  }

  return NextResponse.json({ ok: true, userId, personId });
}
