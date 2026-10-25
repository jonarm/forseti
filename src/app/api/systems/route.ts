import { NextResponse } from "next/server";

import { readAiSystem, saveAiSystem } from "@/lib/ai-store";
import {
  newSystem,
  newSystemId,
  SYSTEM_CREATE_SCHEMA,
  type SystemCreateInput,
} from "@/lib/ams/system-create";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/systems — write down a tool the organisation is already running.
 *
 * **The body carries the eight answers and nothing else.** Not an `AISystem`:
 * every other field — lifecycle, risk tier, assessment status, the vendor
 * record, both dates — is decided by `newSystem()` on this side. A create route
 * that merged a client object would let somebody register a system already
 * marked approved, which is the one lie the register cannot afford, and it is
 * why `SYSTEM_PATCH_SCHEMA` refuses `assessmentStatus` on the way through too.
 *
 * **The id is minted here.** `saveAiSystem` upserts on `(organizationId, id)`,
 * so an id chosen by the caller is a caller who can overwrite any row in their
 * own organisation by naming it — silently, because an upsert onto an existing
 * id is an ordinary update. Minting it server-side makes that unreachable; the
 * re-read below closes the remaining sliver, where a generated id lands on one
 * that already exists.
 *
 * **The activity trail is not written here.** `saveAiSystem` diffs against the
 * stored row — nothing, in this case — and records "registered the system"
 * itself. A second differ in the route would be a second answer to what changed.
 *
 * `system: ["create"]`, not `update`: registering is the working loop, and it
 * sits with the system owner because the whole argument for the inventory is
 * that shadow AI gets written down by whoever notices it.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission({ system: ["create"] }, "register an AI system");
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = SYSTEM_CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    // Per field, so the form can put the message under the input that caused it.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That system could not be registered as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const input = sanitise(parsed.data);

  /* An id that is already taken would upsert onto the row holding it. Six random
   * characters make that vanishingly unlikely rather than impossible, and
   * "vanishingly unlikely" is not a property to hand a register. */
  let id = newSystemId(input.name);
  for (let attempt = 0; attempt < 5 && (await readAiSystem(organizationId, id)); attempt++) {
    id = newSystemId(input.name);
  }

  await saveAiSystem(organizationId, newSystem(id, input, new Date()), { userId });

  // Return the saved row: the table needs the real id to point at the new line,
  // and the version so a later edit does not send a stale one.
  const saved = await readAiSystem(organizationId, id);
  return NextResponse.json({ ok: true, system: saved }, { status: 201 });
}

/**
 * Cleaned at the point of storage, not at the point of display.
 *
 * A purpose is the company describing itself and it reaches a model later
 * through the drafting routes. Cleaning here means every later reader gets the
 * cleaned text rather than each one remembering to ask — the same reason
 * `PATCH` does it.
 */
function sanitise(input: SystemCreateInput): SystemCreateInput {
  return {
    ...input,
    name: cleanLine(input.name),
    vendor: cleanLine(input.vendor),
    businessUnit: cleanLine(input.businessUnit),
    ownerId: cleanLine(input.ownerId),
    purpose: cleanText(input.purpose),
  };
}
