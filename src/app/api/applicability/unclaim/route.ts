import { NextResponse } from "next/server";

import { readAiSystem, readApplicability, saveApplicability } from "@/lib/ai-store";
import {
  MAX_CLAIMS,
  groupByFramework,
  readClaims,
} from "@/lib/ams/applicability-claims";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/applicability/unclaim — take controls off a system.
 *
 * The inverse of `./claim`, and the one of these four that changes a number
 * somebody has already reported. Coverage is `evidenced / claimed` per system,
 * so removing a claim moves both halves: a control carrying no evidence was
 * dragging the percentage down and taking it away raises it. That is the right
 * outcome when the control was claimed by mistake and a misleading one when it
 * was not, which is why this is its own act behind its own confirmation rather
 * than an unticked box in the dialog that claims them.
 *
 * **Empty means no systems here, unlike evidence.** `coverageForSystem` reads
 * `appliesToSystemIds.includes(systemId)` with no length branch, so a control
 * claimed against nothing counts for nothing — the plain reading. Evidence is
 * the odd one out: an empty `linkedSystemIds` there means *every* system. So
 * removing a control's last claim needs no warning, and removing a document's
 * last link does. The two rules look symmetrical and are not.
 *
 * `saveApplicability` guards its re-insert with `length > 0`, so an emptied
 * set deletes the join rows and writes none back. The SoA row itself survives:
 * the control is still in scope for the organisation, it is simply claimed
 * against no system.
 *
 * **A control not claimed against this system is refused by name.** The caller
 * is working from a list of what this system has; an id that is not on it means
 * the page is stale, and saying so beats a silent success.
 *
 * **`framework: ["update"]`**, the same statement `./claim` asks for and the
 * same one a system owner does not hold. Taking a control out of a system's
 * scope is no less a scope decision than putting it in.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { framework: ["update"] },
    "unclaim a control from a system",
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

  const { systemId: askedSystem, controls } = body as Record<string, unknown>;

  if (typeof askedSystem !== "string" || askedSystem.trim() === "") {
    return NextResponse.json({ error: "A system id is required." }, { status: 400 });
  }
  const systemId = cleanLine(askedSystem);

  const wanted = readClaims(controls);
  if (!wanted) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_CLAIMS} controls, each naming its framework.` },
      { status: 400 },
    );
  }

  const system = await readAiSystem(organizationId, systemId);
  if (!system) {
    return NextResponse.json(
      { error: "That system is not in this organisation's inventory." },
      { status: 400 },
    );
  }

  const unclaimed: { controlId: string }[] = [];
  const refused: { controlId: string; reason: string }[] = [];

  // One read per framework rather than one per control.
  for (const [frameworkId, controlIds] of groupByFramework(wanted)) {
    const rows = await readApplicability(organizationId, frameworkId);
    const byControl = new Map(rows.map((row) => [row.controlId, row]));

    for (const controlId of controlIds) {
      const row = byControl.get(controlId);

      if (!row) {
        refused.push({
          controlId,
          reason: "That control is not in this framework's Statement of Applicability.",
        });
        continue;
      }

      if (!row.appliesToSystemIds.includes(systemId)) {
        refused.push({
          controlId,
          reason: `Not claimed against ${system.name}.`,
        });
        continue;
      }

      await saveApplicability(
        organizationId,
        {
          ...row,
          appliesToSystemIds: row.appliesToSystemIds.filter((id) => id !== systemId),
        },
        { userId },
      );
      unclaimed.push({ controlId });
    }
  }

  return NextResponse.json({ ok: true, unclaimed, refused });
}
