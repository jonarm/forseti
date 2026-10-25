import { NextResponse } from "next/server";

import { readAiEvidence, readApplicability, saveAiEvidence } from "@/lib/ai-store";
import { readCitation } from "@/lib/ams/evidence-citation";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/records/evidence/cite — put documents already in the register
 * against a control.
 *
 * **The join nothing could write.** A control's evidence is derived by inverting
 * `ai_evidence_link` rows with `targetKind: "control"`, and until now the only
 * thing in the codebase that created one was the demo seed: the upload route
 * files every document with `linkedControlIds: []`, there is no evidence import
 * spec, and `./link` writes system links only. So on any organisation that is
 * not the seed, `readiness.ts` reported `evidenced` and `ready` at 0%,
 * `coverageForSystem` returned zero for every system, the "applicable with no
 * usable evidence" lens matched everything, and the audit pack came out empty —
 * while the evidence record page told people to "link it to the control it
 * supports". This is what it was telling them to click.
 *
 * **The empty set means nothing here, and that is the whole difference from
 * `./link`.** A document with no *system* links is organisation-wide and counts
 * toward every system, which is why that route refuses to link one and narrow
 * it. A document with no *control* links simply cites no control: nothing reads
 * it as "all controls", nothing is widened by removing the last one, and there
 * is no equivalent refusal to make. The two joins look symmetrical and are not,
 * and a later reader copying `./link`'s guard into this file would be inventing
 * a rule out of the resemblance.
 *
 * **Additive, and only ever additive.** `saveAiEvidence` deletes and re-inserts
 * every link row for the document it is handed, so a caller sending the desired
 * total would be one stale page-load away from dropping a citation somebody else
 * added — and from dropping its *system* links too, which is the same write.
 * Each document is read here and the control unioned onto what it already has.
 *
 * **A control the SoA puts out of scope is refused**, the same rule and the same
 * reason `/api/applicability/claim` gives: `applicability: "no"` or `"na"` says
 * this organisation does not have to satisfy the control at all, and evidence
 * filed against it would sit in a coverage figure the SoA says is empty.
 *
 * **`evidence: ["create"]`**, not `framework: ["update"]`. What is written is an
 * `ai_evidence_link` row — the same table, the same `saveAiEvidence` call, and
 * the same statement `./link` and `./upload` check when they do exactly this
 * with a system. Citing a document is evidencing the framework rather than
 * changing what it says, which is the act a system owner exists to perform. A
 * third statement over one table would mean `/settings/roles` gave two different
 * answers for the same act depending which screen it was done from.
 *
 * **One document's refusal is not the batch's**, for the reason `./link`,
 * `./upload` and the delete route all give: a caller who cannot tell which of
 * twelve landed has been told nothing.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { evidence: ["create"] },
    "cite evidence on a control",
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
  const { frameworkId, controlId, evidenceIds } = asked;

  /* Resolved in the caller's own organisation before anything is written.
   * `readApplicability` filters by `organizationId`, so a control borrowed from
   * another tenant is simply not found. */
  const rows = await readApplicability(organizationId, frameworkId);
  const row = rows.find((r) => r.controlId === controlId);
  if (!row) {
    return NextResponse.json(
      { error: "That control is not in this framework's Statement of Applicability." },
      { status: 400 },
    );
  }

  if (row.applicability !== "yes") {
    return NextResponse.json(
      {
        error:
          "The Statement of Applicability puts this control out of scope, so nothing needs to prove it.",
      },
      { status: 400 },
    );
  }

  // Read once. An id that is not in this tenant's register is simply not found.
  const register = await readAiEvidence(organizationId);
  const byId = new Map(register.map((doc) => [doc.id, doc]));

  const cited: { id: string; title: string }[] = [];
  const refused: { id: string; title: string | null; reason: string }[] = [];

  for (const id of evidenceIds) {
    const doc = byId.get(id);

    if (!doc) {
      refused.push({ id, title: null, reason: "That document is not in this register." });
      continue;
    }

    if (doc.linkedControlIds.includes(controlId)) {
      // Not an error: the register is already in the state the caller asked for.
      refused.push({ id, title: doc.title, reason: "Already cited on this control." });
      continue;
    }

    await saveAiEvidence(
      organizationId,
      { ...doc, linkedControlIds: [...doc.linkedControlIds, controlId] },
      { userId },
    );
    cited.push({ id, title: doc.title });
  }

  return NextResponse.json({ ok: true, cited, refused });
}
