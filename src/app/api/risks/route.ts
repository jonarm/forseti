import { NextResponse } from "next/server";

import { ConcurrentModificationError, readAiRisk, saveAiRisk } from "@/lib/ai-store";
import { requireReason } from "@/lib/audit";
import { cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { Risk } from "@/lib/ams/types";

/**
 * POST /api/risks — re-rate, re-treat, or accept what remains.
 *
 * The first write in the AI management system that persists, and it is this one
 * because the risk register is where the two rules with teeth live:
 *
 *   - **Re-rating a residual voids the acceptance it was given against.**
 *     Enforced in `saveAiRisk` rather than here, because it must hold however the
 *     row arrives — including through the seed and an import.
 *   - **Accepting a residual demands a reason.** Enforced *here*, because
 *     `ai-store.ts` is the tenant boundary and deliberately not a policy layer:
 *     which acts require a justification is a fact about the act, and only the
 *     caller knows what act it is performing. `requireReason()` is the shared
 *     phrasing so it cannot drift between callers.
 *
 * **`expectedVersion` is the third.** Two people opening the same risk in two
 * tabs is not exotic on a register that a governance lead and a system owner
 * both work; without it the second save silently discards the first, and the
 * person who lost their edit never learns. The client sends the version it read.
 *
 * `acceptedById` is a **person, chosen by the caller** — not the acting account.
 * Accepting residual risk names somebody senior enough to carry it, and that is
 * frequently not whoever is at the keyboard. `acting-person.ts` has the argument
 * for why the two id spaces stay apart; the *account* is recorded regardless, on
 * the audit row.
 */

/** What a caller may change. Everything else on a risk is derived or immutable. */
const EDITABLE = [
  "title",
  "treatment",
  "treatmentSummary",
  "status",
  "ownerId",
  "residualLikelihood",
  "residualImpact",
  "acceptedById",
  "acceptedAt",
] as const;

const RATINGS = [1, 2, 3, 4, 5];

export async function POST(request: Request) {
  // Guard before the body is touched.
  const auth = await requirePermission({ risk: ["update"] }, "change a risk");
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

  const { riskId, changes, expectedVersion, reason } = body as Record<string, unknown>;

  if (typeof riskId !== "string" || riskId.trim() === "") {
    return NextResponse.json({ error: "A risk id is required." }, { status: 400 });
  }
  if (typeof changes !== "object" || changes === null) {
    return NextResponse.json({ error: "No changes were sent." }, { status: 400 });
  }

  /* Read from this tenant's own rows, so an id belonging to another organization
   * is simply not found rather than being written to. */
  const current = await readAiRisk(organizationId, riskId);
  if (!current) {
    return NextResponse.json({ error: "That risk no longer exists." }, { status: 404 });
  }

  const patch = changes as Partial<Record<(typeof EDITABLE)[number], unknown>>;
  const next: Risk = { ...current };

  for (const field of EDITABLE) {
    if (!(field in patch)) continue;
    const value = patch[field];

    if (field === "residualLikelihood" || field === "residualImpact") {
      if (typeof value !== "number" || !RATINGS.includes(value)) {
        return NextResponse.json(
          { error: "A residual rating must be a whole number from 1 to 5." },
          { status: 400 },
        );
      }
      next[field] = value as Risk["residualLikelihood"];
      continue;
    }

    if (field === "treatmentSummary" || field === "title") {
      // Free text a customer may eventually read, and text that a future feature
      // will send to a model. Cleaned at the door rather than at that point.
      next[field] = typeof value === "string" ? cleanText(value) : "";
      continue;
    }

    next[field] = (value ?? null) as never;
  }

  /*
   * Accepting is the act that needs defending, so it is the act that demands a
   * reason — whether it arrives as a status change or as a name in
   * `acceptedById`. An acceptance nobody can be held to is not a weaker record,
   * it is not an acceptance.
   */
  const accepting =
    (next.status === "accepted" && current.status !== "accepted") ||
    (Boolean(next.acceptedById) && next.acceptedById !== current.acceptedById);

  const actor = { userId, reason: typeof reason === "string" ? reason : null };

  if (accepting) {
    try {
      requireReason(actor, "accept a residual risk");
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "A reason is required." },
        { status: 400 },
      );
    }
    if (!next.acceptedAt) next.acceptedAt = new Date().toISOString().slice(0, 10);
  }

  try {
    await saveAiRisk(organizationId, next, actor, {
      expectedVersion:
        typeof expectedVersion === "number" ? expectedVersion : undefined,
    });
  } catch (err) {
    if (err instanceof ConcurrentModificationError) {
      // 409, not 500: nothing is broken, somebody else was faster. The message
      // already names both versions and tells them to reload.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  // Return the saved row so the client picks up the new version — and the voided
  // acceptance, if re-rating cleared one. A client that kept its own copy would
  // send a stale version on the next save and be refused.
  const saved = await readAiRisk(organizationId, riskId);
  return NextResponse.json({ ok: true, risk: saved });
}
