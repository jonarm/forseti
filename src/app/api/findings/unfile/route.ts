import { NextResponse } from "next/server";

import { readAiFinding, saveAiFinding } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/findings/unfile — take a finding off a system, back to
 * organisation level.
 *
 * The inverse of `./file`, and the same shape: nothing is deleted, the finding
 * keeps its severity, its owner, its due date and its place on the register,
 * and only stops being one of *this* system's findings.
 *
 * **`controlId` is deliberately left alone**, where `/api/risks/unfile` clears
 * `useCaseId`. The two look alike and are not. A use case belongs to exactly
 * one system — `ai_use_case.system_id` is `NOT NULL` — so a risk naming a use
 * case is transitively about that use case's system, and the reference goes
 * stale the moment the risk leaves. A framework control belongs to no system:
 * it is claimed against many through `ai_applicability_system`, and a finding
 * against A.8.4 is a finding against A.8.4 whichever systems are in scope for
 * it. Nothing about un-filing makes that reference wrong.
 *
 * **No `expectedVersion`**, because `saveAiFinding` takes no version option —
 * findings do not carry the optimistic-concurrency check that systems, use
 * cases and risks do. The mismatch check below is what catches a stale page:
 * a finding somebody else moved is reported rather than silently re-parented.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { finding: ["update"] },
    "unfile a finding from a system",
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

  const current = await readAiFinding(organizationId, cleanLine(findingId));
  if (!current) {
    return NextResponse.json({ error: "That finding no longer exists." }, { status: 404 });
  }

  if (current.systemId !== systemId) {
    return NextResponse.json(
      {
        error: current.systemId
          ? "That finding has been moved to another system since this page loaded. Reload and try again."
          : "That finding is already held at organisation level.",
      },
      { status: 409 },
    );
  }

  await saveAiFinding(organizationId, { ...current, systemId: null }, { userId });

  const saved = await readAiFinding(organizationId, current.id);
  return NextResponse.json({ ok: true, finding: saved });
}
