import { NextResponse } from "next/server";

import { allIntakeReferences, saveIntakeRequest } from "@/lib/ai-store";
import {
  newIntakeRequest,
  newRequestId,
  nextReference,
} from "@/lib/ams/intake-create";
import { triage } from "@/lib/ams/fixtures/intake";
import { cleanLine, cleanText } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { DataCategory, IntakeSubmission, SystemOrigin } from "@/lib/ams/types";

/**
 * POST /api/intake — submit a request for a new AI system.
 *
 * The intake queue was React state over fixtures until this existed: three
 * screens that were real to look at and forgot everything on refresh. A
 * requester filled the form in, watched their request arrive at the top of the
 * queue, and it was gone by the time the reviewer opened it.
 *
 * **The body is the answers, never a request.** Status, reference, reviewer and
 * the decision fields are all decided here — the same rule `POST /api/systems`
 * follows, and for the same reason: a client that could name its own status
 * could submit something that arrives already endorsed.
 *
 * **The triage recommendation is computed here, not carried in.** It used to be
 * read off the body — the wizard runs the same `triage()` to show the requester
 * what will happen, and the route trusted what came back. Storing it is right:
 * the reviewer is shown what the rules suggested, and the record can show
 * whether they departed from it. Trusting the client for it was not. Every
 * input `triage()` needs is already in `clean`, so a value that disagreed with
 * the answers could only be a bug or a forgery, and the forgery is the cheap
 * one: `reviewType` is the baseline `/api/intake/decision` measures a departure
 * against, so a request that arrived claiming "noting" could be decided as
 * noting with no justification asked for and nothing in the record saying the
 * rules had wanted otherwise.
 *
 * It is still **obeyed by nothing**. Status does not depend on it, the reviewer
 * may pick either review type, and the screen shows the recommendation
 * recomputed live beside whatever this stored.
 */

export async function POST(request: Request) {
  const auth = await requirePermission(
    { intake: ["create"] },
    "submit an intake request",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId, personId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { submission } = body as { submission?: unknown };

  const clean = readSubmission(submission);
  if (!clean) {
    return NextResponse.json(
      { error: "That request is missing a name or a business unit." },
      { status: 400 },
    );
  }

  /* Run against the cleaned answers, not the raw ones: a rule reading a field
   * this route trimmed or dropped has to see what was actually stored, or the
   * recommendation on the record would be one nothing can reproduce. */
  const reviewType = triage(clean).suggested;

  /* Every reference this organisation has ever issued, tombstoned ones
   * included — the unique index does not forget a soft-deleted row, so a count
   * of live requests would reissue a reference the moment one was removed. */
  const issued = await allIntakeReferences(organizationId);
  const now = new Date();
  const id = newRequestId();

  /*
   * Retry on a reference collision.
   *
   * Two people submitting at once compute the same next number, and the unique
   * index refuses the second — which is the point of having it. Three attempts
   * is plenty for a race between humans filling in a form, and failing after
   * that is better than looping: it means something other than a race is wrong.
   */
  let created: ReturnType<typeof newIntakeRequest> | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = newIntakeRequest(
      clean,
      reviewType,
      { personId },
      nextReference(issued, now, attempt),
      now,
      id,
    );

    try {
      await saveIntakeRequest(organizationId, candidate, { userId });
      created = candidate;
      break;
    } catch (err) {
      // Anything that is not the reference clashing is not ours to swallow.
      if (!isUniqueViolation(err) || attempt === 2) throw err;
      console.warn("[intake] reference collision, retrying", candidate.reference);
    }
  }

  if (!created) {
    return NextResponse.json(
      { error: "Could not allocate a reference for that request. Please try again." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: true, id: created.id, reference: created.reference },
    { status: 201 },
  );
}

/**
 * Postgres says 23505 when a unique index refuses a row.
 *
 * Matched on the code rather than the message so a translated or reworded
 * server error still lands here, and narrowed to that one code so a genuine
 * failure is never mistaken for a race and retried.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * The form's answers, cleaned at the door.
 *
 * Free text is capped and stripped of control characters; the two enums are
 * checked against their unions rather than trusted, because `origin` selects
 * the question set a system answers for the rest of its life and a value
 * outside the union would leave a request nothing knows how to assess.
 */
function readSubmission(value: unknown): IntakeSubmission | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const name = cleanLine(raw.name, 200);
  const businessUnit = cleanLine(raw.businessUnit, 200);
  if (!name || !businessUnit) return null;

  const origins: SystemOrigin[] = [
    "procured_saas",
    "api_integration",
    "internal_model",
  ];
  const categories: DataCategory[] = [
    "public",
    "internal",
    "confidential",
    "personal",
    "special_category",
    "financial",
    "health",
    "customer_content",
    "source_code",
  ];

  const origin = origins.includes(raw.origin as SystemOrigin)
    ? (raw.origin as SystemOrigin)
    : null;

  const dataCategories = Array.isArray(raw.dataCategories)
    ? raw.dataCategories.filter((c): c is DataCategory =>
        categories.includes(c as DataCategory),
      )
    : [];

  const tri = (v: unknown) => (typeof v === "boolean" ? v : null);

  return {
    name,
    description: cleanText(raw.description, 4000),
    businessUnit,
    origin,
    isGenAi: tri(raw.isGenAi),
    vendor: cleanLine(raw.vendor, 200),
    dataCategories,
    facesCustomers: tri(raw.facesCustomers),
    informsDecisionsAboutPeople: tri(raw.informsDecisionsAboutPeople),
    /* The origin-specific answers are a bag whose shape depends on the question
     * set, so they are stored as they arrive — but only as JSON-safe scalars,
     * and only from an object. */
    originAnswers: readOriginAnswers(raw.originAnswers),
  };
}

function readOriginAnswers(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const out: Record<string, unknown> = {};
  for (const [key, answer] of Object.entries(value as Record<string, unknown>)) {
    const field = cleanLine(key, 200);
    if (!field) continue;

    if (typeof answer === "string") out[field] = cleanText(answer, 2000);
    else if (typeof answer === "boolean" || typeof answer === "number") {
      out[field] = answer;
    } else if (Array.isArray(answer)) {
      out[field] = answer
        .filter((a): a is string => typeof a === "string")
        .map((a) => cleanLine(a, 200));
    }
  }
  return out;
}
