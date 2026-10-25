import { NextResponse } from "next/server";

import { readAiEvidence, readAiSystem, saveAiEvidence } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/records/evidence/link — attach documents already in the register to
 * a system.
 *
 * The other half of `./upload`. That route files documents that arrive as
 * bytes; this one files documents that are already here, which is the case the
 * product had no answer for: a SOC 2 report uploaded against one system is the
 * same report for the other nine that run on the same vendor, and re-uploading
 * the PDF nine times produces nine records that will expire, be re-verified and
 * be counted separately for the rest of their lives.
 *
 * **Additive, and that is the whole design.** Evidence has no `system_id`
 * column: linkage is `ai_evidence_link` rows, so a document carries a *set* of
 * systems. Linking adds this one and touches nothing else, which is why this is
 * a batch route with no version to reconcile — two people attaching the same
 * report to two different systems are not in conflict, and making one of them
 * lose would be inventing a conflict to have something to report.
 *
 * **A document with no system links is refused, not narrowed.** An empty set
 * does not mean "unfiled": `coverageForSystem` reads it as organisation-wide and
 * counts the document toward *every* system — the governance forum minutes and
 * the internal audit report legitimately cover all of them. Linking one here
 * would silently convert it into evidence for this system alone, dropping it out
 * of every other system's coverage figure, and the person clicking a button
 * called "Link existing" would have no reason to expect that. So the route
 * refuses it and says why, rather than doing the surprising thing quietly.
 *
 * **`evidence: ["create"]`, not `["update"]`.** The `evidence` resource has no
 * `update` statement — not in the access control definition and not on any of
 * the five roles — because a document is filed rather than edited. Writing a
 * link is filing, and it is the same statement `./upload` checks when it does
 * exactly this with a `systemId` in the form body. Gating on a statement nobody
 * holds would have shipped a button that is disabled for the platform admin.
 *
 * **One document's refusal is not the batch's**, for the reason the upload route
 * and the delete route both give: a caller who cannot tell which of twelve
 * landed has been told nothing.
 */

/** More than a screenful of ticks is a script, not somebody choosing documents. */
const MAX_IDS = 200;

export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { evidence: ["create"] },
    "link evidence to a system",
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

  /* Resolved in the caller's own organisation before anything is written, the
   * same way `./upload` resolves its own: `systemId` becomes a row the profile
   * page renders through, so an id borrowed from another tenant would attach
   * documents to a system this organisation cannot see. `readAiSystem` filters
   * by `organizationId`, so an id from elsewhere is simply not found. */
  const system = await readAiSystem(organizationId, systemId);
  if (!system) {
    return NextResponse.json(
      { error: "That system is not in this organisation's inventory." },
      { status: 400 },
    );
  }

  // Read once. An id that is not in this tenant's register is simply not found.
  const register = await readAiEvidence(organizationId);
  const byId = new Map(register.map((doc) => [doc.id, doc]));

  const linked: { id: string; title: string }[] = [];
  const refused: { id: string; title: string | null; reason: string }[] = [];

  for (const id of ids) {
    const doc = byId.get(id);

    if (!doc) {
      refused.push({ id, title: null, reason: "That document is not in this register." });
      continue;
    }

    if (doc.linkedSystemIds.length === 0) {
      refused.push({
        id,
        title: doc.title,
        reason:
          "This document is organisation-wide, so it already counts toward every system. Linking it to one would take it away from the others.",
      });
      continue;
    }

    if (doc.linkedSystemIds.includes(systemId)) {
      // Not an error: the register is already in the state the caller asked for.
      refused.push({
        id,
        title: doc.title,
        reason: `Already linked to ${system.name}.`,
      });
      continue;
    }

    await saveAiEvidence(
      organizationId,
      { ...doc, linkedSystemIds: [...doc.linkedSystemIds, systemId] },
      { userId },
    );
    linked.push({ id, title: doc.title });
  }

  return NextResponse.json({ ok: true, linked, refused });
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
