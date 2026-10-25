import { NextResponse } from "next/server";

import { ConcurrentModificationError, readAiRisk, saveAiRisk } from "@/lib/ai-store";
import { requirePermission } from "@/lib/session";
import { cleanLine } from "@/lib/sanitize";

/**
 * POST /api/risks/unfile — take a risk off a system, back to organisation level.
 *
 * The inverse of `./file`. Nothing is deleted: the risk keeps its ratings, its
 * treatment, its owner and its place on the risk register, and only stops being
 * one of *this* system's risks. That is what makes this safe to offer from a
 * profile tab where `./file`'s counterpart — moving a risk to a different
 * system — is not: un-filing takes a claim back, filing makes one.
 *
 * **The caller names the system it is unfiling from, and a mismatch is
 * refused.** The body could get away with a risk id alone. It does not, because
 * the caller is working from a list a page render produced, and in the gap
 * somebody else may have moved the risk. Asserting the system turns "this risk
 * is no longer on the system you were looking at" into a 409 instead of a
 * silent no-op on a screen still showing the old answer.
 *
 * **`useCaseId` is cleared with it, and that is the substantive decision here.**
 * A use case's own `system_id` is `NOT NULL`, so a risk naming a use case is
 * transitively a risk about that use case's system. Leaving the reference
 * behind on an organisation-level risk would produce a row that says it belongs
 * to no system and to one of that system's use cases at the same time — and
 * `readWorkspace` would go on rendering the use case's name against it. The
 * seed populates `useCaseId` on risks (`fixtures/registers.ts`), so this is a
 * real state and not a hypothetical; the import spec always writes null. The
 * dialog names the use case before anybody confirms.
 *
 * **`expectedVersion` is honoured**, for the reason `./file` gives: a risk is a
 * row two people can have open, and a save that silently discards somebody
 * else's is a bug the person who lost the edit never finds out about.
 *
 * No reason is demanded. `requireReason` guards accepting a residual risk,
 * which is the act on this register somebody has to be answerable for.
 */
export async function POST(request: Request) {
  // Guard before the body is touched.
  const auth = await requirePermission(
    { risk: ["update"] },
    "unfile a risk from a system",
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

  const { riskId, systemId: askedSystem, expectedVersion } = body as Record<string, unknown>;

  if (typeof riskId !== "string" || riskId.trim() === "") {
    return NextResponse.json({ error: "A risk id is required." }, { status: 400 });
  }
  if (typeof askedSystem !== "string" || askedSystem.trim() === "") {
    return NextResponse.json({ error: "A system id is required." }, { status: 400 });
  }
  const systemId = cleanLine(askedSystem);

  /* This tenant's own rows, so an id from another organisation is not found
   * rather than written to. */
  const current = await readAiRisk(organizationId, cleanLine(riskId));
  if (!current) {
    return NextResponse.json({ error: "That risk no longer exists." }, { status: 404 });
  }

  if (current.systemId !== systemId) {
    return NextResponse.json(
      {
        error: current.systemId
          ? "That risk has been moved to another system since this page loaded. Reload and try again."
          : "That risk is already held at organisation level.",
      },
      { status: 409 },
    );
  }

  try {
    await saveAiRisk(
      organizationId,
      { ...current, systemId: null, useCaseId: null },
      { userId, reason: null },
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

  // The saved row, so the client picks up the new version rather than sending a
  // stale one on its next save.
  const saved = await readAiRisk(organizationId, current.id);
  return NextResponse.json({ ok: true, risk: saved });
}
