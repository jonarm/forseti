import { NextResponse } from "next/server";

import {
  ConcurrentModificationError,
  readAiSystem,
  readUseCase,
  saveUseCase,
} from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/use-cases/link — record that another system implements this purpose.
 *
 * A sub-path rather than a field on `POST /api/use-cases`, and the reason is
 * that route's own sentence: `EDITABLE` is what a caller may change, and the
 * systems are not a field on the record — they are rows in
 * `ai_use_case_system`. Folding them into the patch loop would put a relation
 * behind an allowlist built for scalars, which is how one of them eventually
 * gets written without the in-organisation check below.
 *
 * **Additive.** The body names systems to add; the ones already linked are read
 * and unioned rather than replaced. `saveUseCase` rewrites the whole link set by
 * deleting and re-inserting, so a caller sending the desired total would be one
 * stale page-load away from silently unlinking a system somebody else added.
 * Removing one is `./unlink`.
 *
 * **Every id is resolved in the caller's own organisation first.** Both foreign
 * keys on the join are composite with the organisation, so an id from another
 * tenant would not merely be wrong — it would fail the whole write with a
 * constraint violation where a clean 404 is owed. `saveUseCase` filters the set
 * again on the way through, which drops a forged id silently; that is the right
 * behaviour for a store and the wrong answer for a caller, so the route says so
 * here.
 *
 * **`expectedVersion` is honoured**, because a use case is a row two people can
 * have open, and `saveUseCase` bumps the version on every write.
 */
export async function POST(request: Request) {
  // Guard before the body is touched.
  const auth = await requirePermission(
    { useCase: ["update"] },
    "link a system to a use case",
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

  const { useCaseId, systemIds, expectedVersion } = body as Record<string, unknown>;

  if (typeof useCaseId !== "string" || useCaseId.trim() === "") {
    return NextResponse.json({ error: "A use case id is required." }, { status: 400 });
  }

  const wanted = readIds(systemIds);
  if (!wanted) {
    return NextResponse.json(
      { error: "Send between 1 and 100 system ids." },
      { status: 400 },
    );
  }

  /* This tenant's own rows, so an id from another organisation is not found
   * rather than written to. */
  const current = await readUseCase(organizationId, cleanLine(useCaseId));
  if (!current) {
    return NextResponse.json({ error: "That use case no longer exists." }, { status: 404 });
  }

  const resolved = await Promise.all(
    wanted.map(async (systemId) => ({
      systemId,
      system: await readAiSystem(organizationId, systemId),
    })),
  );
  const missing = resolved.filter((row) => !row.system).map((row) => row.systemId);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Those systems are not in this organisation's inventory." },
      { status: 400 },
    );
  }

  const already = wanted.filter((id) => current.systemIds.includes(id));
  const added = wanted.filter((id) => !current.systemIds.includes(id));

  if (added.length === 0) {
    // Not an error: the register is already in the state the caller asked for.
    return NextResponse.json(
      { ok: true, added: [], already, useCase: current },
      { status: 200 },
    );
  }

  try {
    await saveUseCase(
      organizationId,
      { ...current, systemIds: [...current.systemIds, ...added] },
      { userId },
      {
        expectedVersion:
          typeof expectedVersion === "number" ? expectedVersion : undefined,
      },
    );
  } catch (err) {
    if (err instanceof ConcurrentModificationError) {
      // 409, not 500: nothing is broken, somebody else was faster.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  const saved = await readUseCase(organizationId, current.id);
  return NextResponse.json({ ok: true, added, already, useCase: saved });
}

/** A list of non-empty strings, deduplicated, within a sane cap. */
function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = [
    ...new Set(
      value
        .filter((id): id is string => typeof id === "string" && id.trim() !== "")
        .map((id) => cleanLine(id)),
    ),
  ];
  if (ids.length === 0 || ids.length > 100) return null;
  return ids;
}
