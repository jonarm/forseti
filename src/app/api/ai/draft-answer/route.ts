import { NextResponse } from "next/server";

import { describeAiError } from "@/lib/ai-errors";
import { readWorkspace } from "@/lib/ai-store";
import { workspace } from "@/lib/ams/workspace";
import { draftAnswer } from "@/lib/draft/answer";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/ai/draft-answer  { questionnaireId, questionIds[] }
 *
 * Drafts answers to one or more questions on an inbound questionnaire.
 *
 * **Nothing here is stored, and that is a rule rather than an omission.**
 * `ai_questionnaire_question` has no answer column on purpose: an answer is only
 * safe to send while the evidence behind it is current, so recomputing it when
 * the questionnaire is opened *is* the feature. A draft cached in August would
 * still read as true in November, by which time the DPIA it rests on may have
 * expired and the control may have lapsed. The record worth keeping is the
 * questionnaire — who asked, when it is due, who owns it — and that is already
 * stored.
 *
 * Takes question ids rather than question text. The text is read from the store,
 * so a caller cannot substitute a different question for the one on the record —
 * and the answer that comes back is therefore always an answer to something the
 * organisation was actually asked.
 */

// Must exceed the SDK timeout once a model call replaces the stub.
export const maxDuration = 300;

/**
 * The fan-out cap for "Draft all answers".
 *
 * One request per question would be simpler, but the header button drafts a
 * whole questionnaire and forty parallel requests is a self-inflicted rate
 * limit. Batching here keeps that one click as one call.
 */
const MAX_BATCH = 40;

export async function POST(request: Request) {
  // First, before parsing input or reading anything.
  const auth = await requirePermission({ ai: ["answer"] }, "use the questionnaire copilot");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.ctx;

  const limit = await checkRateLimit("questionnaire", organizationId);
  if (!limit.allowed) return rateLimitResponse(limit, "drafting answers");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { questionnaireId, questionIds } = body as Record<string, unknown>;

  if (typeof questionnaireId !== "string" || questionnaireId.trim() === "") {
    return NextResponse.json({ error: "A questionnaire id is required." }, { status: 400 });
  }
  if (
    !Array.isArray(questionIds) ||
    questionIds.length === 0 ||
    !questionIds.every((id): id is string => typeof id === "string")
  ) {
    return NextResponse.json({ error: "At least one question id is required." }, { status: 400 });
  }
  if (questionIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `That is more than ${MAX_BATCH} questions in one request. Draft them a section at a time.` },
      { status: 400 },
    );
  }

  try {
    const data = await readWorkspace(organizationId, {});
    const ws = workspace(data);

    const questionnaire = ws.questionnaireById(questionnaireId);
    if (!questionnaire) {
      return NextResponse.json({ error: "That questionnaire no longer exists." }, { status: 404 });
    }

    // Resolved against the questionnaire's own question set, so an id belonging
    // to another questionnaire — or another tenant — simply is not found.
    const wanted = new Set(questionIds);
    const questions = questionnaire.questions.filter((q) => wanted.has(q.id));

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "None of those questions belong to this questionnaire." },
        { status: 400 },
      );
    }

    const answers = await Promise.all(questions.map((q) => draftAnswer(ws, q)));

    return NextResponse.json({ answers });
  } catch (err) {
    console.error("[draft-answer]", err);
    const { status, message } = describeAiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
