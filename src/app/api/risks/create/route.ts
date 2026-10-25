import { NextResponse } from "next/server";

import { readAiRisk, readUseCase, saveAiRisk } from "@/lib/ai-store";
import {
  newRisk,
  newRiskId,
  RISK_CREATE_SCHEMA,
  type RiskCreateInput,
} from "@/lib/ams/risk-create";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/risks/create — write down something that could go wrong.
 *
 * **A sub-path, not `POST /api/risks`.** That one is already the edit route, and
 * it is the edit route that carries the acceptance rule — re-rating voids an
 * acceptance, accepting demands a written reason. Overloading it on the shape of
 * the body would mean one handler holding two guards and picking between them by
 * guessing which act it is performing. `/export`, `/delete` and `/restore` under
 * `records/[kind]` already read this way: a path per act.
 *
 * **The body carries nine answers and cannot carry an acceptance.**
 * `RISK_CREATE_SCHEMA` has the argument in full; the short version is that a
 * risk created as accepted would be a signature nobody gave, arriving past the
 * justification gate on the edit route.
 *
 * **The id is minted here.** `saveAiRisk` upserts on `(organizationId, id)`, so
 * a caller-chosen id is a caller who can overwrite any risk in their own
 * organisation by naming it — silently, because an upsert onto an existing id is
 * an ordinary update. The re-read below closes the sliver where a generated id
 * lands on one already taken.
 *
 * **The activity trail is not written here.** `saveAiRisk` diffs against the
 * stored row — nothing, in this case — and records "registered the risk" itself.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission({ risk: ["create"] }, "add a risk");
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = RISK_CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    // Per field, so the form can put the message under the input that caused it.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That risk could not be added as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const input = sanitise(parsed.data);

  /*
   * A named use case has to be one the named system implements.
   *
   * The pair is the subject when both are given — "summarising meetings on this
   * tool" — and a mismatch would record a risk against a combination nobody
   * runs. This route does not otherwise resolve the system: `ai_risk.system_id`
   * has no foreign key and an unknown id is left to `readWorkspace`'s orphan
   * check, which is a deliberate looseness for a register that accepts
   * organisation-level rows. A use case is different: it names a real row with
   * a real set of systems, and the two either agree or they do not.
   */
  if (input.useCaseId) {
    const useCase = await readUseCase(organizationId, input.useCaseId);

    if (!useCase) {
      return NextResponse.json(
        {
          error: "That risk could not be added as sent.",
          fields: { useCaseId: "That use case is not in this organisation's register." },
        },
        { status: 400 },
      );
    }

    if (!input.systemId) {
      return NextResponse.json(
        {
          error: "That risk could not be added as sent.",
          fields: {
            useCaseId:
              "A risk about a use case is about that use case on a system. Choose the system too, or leave the use case empty.",
          },
        },
        { status: 400 },
      );
    }

    if (!useCase.systemIds.includes(input.systemId)) {
      return NextResponse.json(
        {
          error: "That risk could not be added as sent.",
          fields: {
            useCaseId: `${useCase.name} is not recorded against that system. Link them first, or file the risk against the system as a whole.`,
          },
        },
        { status: 400 },
      );
    }
  }

  let id = newRiskId(input.title);
  for (let attempt = 0; attempt < 5 && (await readAiRisk(organizationId, id)); attempt++) {
    id = newRiskId(input.title);
  }

  await saveAiRisk(organizationId, newRisk(id, input), { userId });

  // Return the saved row: the register needs the real id, and the version so a
  // later edit does not send a stale one.
  const saved = await readAiRisk(organizationId, id);
  return NextResponse.json({ ok: true, risk: saved }, { status: 201 });
}

/**
 * Cleaned at the point of storage, not at the point of display.
 *
 * A title and a treatment summary are both free text that a customer may
 * eventually read in an export and that the drafting routes will hand to a
 * model. Cleaning here means every later reader gets the cleaned text rather
 * than each one remembering to ask — the same call `POST /api/risks` makes on
 * the way through.
 */
function sanitise(input: RiskCreateInput): RiskCreateInput {
  return {
    ...input,
    title: cleanLine(input.title),
    systemId: cleanLine(input.systemId),
    useCaseId: cleanLine(input.useCaseId),
    ownerId: cleanLine(input.ownerId),
    treatmentSummary: cleanText(input.treatmentSummary),
  };
}
