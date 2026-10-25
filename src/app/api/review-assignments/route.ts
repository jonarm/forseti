import { NextResponse } from "next/server";

import { assignReviewer, unassignReviewer } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { AuditSubjectKind } from "@/lib/audit";

/**
 * POST /api/review-assignments — who reviews this record, at this stage.
 *
 * The route behind `ai_review_assignment`, and the reason that table is not a
 * second copy of the sign-off chain. **The assignment says who *should* review a
 * stage; `signOff[]` on the assessment says where the chain has got to and
 * when.** Who, and where — a split, not a duplicate.
 *
 * `signOff[].assigneeId` is an `ai_person` and `assigneeUserId` here is an
 * account. Those are still different spaces and this route still records the
 * account — an assignment names somebody who has to sign in — but they are no
 * longer incomparable: `ai_account_person` records who an account is, and the
 * reviewer panel resolves each row through it, so a reader sees one human under
 * both names. What has not changed is that the chain itself is still local
 * state, so nothing gates on that resolution. **Do not make the sign-off bar
 * check identity until advancing the chain persists** — a gate over state that
 * disappears on refresh is a claim the code cannot keep.
 *
 * **Assigning is deliberately not a reviewer's permission.** `review: ["assign"]`
 * sits with the governance lead, because a reviewer who can appoint their own
 * reviewer has emptied the approval of meaning, and the resulting record looks
 * exactly like a properly assigned one.
 *
 * A clearing is `POST` with no assignee rather than a `DELETE`, so both halves
 * of one decision take one shape and one guard.
 */

/** Stages a record can carry. Text in the database; a closed set at the door. */
const STAGES = ["legal", "security", "privacy", "exec_sponsor", "governance"] as const;
type Stage = (typeof STAGES)[number];

/**
 * What can be assigned against.
 *
 * Narrower than `AuditSubjectKind` on purpose: the vocabulary has fifteen kinds
 * and only these carry a review workflow. Accepting the wider set would let a
 * caller create an assignment against a `member` or an `organization`, which
 * nothing renders and nothing would ever clear.
 */
const SUBJECTS: AuditSubjectKind[] = ["assessment", "system", "use_case", "finding"];

function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

function isSubject(value: unknown): value is AuditSubjectKind {
  return typeof value === "string" && (SUBJECTS as string[]).includes(value);
}

export async function POST(request: Request) {
  // Guard first, before the body is read. `route-guards.test.ts` fails a handler
  // that parses anything ahead of this, because work done before a check is
  // work an unauthorised caller got for free.
  const auth = await requirePermission(
    { review: ["assign"] },
    "assign a reviewer",
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

  const { subjectKind, subjectId, stage, assigneeUserId, reason } = body as Record<
    string,
    unknown
  >;

  if (!isSubject(subjectKind)) {
    return NextResponse.json(
      { error: `A subject kind is required, one of: ${SUBJECTS.join(", ")}.` },
      { status: 400 },
    );
  }
  if (typeof subjectId !== "string" || subjectId.trim() === "") {
    return NextResponse.json({ error: "A subject id is required." }, { status: 400 });
  }
  if (!isStage(stage)) {
    return NextResponse.json(
      { error: `A stage is required, one of: ${STAGES.join(", ")}.` },
      { status: 400 },
    );
  }

  /* Reassignment is a governed act — somebody was accountable for this stage and
   * now somebody else is — so a note is carried when one is given. It is not
   * demanded: the common case is filling an empty stage, which needs no
   * justification, and demanding one there trains people to type "n/a". */
  const actor = {
    userId,
    reason: typeof reason === "string" ? cleanLine(reason) : null,
  };

  // No assignee clears the stage. The same decision, the other direction.
  if (assigneeUserId === null || assigneeUserId === undefined || assigneeUserId === "") {
    await unassignReviewer(
      organizationId,
      { kind: subjectKind, id: subjectId, stage },
      actor,
    );
    return NextResponse.json({ ok: true, assigneeUserId: null });
  }

  if (typeof assigneeUserId !== "string") {
    return NextResponse.json(
      { error: "An assignee must be a user id, or null to clear the stage." },
      { status: 400 },
    );
  }

  /* The store checks the assignee against this organization's own membership and
   * answers false rather than throwing — a stale id in a form is an ordinary
   * mistake, and 404 says what happened better than a 500 would. */
  const landed = await assignReviewer(
    organizationId,
    { subjectKind, subjectId, stage, assigneeUserId },
    actor,
  );

  if (!landed) {
    return NextResponse.json(
      { error: "That person is not a member of this organization." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, assigneeUserId });
}
