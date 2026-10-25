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
 * POST /api/applicability/claim — claim controls against a system.
 *
 * The Statement of Applicability says which controls this organisation is in
 * scope for; `ai_applicability_system` says which *systems* each of those
 * controls has been claimed against. That join is what `coverageForSystem`
 * computes every readiness figure from — a control claimed against a system and
 * carrying no evidence is the gap the inventory's coverage column reports — and
 * until now nothing in the product wrote it. The SoA workbench holds its
 * claims in React state that does not survive a refresh, so a system's Controls
 * tab could show the join and never add to it.
 *
 * **A sub-path, leaving `/api/applicability` free.** The SoA has a real edit
 * route ahead of it — implementation status, owner, justification, the
 * evidence links — and that route is where the applicability gates belong.
 * Claiming is one act with one rule, so it gets one path, the same shape
 * `/api/records/[kind]/export|delete|restore` and `/api/risks/file` already use.
 *
 * **Additive, and only ever additive.** The body names controls to add; the
 * system's existing claims are read and unioned rather than replaced. That
 * matters because `saveApplicability` rewrites the whole `appliesToSystemIds`
 * set by deleting and re-inserting: a caller that sent the desired total would
 * be one stale page-load away from silently un-claiming a control somebody else
 * added. Taking a claim away is `./unclaim` — its own route behind its own
 * confirmation, because it raises a coverage figure the organisation has
 * already reported by removing what was dragging it down.
 *
 * **Only a control that is in scope can be claimed.** `applicability: "no"` or
 * `"na"` is a decision that this organisation does not have to satisfy the
 * control at all; claiming it against a system would put a row into the
 * coverage denominator that the SoA says is not there, and the two screens
 * would then report different totals for the same framework. Refused by name,
 * so the reason is readable rather than inferred from a row that quietly did
 * not appear.
 *
 * **`framework: ["update"]`, which a system owner does not hold.** Scope is the
 * governance lead's decision — a system owner evidences the framework and
 * cannot change what it says, and that is the single line between the two
 * roles. The button on the profile tab is refused and explained for most of the
 * people who will see it, deliberately.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { framework: ["update"] },
    "claim a control against a system",
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

  /* Pairs, not bare control ids: applicability is keyed by framework *and*
   * control, so a control id alone does not name a row. One organisation
   * ships with one framework today and the schema has been keyed for more
   * since the beginning — a body shaped around the single-framework case is a
   * migration waiting for the second one. */
  const wanted = readClaims(controls);
  if (!wanted) {
    return NextResponse.json(
      {
        error: `Send between 1 and ${MAX_CLAIMS} controls, each naming its framework.`,
      },
      { status: 400 },
    );
  }

  /* Resolved in the caller's own organisation before anything is written.
   * `saveApplicability` filters the claimed ids through this tenant's systems
   * anyway, so a borrowed id would be dropped rather than stored — but dropped
   * silently, and the caller would be told the claim succeeded. */
  const system = await readAiSystem(organizationId, systemId);
  if (!system) {
    return NextResponse.json(
      { error: "That system is not in this organisation's inventory." },
      { status: 400 },
    );
  }

  const claimed: { controlId: string }[] = [];
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

      if (row.applicability !== "yes") {
        refused.push({
          controlId,
          reason:
            "The Statement of Applicability puts this control out of scope, so it cannot be claimed against a system.",
        });
        continue;
      }

      if (row.appliesToSystemIds.includes(systemId)) {
        // Already true. Not an error, but not a write either.
        refused.push({
          controlId,
          reason: `Already claimed against ${system.name}.`,
        });
        continue;
      }

      await saveApplicability(
        organizationId,
        { ...row, appliesToSystemIds: [...row.appliesToSystemIds, systemId] },
        { userId },
      );
      claimed.push({ controlId });
    }
  }

  return NextResponse.json({ ok: true, claimed, refused });
}
