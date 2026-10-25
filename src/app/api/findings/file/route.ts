import { NextResponse } from "next/server";

import { readAiFinding, readAiSystem, saveAiFinding } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/findings/file — put an organisation-level finding onto a system.
 *
 * The findings register's half of `/api/risks/file`, and a sub-path for a
 * sharper reason than symmetry: **`POST /api/findings` does not exist yet.**
 * That bare path is the findings edit route, and whatever `EDITABLE` it is born
 * with becomes the register's contract. Findings close only with a root cause, a
 * corrective action and dated verification by somebody other than the owner, so
 * the edit route has to arrive with that gate in it — and an edit route created
 * as a side effect of a filing button would either be a half-route somebody
 * later extends without the gate, or this change quietly growing into the
 * closure workflow. A path per act leaves the bare path free for the route that
 * will do the job properly.
 *
 * **A filing, not a transfer.** `ai_finding.system_id` is a single scalar
 * column, so a finding that already names a system is refused rather than
 * moved — `/api/risks/file` carries the full argument, and it is the same one:
 * a picker on one system's profile tab must not be able to take a record off
 * another system's without ever naming what it displaced.
 *
 * **No `expectedVersion`, and that is the store's shape rather than an
 * omission.** `saveAiFinding` takes no version option — findings do not carry
 * the optimistic-concurrency check that systems, use cases and risks do — so
 * there is nothing here to send one to. Adding the check belongs with the edit
 * route, where two people really can be editing the same finding; a filing
 * writes one column that was null.
 *
 * `finding: ["update"]` and not `verify`. Filing is bookkeeping and belongs with
 * whoever is tidying the register. Verification is the separate act by the
 * separate person, and it holds its own statement — a reviewer who may attest
 * that a fix happened has no business re-parenting the record.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { finding: ["update"] },
    "file a finding against a system",
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

  const { findingId, systemId: askedSystem } = body as Record<string, unknown>;

  if (typeof findingId !== "string" || findingId.trim() === "") {
    return NextResponse.json({ error: "A finding id is required." }, { status: 400 });
  }
  if (typeof askedSystem !== "string" || askedSystem.trim() === "") {
    return NextResponse.json({ error: "A system id is required." }, { status: 400 });
  }
  const systemId = cleanLine(askedSystem);

  /* This tenant's own rows, so an id from another organisation is not found
   * rather than written to. */
  const current = await readAiFinding(organizationId, cleanLine(findingId));
  if (!current) {
    return NextResponse.json({ error: "That finding no longer exists." }, { status: 404 });
  }

  if (current.systemId) {
    const owner = await readAiSystem(organizationId, current.systemId);
    return NextResponse.json(
      {
        error: `That finding is already filed against ${owner?.name ?? "another system"}. Moving it is a decision for its own record, not a filing.`,
      },
      { status: 409 },
    );
  }

  const system = await readAiSystem(organizationId, systemId);
  if (!system) {
    return NextResponse.json(
      { error: "That system is not in this organisation's inventory." },
      { status: 400 },
    );
  }

  await saveAiFinding(organizationId, { ...current, systemId }, { userId });

  const saved = await readAiFinding(organizationId, current.id);
  return NextResponse.json({ ok: true, finding: saved });
}
