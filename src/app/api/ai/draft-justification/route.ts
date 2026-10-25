import { NextResponse } from "next/server";

import { describeAiError } from "@/lib/ai-errors";
import { readWorkspace, saveSuggestion } from "@/lib/ai-store";
import { workspace } from "@/lib/ams/workspace";
import { draftJustification } from "@/lib/draft/justification";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/ai/draft-justification  { controlId, frameworkId? }
 *
 * Proposes why a control is excluded, and stores the proposal as `pending`.
 *
 * Storing before anyone has decided is the point rather than an optimisation:
 * what an auditor needs to see is that a person was shown a recommendation and
 * was able to say no. A proposal that only exists until the tab closes cannot
 * evidence that, and the rejected ones are the ones worth keeping.
 *
 * The body carries selectors only. Every fact the draft is built from is read
 * from this tenant's workspace inside the handler — a caller who could supply
 * the supporting records could supply the conclusion.
 */

// Must exceed the SDK timeout once a model call replaces the stub.
export const maxDuration = 300;

export async function POST(request: Request) {
  // First, before parsing input or reading anything. Drafting spends money the
  // moment the stub becomes a real call, and an unguarded route that only costs
  // money later is still an unguarded route.
  const auth = await requirePermission({ ai: ["draft"] }, "draft a justification");
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

  const { controlId, frameworkId } = body as Record<string, unknown>;
  if (typeof controlId !== "string" || controlId.trim() === "") {
    return NextResponse.json({ error: "A control id is required." }, { status: 400 });
  }
  if (frameworkId !== undefined && typeof frameworkId !== "string") {
    return NextResponse.json({ error: "Expected `frameworkId` to be a string." }, { status: 400 });
  }

  try {
    const data = await readWorkspace(organizationId, frameworkId ? { frameworkId } : {});
    const ws = workspace(data);

    if (!ws.framework) {
      return NextResponse.json(
        { error: "No standard is in scope. Add one before drafting against it." },
        { status: 400 },
      );
    }

    const result = await draftJustification(ws, controlId);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    // Persisted pending: proposed, not applied. Nothing writes into the
    // applicability row until somebody accepts it at /api/suggestions.
    await saveSuggestion(organizationId, result.suggestion, { userId });

    return NextResponse.json({ suggestion: result.suggestion, actorId: userId });
  } catch (err) {
    console.error("[draft-justification]", err);
    const { status, message } = describeAiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
