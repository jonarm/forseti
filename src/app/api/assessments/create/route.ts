import { NextResponse } from "next/server";

import {
  readAiSystem,
  readAssessment,
  readUseCase,
  saveAssessment,
} from "@/lib/ai-store";
import {
  ASSESSMENT_CREATE_SCHEMA,
  newAssessment,
  newAssessmentId,
} from "@/lib/ams/assessment-create";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/assessments/create — open an impact assessment against a system.
 *
 * A sub-path, matching the other two creates, so the three registers do the same
 * thing the same way.
 *
 * **The system is read before anything is written, and that is a tenant check
 * rather than a convenience.** Every other field on the wire is either a date or
 * an `ai_person` id, and neither can point at another organisation's row in a
 * way that matters. `systemId` can: it becomes a foreign key on the assessment
 * and the profile page renders through it, so an id borrowed from another tenant
 * would produce an assessment attached to a system this organisation cannot see.
 * `readAiSystem` filters by `organizationId`, so an id from elsewhere is simply
 * not found — and the assessment is refused rather than orphaned. The system's
 * name also gives the id its slug.
 *
 * **The body cannot carry a status, answers or a signature.** The chain is built
 * by `newAssessment` with the first stage current and nothing complete: a
 * signature is an act somebody performs here, never a state a record arrives in.
 * An assessment created as approved would also make the system it covers read as
 * assessed on the inventory, which is the one column the register cannot afford
 * to have lying.
 *
 * **Answers are not written here.** `saveAssessment` stores the document and its
 * chain; `saveAssessmentAnswers` is the write that touches answers, because it
 * is the one that has to decide whether a material change resets a review. A
 * fresh assessment has nothing to reset.
 */
export async function POST(request: Request) {
  // First, and before the body is read.
  const auth = await requirePermission(
    { assessment: ["create"] },
    "open an impact assessment",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = ASSESSMENT_CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { error: "That assessment could not be opened as sent.", fields: fieldErrors },
      { status: 400 },
    );
  }

  const input = {
    ...parsed.data,
    systemId: cleanLine(parsed.data.systemId),
    useCaseId: cleanLine(parsed.data.useCaseId),
    ownerId: cleanLine(parsed.data.ownerId),
    endorserId: cleanLine(parsed.data.endorserId),
    approverId: cleanLine(parsed.data.approverId),
  };

  const system = await readAiSystem(organizationId, input.systemId);
  if (!system) {
    return NextResponse.json(
      {
        error: "That system could not be opened as sent.",
        fields: { systemId: "That system is not in this organisation's inventory." },
      },
      { status: 400 },
    );
  }

  /*
   * A use case, if named, has to be one this system actually implements.
   *
   * Nothing enforced this before: `ai_assessment.use_case_id` is a plain column
   * with no foreign key, the schema checks only that the *system* is ours, and
   * the pairing was kept honest by the dialog scoping its picker to the chosen
   * system. A client is not a gate — and the drafting context reads the pair as
   * though it agrees (`draft/assessment-field.ts` resolves the system from the
   * assessment and the use cases from that system), so a mismatched pair would
   * produce an assessment whose supporting prose describes a different tool.
   *
   * The check got sharper rather than looser when a use case gained several
   * systems: "does this purpose run on this tool" is now a real question with a
   * real answer, and `readUseCase` carries the whole set to answer it with.
   */
  if (input.useCaseId) {
    const useCase = await readUseCase(organizationId, input.useCaseId);

    if (!useCase) {
      return NextResponse.json(
        {
          error: "That assessment could not be opened as sent.",
          fields: { useCaseId: "That use case is not in this organisation's register." },
        },
        { status: 400 },
      );
    }

    if (!useCase.systemIds.includes(system.id)) {
      return NextResponse.json(
        {
          error: "That assessment could not be opened as sent.",
          fields: {
            useCaseId: `${useCase.name} is not recorded against ${system.name}. Link the system to the use case first, or assess the system as a whole.`,
          },
        },
        { status: 400 },
      );
    }
  }

  let id = newAssessmentId(system.name);
  for (
    let attempt = 0;
    attempt < 5 && (await readAssessment(organizationId, id));
    attempt++
  ) {
    id = newAssessmentId(system.name);
  }

  await saveAssessment(organizationId, newAssessment(id, input, new Date()), { userId });

  const saved = await readAssessment(organizationId, id);
  return NextResponse.json({ ok: true, assessment: saved }, { status: 201 });
}
