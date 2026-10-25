import { NextResponse } from "next/server";

import { readWorkspace } from "@/lib/ai-store";
import { recordKind } from "@/lib/ams/record-kinds";
import { workspace } from "@/lib/ams/workspace";
import { RECORD_BINDINGS } from "@/lib/records";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { PermissionRequest } from "@/lib/permissions";

/**
 * POST /api/records/[kind]/delete — take one or many records out of a register.
 *
 * One route for every register, resolved by the kind in the path. A single row
 * is a selection of one, so there is no second endpoint for the singular case,
 * and there is no per-kind copy of this handler — two write paths for one
 * operation is the second permission gate somebody eventually forgets to add.
 *
 * POST rather than `DELETE` with a body. A body on a `DELETE` is legal and
 * widely mishandled by proxies and CDNs, and the ids are the entire request; a
 * delete that silently arrived with no ids would answer "nothing to do" and
 * look like a bug in the screen.
 *
 * **Soft, and audited before the write.** Each kind's store function sets
 * `deletedAt` and leaves the row on disk with its trail: a governed deletion
 * has to stay answerable, and "who removed this, and when" is the question an
 * auditor asks about a register that used to be longer.
 *
 * **No transaction, so the response says what happened to each id.** The store
 * audits and writes per record. An id that names nothing — another tenant's
 * record, or one somebody else removed while this screen was open — is reported
 * as refused rather than failing the batch: the remaining rows are still meant
 * to go, and a caller who cannot tell which of forty landed has been told
 * nothing.
 *
 * A cross-tenant id is a no-op and not an error, because the rows are read from
 * this organisation's workspace and an id that is not in it is simply not
 * found. "Not in your register" is the whole truth this caller is entitled to.
 */

/** More than a screenful of selections is a script, not a person ticking boxes. */
const MAX_IDS = 200;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const def = recordKind((await params).kind);
  const binding = def ? RECORD_BINDINGS[def.kind] : null;

  /* Both halves have to agree before anything is removed: the registry says the
   * register offers deletion, and the binding says the store can actually do
   * it. A client claiming otherwise is answered rather than trusted. */
  if (!def || !def.features.delete || !binding?.remove) {
    return NextResponse.json(
      { error: "Records in that register cannot be removed." },
      { status: 404 },
    );
  }

  const auth = await requirePermission(
    { [def.resource]: ["delete"] } as PermissionRequest,
    `remove a ${def.singular} from the ${def.title.toLowerCase()}`,
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

  /* Read once, for the names. The response names what went rather than counting
   * it, because "3 removed" is not something anybody can check against what
   * they meant to select. The store re-reads and no-ops on a row already gone,
   * so this is not the guard — it is how we can say which id was which. */
  const ws = workspace(await readWorkspace(organizationId, {}));
  const present = new Map(
    binding.rows(ws).map((row) => [row.id, nameOf(row)] as const),
  );

  const deleted: { id: string; name: string }[] = [];
  const refused: { id: string; reason: string }[] = [];

  for (const id of ids) {
    const name = present.get(id);

    if (name === undefined) {
      refused.push({
        id,
        reason: "No longer in your register — it may already have been removed.",
      });
      continue;
    }

    await binding.remove(organizationId, id, { userId });
    deleted.push({ id, name });
  }

  return NextResponse.json({ ok: true, deleted, refused });
}

/**
 * What to call a record in the response.
 *
 * Registers name their records differently — a system has a `name`, a risk and
 * a finding have a `title`, a document has a `filename` — and the confirmation
 * this answers showed the person one of those. Falling back to the id is honest
 * rather than blank: it is what they would see in the URL.
 */
function nameOf(row: { id: string }): string {
  const record = row as Record<string, unknown>;
  for (const field of ["name", "title", "filename", "reference"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return row.id;
}

/**
 * Ids we are willing to act on.
 *
 * Duplicates are collapsed rather than rejected: the same id twice is a screen
 * that double-counted, and deleting it once is what was meant either way.
 */
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
