import { NextResponse } from "next/server";

import { ConcurrentModificationError, readUseCase, saveUseCase } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/use-cases/unlink — record that a system no longer implements this
 * purpose.
 *
 * The inverse of `./link`, and it removes an `ai_use_case_system` row rather
 * than the use case: the purpose survives, every other system implementing it
 * keeps doing so, and nothing about the record changes. Removing the use case
 * itself is `/api/records/useCase/delete`.
 *
 * **The last system cannot be unlinked, and this route is the only thing
 * enforcing it.** The join table cannot express a minimum — a use case with no
 * rows in it is a perfectly legal row that means nothing, and the create
 * schema's `min(1)` only guards the way in. A purpose nothing implements is not
 * a purpose; it is either a purpose that moved, in which case link the new
 * system first, or one that ended, in which case delete it and let the trash
 * hold it for the retention window. Both of those are things somebody can find
 * again. A use case stranded with no systems is not: `readWorkspace` treats it
 * as orphaned and it drops out of every register at once, with no tombstone and
 * no trash entry.
 *
 * This is deliberately **not** the rule evidence uses. There, an empty link set
 * means the document covers every system rather than none
 * (`records/evidence/unlink/route.ts`), so unlinking the last one widens its
 * reach. Reading a use case the same way would say a purpose with no tools
 * is served by all of them, which is nonsense. The two look symmetrical and
 * are not.
 *
 * **`expectedVersion` is honoured**, for the reason `./link` gives.
 */
export async function POST(request: Request) {
  // Guard before the body is touched.
  const auth = await requirePermission(
    { useCase: ["update"] },
    "unlink a system from a use case",
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

  const current = await readUseCase(organizationId, cleanLine(useCaseId));
  if (!current) {
    return NextResponse.json({ error: "That use case no longer exists." }, { status: 404 });
  }

  const removing = wanted.filter((id) => current.systemIds.includes(id));
  const notLinked = wanted.filter((id) => !current.systemIds.includes(id));
  const remaining = current.systemIds.filter((id) => !removing.includes(id));

  if (removing.length === 0) {
    return NextResponse.json(
      {
        error:
          notLinked.length === 1
            ? "That system does not implement this use case."
            : "None of those systems implement this use case.",
      },
      { status: 409 },
    );
  }

  if (remaining.length === 0) {
    /* Named rather than counted, and refused rather than warned: there is no
     * state on the other side of this worth offering. */
    return NextResponse.json(
      {
        error:
          current.systemIds.length === 1
            ? "This is the only system implementing this use case. Link another one first, or delete the use case instead."
            : "That would leave the use case with no system. Link another one first, or delete the use case instead.",
      },
      { status: 409 },
    );
  }

  try {
    await saveUseCase(
      organizationId,
      { ...current, systemIds: remaining },
      { userId },
      {
        expectedVersion:
          typeof expectedVersion === "number" ? expectedVersion : undefined,
      },
    );
  } catch (err) {
    if (err instanceof ConcurrentModificationError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  const saved = await readUseCase(organizationId, current.id);
  return NextResponse.json({ ok: true, removed: removing, notLinked, useCase: saved });
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
