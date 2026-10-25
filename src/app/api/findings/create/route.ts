import { NextResponse } from "next/server";

import { readAiFinding, saveAiFinding } from "@/lib/ai-store";
import {
  FINDING_CREATE_SCHEMA,
  newFinding,
  newFindingId,
  type FindingCreateInput,
} from "@/lib/ams/finding-create";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/findings/create — raise something that is already wrong.
 *
 * A sub-path rather than `POST /api/findings`, so the register's create sits
 * where the risk register's does and the bare path stays free for the edit route
 * that will want it. `/api/records/[kind]/export|delete|restore` is the same
 * shape: a path per act.
 *
 * **The body cannot carry a closure.** Root cause, corrective action,
 * verification and `closedAt` are not on the wire and `status` starts open —
 * `FINDING_CREATE_SCHEMA` has the argument. A finding posted already closed and
 * self-verified would arrive past the one check this register exists to make,
 * and would be indistinguishable afterwards from one that earned it.
 *
 * **The id is minted here**, for the reason every create route mints its own:
 * `saveAiFinding` upserts on `(organizationId, id)`, so an id the caller chose
 * is an overwrite of any finding in their organisation, silently. The re-read
 * closes the sliver where a generated id collides.
 *
 * `finding: ["create"]` and not `verify` — raising a finding is the working
 * loop and belongs with whoever noticed. Verifying one is the separate act by
 * the separate person, and it holds a separate statement.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission({ finding: ["create"] }, "raise a finding");
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = FINDING_CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That finding could not be raised as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const input = sanitise(parsed.data);

  let id = newFindingId(input.title);
  for (
    let attempt = 0;
    attempt < 5 && (await readAiFinding(organizationId, id));
    attempt++
  ) {
    id = newFindingId(input.title);
  }

  await saveAiFinding(organizationId, newFinding(id, input), { userId });

  const saved = await readAiFinding(organizationId, id);
  return NextResponse.json({ ok: true, finding: saved }, { status: 201 });
}

/**
 * Cleaned at the point of storage, not at the point of display.
 *
 * A summary is what a reviewer reads first and what an audit pack prints; both
 * are places the text arrives without anybody remembering to sanitise it there.
 */
function sanitise(input: FindingCreateInput): FindingCreateInput {
  return {
    ...input,
    title: cleanLine(input.title),
    raisedBy: cleanLine(input.raisedBy),
    ownerId: cleanLine(input.ownerId),
    systemId: cleanLine(input.systemId),
    summary: cleanText(input.summary),
  };
}
