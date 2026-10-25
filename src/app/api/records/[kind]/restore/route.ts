import { NextResponse } from "next/server";

import { recordKind } from "@/lib/ams/record-kinds";
import { RECORD_BINDINGS } from "@/lib/records";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { PermissionRequest } from "@/lib/permissions";

/**
 * POST /api/records/[kind]/restore — put removed records back.
 *
 * The mirror of the delete route and shaped the same way: ids in, one route for
 * one record and for forty, a per-id report because the store writes and audits
 * each one separately and there is no transaction to hide behind.
 *
 * **It checks `role: ["update"]` — the platform admin's statement — rather than
 * the kind's own.** On the argument alone the kind's `create` would be the
 * better fit: restoring is putting a record back, the same act registering
 * performs. But the trash is restricted to the platform admin while the
 * retention window is new, and a route left on the kind's statement would let
 * anybody holding it restore through the API something the screen will not show
 * them. A gate the UI enforces and the route does not is a list of ids away
 * from being nothing.
 *
 * So this reads the same statement `uiPermissions().viewTrash` derives from, and
 * the two move together: when the trash is opened up, this line and that flag
 * change in the same commit. `role: ["update"]` is also the one statement no
 * tenant may re-assign, so no matrix edit widens it by accident.
 *
 * Nothing needs restoring down the tree. `readWorkspace` derives a dependent's
 * visibility from its parent, so clearing the tombstone on the record brings
 * whatever hung off it back — which is why the deletes never wrote tombstones
 * downward.
 */

/** The same ceiling the delete route uses; a trash cannot exceed it either. */
const MAX_IDS = 200;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const def = recordKind((await params).kind);
  const binding = def ? RECORD_BINDINGS[def.kind] : null;

  if (!def || !def.features.delete || !binding?.restore) {
    return NextResponse.json(
      { error: "Records in that register cannot be restored." },
      { status: 404 },
    );
  }

  const auth = await requirePermission(
    { role: ["update"] } as PermissionRequest,
    `restore a ${def.singular} from the trash`,
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

  const ids = readIds((body as { ids?: unknown }).ids);
  if (!ids) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_IDS} ids.` },
      { status: 400 },
    );
  }

  const restored: string[] = [];
  const refused: { id: string; reason: string }[] = [];

  for (const id of ids) {
    /* The store answers false for a row that is not there and for one that was
     * never removed — from this caller's side those are the same fact, and a
     * record already back in the register needs no second opinion. It filters
     * on `organizationId`, so another tenant's id lands here too. */
    const ok = await binding.restore(organizationId, id, { userId });

    if (ok) restored.push(id);
    else
      refused.push({
        id,
        reason:
          "Not in your trash — it may already be back, or its retention window may have run out.",
      });
  }

  return NextResponse.json({ ok: true, restored, refused });
}

function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) {
    return null;
  }

  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const id = cleanLine(raw, 200);
    if (!id) return null;
    ids.add(id);
  }

  return [...ids];
}
