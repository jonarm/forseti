import { NextResponse } from "next/server";

import { readApplicability, saveApplicability } from "@/lib/ai-store";
import {
  APPLICABILITY_PATCH_SCHEMA,
  MIN_JUSTIFICATION,
  needsMoreJustification,
} from "@/lib/ams/applicability-patch";
import { can, refusalNote } from "@/lib/permissions";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { ControlApplicability } from "@/lib/ams/types";

/**
 * POST /api/applicability — change what this organisation has decided about one
 * control.
 *
 * The route `/api/applicability/claim` was written as a sub-path to leave free.
 * Until it existed, every edit on the Statement of Applicability workbench lived
 * in React state layered over the server render: applicability, implementation
 * status, owner and linked policy survived until the next refresh and no
 * further. The single exception was a justification accepted from an AI draft,
 * which `/api/suggestions` wrote through `saveApplicability` — so the one field
 * a person could not type by hand was the one the model could write for them.
 *
 * **Read, merge, write, and the read is not a null check.** `saveApplicability`
 * takes a whole row and rewrites both of its join tables by deleting and
 * re-inserting (`ai_applicability_system`, and `ai_evidence_link` through the
 * evidence side). A route that wrote the client's copy of the row would take one
 * stale page-load and silently un-claim every system somebody else had claimed
 * in the meantime. So the current row is read here and the patch is applied on
 * top of it; `APPLICABILITY_PATCH_SCHEMA` cannot name a join at all.
 *
 * **Two statements, because the panel holds two different kinds of decision.**
 *
 *   - `answer: ["update"]` is the floor, checked before the body is read. It is
 *     the working loop — the statement `/api/suggestions` already checks to
 *     write this very field, on the argument that evidencing and answering are
 *     contributor work rather than admin work.
 *   - `framework: ["update"]` is checked *in addition*, and only for a patch
 *     that moves `applicability`. Scope is the governance lead's call: a system
 *     owner evidences the framework and cannot change what it says, which is the
 *     single line between those two roles.
 *
 * A second check inside a route is unusual here and is the honest shape for
 * this one. Gating the whole route on `framework: ["update"]` would leave a
 * system owner able to accept an AI-drafted justification through
 * `/api/suggestions` and unable to type the same sentence themselves, which is
 * not a rule anybody could explain.
 *
 * **An exclusion demands prose, and the rule is checked against the merged
 * row.** A control marked "no" or "na" with nothing written is the finding an
 * auditor opens with. Checking the patch instead would refuse somebody changing
 * the owner of an already-excluded control, and would let somebody excluding a
 * control escape by sending the two fields in two requests.
 *
 * The floor lives in `needsMoreJustification` because this is not the only route
 * that writes the field: `/api/suggestions` writes it too, under the same
 * statement, from a card that hands the person a free textarea. A rule only one
 * of them checked would be a rule anybody could step over by drafting first.
 *
 * **No `expectedVersion`.** `ControlApplicability` has no version column, and
 * the workbench commits one field at a time — two people editing different
 * fields of the same row is ordinary, and refusing the second would be wrong
 * more often than right. The same judgement `/api/systems/[systemId]` records
 * for the profile editors, minus the opt-in check, because there is no version
 * to opt in with.
 */
export async function POST(request: Request) {
  /* The floor, first and before the body is read. The scope check needs to know
   * what the patch says, so it comes after the parse — but nobody without the
   * working-loop statement gets that far. */
  const auth = await requirePermission(
    { answer: ["update"] },
    "edit the Statement of Applicability",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId, role, grants } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const {
    frameworkId: askedFramework,
    controlId: askedControl,
    ...fields
  } = body as Record<string, unknown>;

  if (typeof askedFramework !== "string" || askedFramework.trim() === "") {
    return NextResponse.json({ error: "A framework id is required." }, { status: 400 });
  }
  if (typeof askedControl !== "string" || askedControl.trim() === "") {
    return NextResponse.json({ error: "A control id is required." }, { status: 400 });
  }
  const frameworkId = cleanLine(askedFramework);
  const controlId = cleanLine(askedControl);

  const parsed = APPLICABILITY_PATCH_SCHEMA.safeParse(fields);
  if (!parsed.success) {
    // Per field, so the editor that sent it can say what to retype. "That could
    // not be saved" on a screen of a hundred rows names nothing.
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

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "That change named no fields." }, { status: 400 });
  }

  if (patch.applicability !== undefined) {
    const action = "change what the Statement of Applicability says is in scope";
    if (!can(role, { framework: ["update"] }, grants)) {
      return NextResponse.json({ error: refusalNote(action) }, { status: 403 });
    }
  }

  /* Resolved in the caller's own organisation. `saveApplicability` upserts on
   * (organizationId, frameworkId, controlId), so a control id this tenant does
   * not have would not fail — it would create a row, plausibly and silently. */
  const rows = await readApplicability(organizationId, frameworkId);
  const existing = rows.find((row) => row.controlId === controlId);
  if (!existing) {
    return NextResponse.json(
      { error: "That control is not in this framework's Statement of Applicability." },
      { status: 404 },
    );
  }

  const next: ControlApplicability = { ...existing, ...sanitise(patch) };

  if (needsMoreJustification(next)) {
    return NextResponse.json(
      {
        error:
          "Taking a control out of scope needs a written reason. Say why this organisation does not have to satisfy it.",
        fields: {
          justification: `At least ${MIN_JUSTIFICATION} characters. An exclusion nobody explained is the first thing an auditor asks about.`,
        },
      },
      { status: 400 },
    );
  }

  await saveApplicability(organizationId, next, { userId });

  return NextResponse.json({ ok: true, row: next });
}

/**
 * Anything a person typed is cleaned before it is stored, not before it is shown.
 *
 * A justification reaches a prompt later — `/api/ai/draft-justification` reads
 * the neighbouring rows for context — so cleaning at the point of storage means
 * every later reader gets the cleaned text rather than each one remembering to
 * ask for it.
 *
 * `ownerId` arrives as the empty string when the select says "unassigned", and
 * the column is nullable: an empty string owner is a row that looks assigned to
 * nobody named, which reads differently from an unassigned one.
 */
function sanitise(patch: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...patch };

  if (typeof clean.justification === "string") {
    clean.justification = cleanText(clean.justification);
  }
  if (typeof clean.ownerId === "string") {
    clean.ownerId = cleanLine(clean.ownerId) || null;
  }
  if (typeof clean.linkedPolicyId === "string") {
    clean.linkedPolicyId = cleanLine(clean.linkedPolicyId) || null;
  }

  return clean;
}
