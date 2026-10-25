import { NextResponse } from "next/server";

import { readAiEvidence, readAiSystem, saveAiEvidence } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/records/evidence/unlink — detach documents from a system.
 *
 * The inverse of `./link`, and it removes an `ai_evidence_link` row rather than
 * the document: the register keeps it, every other system it supports keeps it,
 * and nothing about the file changes. Deleting a document is `./delete` and a
 * different act with a different answer.
 *
 * **`evidence: ["delete"]`, where linking asks for `["create"]`.** The resource
 * has no `update` statement, so the pair is create-and-delete rather than one
 * update — which is the honest reading anyway, because the thing being written
 * and removed is the link row. Every role that holds one of the two holds both,
 * so this is a statement of what the act *is* rather than a new restriction.
 *
 * **Unlinking the last system makes a document organisation-wide, and that is
 * allowed.** An empty `linkedSystemIds` does not mean detached: `workspace.ts`
 * reads it as covering every system, so this call can *widen* a document's
 * reach rather than narrow it. Refusing would be the tidier-looking rule and
 * the wrong one — it would leave a document filed against one system by mistake
 * with no path to becoming organisation-wide, because linking it elsewhere and
 * unlinking here lands back at one link. So the route allows it and the dialog
 * says the consequence in words before anybody ticks the box.
 *
 * **A document not linked to this system is refused by name**, rather than
 * treated as already done. The caller is working from a list of what this
 * system has; an id that is not on it means the page is stale, and saying so
 * is more use than a silent success.
 */

/** More than a screenful of ticks is a script, not somebody choosing documents. */
const MAX_IDS = 200;

export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { evidence: ["delete"] },
    "unlink evidence from a system",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { systemId: askedSystem, evidenceIds } = body as Record<string, unknown>;

  if (typeof askedSystem !== "string" || askedSystem.trim() === "") {
    return NextResponse.json({ error: "A system id is required." }, { status: 400 });
  }
  const systemId = cleanLine(askedSystem);

  const ids = readIds(evidenceIds);
  if (!ids) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_IDS} document ids.` },
      { status: 400 },
    );
  }

  /* Resolved in the caller's own organisation. Nothing here would write another
   * tenant's row — the documents are read from this organisation's register —
   * but a caller naming a system they cannot see is answered rather than
   * quietly told that nothing was linked. */
  const system = await readAiSystem(organizationId, systemId);
  if (!system) {
    return NextResponse.json(
      { error: "That system is not in this organisation's inventory." },
      { status: 400 },
    );
  }

  const register = await readAiEvidence(organizationId);
  const byId = new Map(register.map((doc) => [doc.id, doc]));

  const unlinked: { id: string; title: string; nowOrgWide: boolean }[] = [];
  const refused: { id: string; title: string | null; reason: string }[] = [];

  for (const id of ids) {
    const doc = byId.get(id);

    if (!doc) {
      refused.push({ id, title: null, reason: "That document is not in this register." });
      continue;
    }

    if (!doc.linkedSystemIds.includes(systemId)) {
      refused.push({
        id,
        title: doc.title,
        reason: `Not linked to ${system.name}.`,
      });
      continue;
    }

    const remaining = doc.linkedSystemIds.filter((linked) => linked !== systemId);
    await saveAiEvidence(organizationId, { ...doc, linkedSystemIds: remaining }, { userId });

    unlinked.push({
      id,
      title: doc.title,
      /* Reported rather than inferred: the caller was warned before ticking it,
       * and the answer should confirm which way it went. */
      nowOrgWide: remaining.length === 0,
    });
  }

  return NextResponse.json({ ok: true, unlinked, refused });
}

/** A list of non-empty strings, deduplicated, within the cap. */
function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = [
    ...new Set(
      value
        .filter((id): id is string => typeof id === "string" && id.trim() !== "")
        .map((id) => cleanLine(id)),
    ),
  ];
  if (ids.length === 0 || ids.length > MAX_IDS) return null;
  return ids;
}
