import { NextResponse } from "next/server";

import { ConcurrentModificationError, readUseCase, saveUseCase } from "@/lib/ai-store";
import { DATA_CATEGORY, OVERSIGHT, RISK_TIER } from "@/lib/ams/labels";
import { USE_CASE_STATUS } from "@/lib/ams/labels";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { AIUseCase } from "@/lib/ams/types";

/**
 * POST /api/use-cases — correct what a use case says about itself.
 *
 * The register's edit route. Field by field, like the system profile: a use case
 * is written down early and understood later, and the fields most likely to be
 * wrong on the first pass are exactly the ones that decide how much scrutiny it
 * gets — the tier, the oversight, and the two questions.
 *
 * **`expectedVersion` is the guard that matters here.** A governance lead
 * re-tiering a use case while its owner is rewriting the oversight summary is an
 * ordinary Tuesday on this register, and without a version check the second save
 * silently discards the first and nobody is told.
 *
 * **`systemId` is not editable.** Moving a use case to a different system is not
 * a correction, it is a different use case: the risks filed against it, the
 * assessment covering it and the trail behind it all belong to the pairing, and
 * a field-by-field patch would carry none of that across. Recording the new one
 * and removing the old is the honest form of that change, and both halves are
 * already routes.
 *
 * **`assessmentId` is not editable either**, because it is not stored. It is
 * joined on read from the assessment that names this use case; asserting one
 * here would claim an assessment covers something the assessment says nothing
 * about.
 *
 * **This route enforces no gate of its own, and that is a finding about the
 * domain rather than an omission.** A risk has acceptance, a finding has
 * closure, an assessment has sign-off — acts that need defending before they are
 * recorded. A use case has no equivalent: every field is a description of what
 * is happening, and the governance sits downstream in the assessment the tier
 * pulls in. What it does have is a neighbour that arguably ought to care when
 * the tier moves; `saveUseCase` records why it deliberately does not.
 */

/** What a caller may change. `systemId` and `assessmentId` are deliberately absent. */
const EDITABLE = [
  "name",
  "description",
  "businessUnit",
  "ownerId",
  "riskTier",
  "oversightLevel",
  "oversightSummary",
  "facesCustomers",
  "informsDecisionsAboutPeople",
  "dataCategories",
  "approxUsers",
  "status",
] as const;

/** The closed vocabularies, checked against the same maps the screens render. */
const VOCAB: Record<string, Record<string, unknown>> = {
  riskTier: RISK_TIER,
  oversightLevel: OVERSIGHT,
  status: USE_CASE_STATUS,
};

export async function POST(request: Request) {
  // Guard before the body is touched.
  const auth = await requirePermission({ useCase: ["update"] }, "change a use case");
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

  const { useCaseId, changes, expectedVersion } = body as Record<string, unknown>;

  if (typeof useCaseId !== "string" || useCaseId.trim() === "") {
    return NextResponse.json({ error: "A use case id is required." }, { status: 400 });
  }
  if (typeof changes !== "object" || changes === null) {
    return NextResponse.json({ error: "No changes were sent." }, { status: 400 });
  }

  /* Read from this tenant's own rows, so an id belonging to another organization
   * is simply not found rather than being written to. */
  const current = await readUseCase(organizationId, useCaseId);
  if (!current) {
    return NextResponse.json({ error: "That use case no longer exists." }, { status: 404 });
  }

  const patch = changes as Partial<Record<(typeof EDITABLE)[number], unknown>>;
  const next: AIUseCase = { ...current };

  for (const field of EDITABLE) {
    if (!(field in patch)) continue;
    const value = patch[field];

    if (field in VOCAB) {
      if (typeof value !== "string" || !(value in VOCAB[field])) {
        return NextResponse.json(
          { error: `"${String(value)}" is not a ${field} we recognise.` },
          { status: 400 },
        );
      }
      next[field] = value as never;
      continue;
    }

    if (field === "facesCustomers" || field === "informsDecisionsAboutPeople") {
      if (typeof value !== "boolean") {
        return NextResponse.json(
          { error: "That answer is yes or no." },
          { status: 400 },
        );
      }
      next[field] = value;
      continue;
    }

    if (field === "approxUsers") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return NextResponse.json(
          { error: "A user count is a whole number, zero or more." },
          { status: 400 },
        );
      }
      next[field] = value;
      continue;
    }

    if (field === "dataCategories") {
      if (
        !Array.isArray(value) ||
        value.some((dc) => typeof dc !== "string" || !(dc in DATA_CATEGORY))
      ) {
        return NextResponse.json(
          { error: "Those are not data categories we recognise." },
          { status: 400 },
        );
      }
      // The caller sends the complete set it wants, like every link write here.
      next.dataCategories = [...new Set(value)] as AIUseCase["dataCategories"];
      continue;
    }

    if (field === "description" || field === "oversightSummary") {
      // Free text a customer may eventually read, and text the drafting routes
      // will send to a model. Cleaned at the door rather than at that point.
      next[field] = typeof value === "string" ? cleanText(value) : "";
      continue;
    }

    // `name`, `businessUnit`, `ownerId` — one line each.
    next[field as "name" | "businessUnit" | "ownerId"] =
      typeof value === "string" ? cleanLine(value) : "";
  }

  if (!next.name.trim()) {
    return NextResponse.json(
      { error: "A use case needs a name." },
      { status: 400 },
    );
  }

  try {
    await saveUseCase(
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
      // 409, not 500: nothing is broken, somebody else was faster. The message
      // already names both versions and tells them to reload.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  // Return the saved row so the client picks up the new version. A client that
  // kept its own copy would send a stale one on the next save and be refused.
  const saved = await readUseCase(organizationId, useCaseId);
  return NextResponse.json({ ok: true, useCase: saved });
}
