import { NextResponse } from "next/server";

import { saveIntakeNote } from "@/lib/ai-store";
import { MAX_NOTE, MIN_NOTE, newNoteId } from "@/lib/ams/intake-create";
import { cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/intake/:id/notes — add something to a request after the fact.
 *
 * **There is no PATCH and no DELETE here, and there is not going to be.** A
 * note is an addition to the record, not a revision of it: the DPA came back
 * signed, the vendor was acquired, the pilot ran a quarter longer than asked
 * for. Every one of those is a thing that became true later, and none of them
 * makes what was said before untrue. Letting somebody rewrite a note they sent
 * a requester three months ago would put the one part of this record that is an
 * account of a *conversation* on the same footing as the submission, which is
 * an account of a system and is supposed to be correctable. Correcting a note
 * means adding another that says so.
 *
 * This is the answer to "let me edit the decision comments", and a better one:
 * the comments field holds what the requester was told at the moment of the
 * decision, and it stays holding exactly that.
 *
 * **Gated on `intake: ["update"]`, not `["create"]`.** `create` is the statement
 * for raising a request through the form, held by anybody who can ask for
 * anything. Adding to the record of a decided request is the reviewer's side of
 * the conversation and belongs with editing and deciding — which also means a
 * `reviewer` and an `auditor` cannot write here, the same as everywhere else on
 * this screen.
 *
 * The request is resolved inside the caller's organisation by the store before
 * anything is written, so a note aimed at another tenant's request is a 404
 * rather than a foreign key error.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { intake: ["update"] },
    "add a note to an intake request",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId, personId } = auth.ctx;

  const { requestId } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const body = cleanText((payload as { body?: unknown }).body, MAX_NOTE);

  if (body.trim().length < MIN_NOTE) {
    return NextResponse.json(
      { error: "A note needs something in it." },
      { status: 400 },
    );
  }

  const added = await saveIntakeNote(
    organizationId,
    {
      id: newNoteId(),
      requestId,
      /* The person behind the account, or nobody — never a guess, the same rule
       * the decision follows. A note attributed to the wrong person is worse
       * than one attributed to none. */
      authorId: personId ?? null,
      body,
      createdAt: new Date().toISOString(),
    },
    { userId },
  );

  if (!added) {
    return NextResponse.json(
      { error: "That request is not in your queue." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
