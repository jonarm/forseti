import { NextResponse } from "next/server";

import {
  ConcurrentModificationError,
  readAiRisk,
  readAiSystem,
  saveAiRisk,
} from "@/lib/ai-store";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/risks/file — put an organisation-level risk onto a system.
 *
 * A sub-path rather than a field on `POST /api/risks`, and the reason is that
 * route's own sentence: *"What a caller may change. Everything else on a risk is
 * derived or immutable."* `systemId` sits in the immutable half of that
 * contract, and widening `EDITABLE` to admit it would quietly turn a
 * field-by-field patch loop into something that can also move a record between
 * parents. A path per act keeps the gate visible — the same shape
 * `/api/records/[kind]/export|delete|restore` already uses, and the same reason
 * `/api/risks/create` is not `POST /api/risks` either.
 *
 * **This is a filing, not a transfer, and the route is what makes that true.**
 * `ai_risk.system_id` is a single scalar column, so attaching a risk to this
 * system takes it off whatever it was on. A risk that already names a system is
 * therefore refused: the person who filed it there made a judgement, and the
 * honest way to disagree is on the risk's own record, not through a picker on
 * somebody else's profile tab that never mentions what it displaced. Only risks
 * sitting at organisation level — `systemId` null, which is what the create
 * dialog's "Organisation-wide" option produces — can be filed.
 *
 * **`expectedVersion` is sent and honoured**, because this is an ordinary edit
 * to a row two people can have open. The risks edit route carries the same
 * argument at length; the short version is that a save which silently discards
 * somebody else's is a bug the person who lost the edit never finds out about.
 *
 * No reason is demanded. `requireReason` guards acceptance, which is the act on
 * this register that somebody has to be answerable for; filing a risk under the
 * system it was always about is bookkeeping, and demanding a justification for
 * it would teach people to type "n/a" into the box that matters.
 */
export async function POST(request: Request) {
  // Guard before the body is touched.
  const auth = await requirePermission(
    { risk: ["update"] },
    "file a risk against a system",
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

  /* Read from this tenant's own rows, so an id belonging to another
   * organisation is simply not found rather than being written to. */
  const current = await readAiRisk(organizationId, cleanLine(riskId));
  if (!current) {
    return NextResponse.json({ error: "That risk no longer exists." }, { status: 404 });
  }

  if (current.systemId) {
    /* Named rather than counted: "already filed" is not something the person can
     * check against what they meant to pick. */
    const owner = await readAiSystem(organizationId, current.systemId);
    return NextResponse.json(
      {
        error: `That risk is already filed against ${owner?.name ?? "another system"}. Moving it is a decision for its own record, not a filing.`,
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

  try {
    await saveAiRisk(
      organizationId,
      { ...current, systemId },
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
