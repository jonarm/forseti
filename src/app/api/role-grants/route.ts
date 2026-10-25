import { NextResponse } from "next/server";

import { resetRoleGrants, saveRoleGrants } from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { ROLE_ORDER, type RoleName } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/role-grants  { role, grants | null, reason? }
 *
 * What a role means in this organization.
 *
 * **Gated on `role: ["update"]`, which exists for this and nothing else.** The
 * obvious choice would have been `member: ["update"]` — it is what gates the
 * members screen this sits beside — and it would have been the hole that
 * swallows the product. A governance lead holds it, and a governance lead could
 * then grant `signoff: ["approve"]` to `system_owner`: the author endorses their
 * own assessment, and the resulting organization looks exactly like a correctly
 * configured one. So the editor has its own statement, held only by the platform
 * admin, and that statement is itself not editable.
 *
 * **The refusals live in the store, not here.** Which grants may never be made
 * is a fact about the product's segregation of duties rather than about this
 * request, and it has to hold however the row arrives — a seed, an import, the
 * next client somebody writes. `refusedGrant()` states each one in a sentence
 * naming the rule, and this route returns that sentence rather than "invalid".
 *
 * A null `grants` puts the role back to what the product ships. That is a delete
 * rather than a write of the current defaults, so the row's absence keeps meaning
 * "whatever this build says" and a later release's new statements are not
 * withheld from a tenant who once pressed reset.
 */

function isRole(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLE_ORDER as string[]).includes(value);
}

/** `{ resource: string[] }`, and nothing else. Shape only — policy is the store's. */
function toGrants(value: unknown): Record<string, string[]> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const grants: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(value)) {
    if (!Array.isArray(actions) || actions.some((a) => typeof a !== "string")) {
      return null;
    }
    grants[resource] = actions as string[];
  }
  return grants;
}

export async function POST(request: Request) {
  // Guard first, before the body is read.
  const auth = await requirePermission(
    { role: ["update"] },
    "change what a role means",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId, role: actingRole } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { role, grants, reason } = body as Record<string, unknown>;

  if (!isRole(role)) {
    return NextResponse.json(
      { error: `A role is required, one of: ${ROLE_ORDER.join(", ")}.` },
      { status: 400 },
    );
  }

  /* Rewriting what a role means is a governed act, so a note is carried when one
   * is given. Not demanded: the common case is a small adjustment during setup,
   * and demanding a justification there trains people to type "n/a". */
  const actor = {
    userId,
    reason: typeof reason === "string" ? cleanLine(reason) : null,
  };

  if (grants === null || grants === undefined) {
    await resetRoleGrants(organizationId, role, actor);
    return NextResponse.json({ ok: true, role, grants: null });
  }

  const parsed = toGrants(grants);
  if (!parsed) {
    return NextResponse.json(
      { error: "Grants must be an object of resource to a list of actions." },
      { status: 400 },
    );
  }

  const outcome = await saveRoleGrants(organizationId, role, parsed, actor, actingRole);

  if (!outcome.ok) {
    /* 409 rather than 400: the request is well-formed and the caller is
     * authorised — it is the *state* being asked for that the product refuses,
     * and the message says which rule and why. */
    return NextResponse.json({ error: outcome.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true, role, grants: parsed });
}
