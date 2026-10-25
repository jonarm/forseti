import { NextResponse } from "next/server";

import { describeAiError } from "@/lib/ai-errors";
import { readWorkspace, saveSuggestion } from "@/lib/ai-store";
import { workspace } from "@/lib/ams/workspace";
import { draftAssessmentField } from "@/lib/draft/assessment-field";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/ai/draft-assessment-field  { assessmentId, fieldId, label?, help? }
 *
 * Drafts one impact-assessment answer and stores it as `pending`.
 *
 * `label` and `help` are the template's own copy, passed through so the draft
 * can name the question it is answering. They are the one exception to
 * "selectors only", and a deliberate one: the template config lives in the
 * client bundle rather than the database, so the server cannot look them up.
 * They are treated as **untrusted** for exactly that reason — a caller can send
 * anything — which is why they are length-capped here and must be wrapped with
 * `asUntrustedBlock()` before they ever reach a real prompt. They can influence
 * how the answer reads; they cannot reach the facts, which come from the store.
 */

// Must exceed the SDK timeout once a model call replaces the stub.
export const maxDuration = 300;

/** Long enough for a real question, short enough not to be a smuggled prompt. */
const MAX_LABEL = 200;

export async function POST(request: Request) {
  // First, before parsing input or reading anything.
  const auth = await requirePermission({ ai: ["draft"] }, "draft an assessment answer");
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  const limit = await checkRateLimit("questionnaire", organizationId);
  if (!limit.allowed) return rateLimitResponse(limit, "drafting");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { assessmentId, fieldId, label, help } = body as Record<string, unknown>;

  if (typeof assessmentId !== "string" || assessmentId.trim() === "") {
    return NextResponse.json({ error: "An assessment id is required." }, { status: 400 });
  }
  if (typeof fieldId !== "string" || fieldId.trim() === "") {
    return NextResponse.json({ error: "A field id is required." }, { status: 400 });
  }
  // The dotted target address is `<assessmentId>.<fieldId>`, so a dot in either
  // half would make the decision route split it in the wrong place.
  if (assessmentId.includes(".") || fieldId.includes(".")) {
    return NextResponse.json(
      { error: "Assessment and field ids must not contain a dot." },
      { status: 400 },
    );
  }

  try {
    const data = await readWorkspace(organizationId, {});
    const ws = workspace(data);

    const field =
      typeof label === "string"
        ? {
            id: fieldId,
            label: label.slice(0, MAX_LABEL),
            help: typeof help === "string" ? help.slice(0, MAX_LABEL) : undefined,
          }
        : null;

    const result = await draftAssessmentField(ws, assessmentId, fieldId, field);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    // Proposed, not applied. The answer is written only when somebody accepts
    // at /api/suggestions — and that write resets the sign-off chain.
    await saveSuggestion(organizationId, result.suggestion, { userId });

    return NextResponse.json({ suggestion: result.suggestion });
  } catch (err) {
    console.error("[draft-assessment-field]", err);
    const { status, message } = describeAiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
