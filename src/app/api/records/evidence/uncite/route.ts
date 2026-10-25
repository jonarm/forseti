import { NextResponse } from "next/server";

import { readAiEvidence, saveAiEvidence } from "@/lib/ai-store";
import { readCitation } from "@/lib/ams/evidence-citation";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/records/evidence/uncite — take documents off a control.
 *
 * The inverse of `./cite`, and the plain one of the four link routes. Nothing
 * here deletes anything: the document stays in the register, keeps every system
 * it supports and keeps every other control it proves. The control stays in the
 * Statement of Applicability. What is removed is the claim that this document
 * demonstrates this control — which is the right act when the wrong file was
 * ticked, and the destructive act on a document is Remove on its own register.
 *
 * **Removing the last citation needs no warning, and this is where the two joins
 * stop resembling each other.** An empty `linkedSystemIds` means the document is
 * organisation-wide and counts toward *every* system, so unlinking a document's
 * last system widens its reach and `./unlink` says so. An empty
 * `linkedControlIds` means the document cites nothing at all: the reading is the
 * plain one, the coverage figures simply lose it, and nothing is silently
 * widened. The control it leaves behind may now have no usable evidence, which
 * is a fall in a number somebody has reported — but it is the honest number, and
 * it is visible on the panel the moment the dialog closes.
 *
 * **Read, filter, write** — `saveAiEvidence` rewrites every link row for the
 * document it is handed, so the current set is read here and the control taken
 * out of it. A caller sending the desired remainder would drop whatever else had
 * been cited in the meantime, and its system links with it.
 *
 * **A document that does not cite this control is refused by name.** The caller
 * is working from a list of what the control has; an id that is not on it means
 * the page is stale, and saying so beats a silent success.
 *
 * **`evidence: ["delete"]` where `./cite` asks for `["create"]`.** The `evidence`
 * resource has no `update` statement — a document is filed rather than edited —
 * so the pair that writes and removes a link row is create and delete, the same
 * split `./link` and `./unlink` already use for the system side.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { evidence: ["delete"] },
    "take evidence off a control",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const asked = readCitation(body);
  if ("error" in asked) {
    return NextResponse.json({ error: asked.error }, { status: 400 });
  }
  const { controlId, evidenceIds } = asked;

  /* The Statement of Applicability is not consulted, unlike `./cite`. A control
   * that has since been taken out of scope still carries whatever was cited on
   * it, and refusing to clean that up would leave the rows unreachable — the
   * scope rule exists to stop evidence arriving on an excluded control, not to
   * trap it there. `frameworkId` is still required by the body: it is what makes
   * the control id name a row, and a caller that does not know it is not
   * working from the panel. */

  // Read once. An id that is not in this tenant's register is simply not found.
  const register = await readAiEvidence(organizationId);
  const byId = new Map(register.map((doc) => [doc.id, doc]));

  const uncited: { id: string; title: string }[] = [];
  const refused: { id: string; title: string | null; reason: string }[] = [];

  for (const id of evidenceIds) {
    const doc = byId.get(id);

    if (!doc) {
      refused.push({ id, title: null, reason: "That document is not in this register." });
      continue;
    }

    if (!doc.linkedControlIds.includes(controlId)) {
      refused.push({ id, title: doc.title, reason: "Not cited on this control." });
      continue;
    }

    await saveAiEvidence(
      organizationId,
      {
        ...doc,
        linkedControlIds: doc.linkedControlIds.filter((target) => target !== controlId),
      },
      { userId },
    );
    uncited.push({ id, title: doc.title });
  }

  return NextResponse.json({ ok: true, uncited, refused });
}
