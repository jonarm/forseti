import { NextResponse } from "next/server";

import { readAiSystem, readUseCase, saveUseCase } from "@/lib/ai-store";
import {
  newUseCase,
  newUseCaseId,
  USE_CASE_CREATE_SCHEMA,
  type UseCaseCreateInput,
} from "@/lib/ams/use-case-create";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/use-cases/create — write down what a tool is actually being used for.
 *
 * **A sub-path, not `POST /api/use-cases`.** That one is the edit route, which is
 * where the domain gate lives; the registers that grew a create button all read
 * this way, a path per act, so one handler never holds two guards and picks
 * between them by guessing which act it is performing.
 *
 * **Every system is resolved in the caller's own organisation before anything
 * is stored.** Each `ai_use_case_system` row is half of a composite foreign key
 * with the organisation, so a caller naming another tenant's system gets a
 * constraint violation and a 500 where they are owed a clean 404 — and a caller
 * naming a system that was soft-deleted would file a use case against a record
 * nobody can see. Reading them first answers both, and it is the same check the
 * evidence upload route makes for the same reason.
 *
 * **All of them, not the first one that fails.** A dialog that reports one bad
 * id, gets it fixed and then reports the next is a dialog somebody submits four
 * times; the response names every id that did not resolve.
 *
 * **The id is minted here.** `saveUseCase` upserts on `(organizationId, id)`, so
 * a caller-chosen id is a caller who can overwrite any use case in their own
 * organisation by naming it — silently, because an upsert onto an existing id is
 * an ordinary update. The re-read below closes the sliver where a generated id
 * lands on one already taken.
 *
 * **The activity trail is not written here.** `saveUseCase` diffs against the
 * stored row — nothing, in this case — and records "added a use case" itself.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission({ useCase: ["create"] }, "add a use case");
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = USE_CASE_CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    // Per field, so the form can put the message under the input that caused it.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That use case could not be added as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const input = sanitise(parsed.data);

  const resolved = await Promise.all(
    input.systemIds.map(async (systemId) => ({
      systemId,
      system: await readAiSystem(organizationId, systemId),
    })),
  );
  const missing = resolved.filter((row) => !row.system).map((row) => row.systemId);

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error:
          missing.length === 1
            ? "That system is not in your inventory."
            : `${missing.length} of those systems are not in your inventory.`,
        fields: { systemIds: "Choose systems from your own register." },
      },
      { status: 404 },
    );
  }

  let id = newUseCaseId(input.name);
  for (let attempt = 0; attempt < 5 && (await readUseCase(organizationId, id)); attempt++) {
    id = newUseCaseId(input.name);
  }

  await saveUseCase(organizationId, newUseCase(id, input), { userId });

  // Return the saved row: the register needs the real id, and the version so a
  // later edit does not send a stale one.
  const saved = await readUseCase(organizationId, id);
  return NextResponse.json({ ok: true, useCase: saved }, { status: 201 });
}

/**
 * Cleaned at the point of storage, not at the point of display.
 *
 * The name, the description and the oversight summary are all free text that a
 * customer may eventually read in an export and that the drafting routes will
 * hand to a model. Cleaning here means every later reader gets the cleaned text
 * rather than each one remembering to ask.
 */
function sanitise(input: UseCaseCreateInput): UseCaseCreateInput {
  return {
    ...input,
    name: cleanLine(input.name),
    /* Called with one argument on purpose: `cleanLine(value, max)` takes a
     * length as its second, and point-free `.map(cleanLine)` hands it the
     * array index — truncating the first id to nothing at all. */
    systemIds: input.systemIds.map((id) => cleanLine(id)),
    businessUnit: cleanLine(input.businessUnit),
    ownerId: cleanLine(input.ownerId),
    description: cleanText(input.description),
    oversightSummary: cleanText(input.oversightSummary),
  };
}
