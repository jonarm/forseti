import { NextResponse } from "next/server";

import { ConcurrentModificationError, readAiSystem, saveAiSystem } from "@/lib/ai-store";
import { SYSTEM_PATCH_SCHEMA } from "@/lib/ams/system-patch";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { AISystem } from "@/lib/ams/types";

/**
 * PATCH /api/systems/:id — change what the register says about one AI system.
 *
 * **Read, merge, write — and the read is the tenant boundary, not a null check.**
 * `saveAiSystem` upserts on `(organizationId, id)`, so patching an id belonging
 * to another organisation would not fail: it would create a new row here
 * carrying their id, silently and plausibly. Resolving the row within this
 * organisation first is what makes that a 404. The merge matters for a second
 * reason — the upsert sets every column, so writing a patch straight through
 * would blank every field the patch did not mention.
 *
 * **The activity trail is not written here.** `saveAiSystem` diffs the stored
 * row against the one it is handed and records the entries itself, so a patch
 * setting a field to the value it already holds records nothing without this
 * route having to know that. A second differ in the route would be a second
 * answer to "what changed".
 *
 * `expectedVersion` is optional rather than required, and that is a judgement
 * about this screen rather than a gap: the profile commits one field at a time
 * on blur, so two people editing different fields of the same system is
 * ordinary, and refusing the second edit would be wrong far more often than it
 * would be right. A client that reads a version and sends it back still gets the
 * check.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ systemId: string }> },
) {
  // First, and before the body or the row is read.
  const auth = await requirePermission({ system: ["update"] }, "edit an AI system");
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  const { systemId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { expectedVersion, ...fields } = (body ?? {}) as Record<string, unknown>;

  const parsed = SYSTEM_PATCH_SCHEMA.safeParse(fields);
  if (!parsed.success) {
    // Per field, so the editor that sent it can say what to retype. "That could
    // not be saved" on a screen with twenty editors on it names nothing.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That change could not be saved as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const existing = await readAiSystem(organizationId, systemId);
  if (!existing) {
    return NextResponse.json({ error: "No such system in this organization." }, { status: 404 });
  }

  const next: AISystem = { ...existing, ...sanitise(parsed.data) };

  try {
    await saveAiSystem(
      organizationId,
      next,
      { userId },
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

  // Return the saved row so the client picks up the new version rather than
  // sending a stale one on the next save.
  const saved = await readAiSystem(organizationId, systemId);
  return NextResponse.json({ ok: true, system: saved });
}

/**
 * Anything a person typed is cleaned before it is stored, not before it is shown.
 *
 * A purpose or a sub-processor list is the company describing itself, and it
 * reaches a prompt later through the drafting routes — cleaning at the point of
 * storage means every later reader gets the cleaned text rather than each one
 * remembering to ask for it.
 */
function sanitise(patch: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...patch };

  for (const key of ["name", "vendor", "businessUnit", "dataResidency"] as const) {
    if (typeof clean[key] === "string") clean[key] = cleanLine(clean[key]);
  }
  if (typeof clean.purpose === "string") clean.purpose = cleanText(clean.purpose);

  for (const key of ["hostingRegions", "userGroups"] as const) {
    if (Array.isArray(clean[key])) {
      clean[key] = (clean[key] as string[]).map((v) => cleanLine(v)).filter(Boolean);
    }
  }

  if (clean.vendorDetail && typeof clean.vendorDetail === "object") {
    const detail = clean.vendorDetail as Record<string, unknown>;
    clean.vendorDetail = {
      ...detail,
      name: cleanLine(detail.name),
      modelProvider: detail.modelProvider === null ? null : cleanLine(detail.modelProvider),
      subProcessors: Array.isArray(detail.subProcessors)
        ? (detail.subProcessors as string[]).map((v) => cleanLine(v)).filter(Boolean)
        : [],
      certifications: Array.isArray(detail.certifications)
        ? (detail.certifications as string[]).map((v) => cleanLine(v)).filter(Boolean)
        : [],
    };
  }

  return clean;
}
