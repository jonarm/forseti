/**
 * What opening an impact assessment takes, and what the document starts as.
 *
 * The dialog and the route parse the *same* schema — see `system-create.ts` for
 * why a second copy in the client is worse than it looks.
 *
 * **The three stages are asked for, not inferred.** An assessment is a document
 * with a chain of signatures against it, and the chain has to name three real
 * people in this organisation before anybody can sign anything. The fixtures
 * hold a governance lead and an approver as constants; reading those here would
 * write demo-tenant person ids into a customer's rows, and the seam is invisible
 * — the sign-off bar would render two plausible names belonging to nobody. So
 * the form asks, pre-filling the owner stage from the system's own owner because
 * that one is a fact the register already holds.
 *
 * **Endorsement and approval stay separate**, and the schema refuses to let one
 * person hold both: the governance lead endorses that the assessment was done
 * properly and the approver accepts the residual risk, which are different
 * judgements about different things. Collapsing them is how an assessment ends
 * up approved by the person who checked it.
 *
 * **`status` starts `not_started` and `answers` starts empty.** Neither is on the
 * wire. A create route that accepted a status could land an assessment already
 * marked approved with an empty sign-off chain behind it, which is the same lie
 * `SYSTEM_CREATE_SCHEMA` refuses `assessmentStatus` to prevent — and here it
 * would also make the system it covers read as assessed on the inventory.
 */
import { z } from "zod";

import { IMPACT_TEMPLATE } from "./fixtures/assessment-template";
import { recordId } from "./record-id";
import type { AssessmentInstance, SignOffStage } from "./types";

/**
 * What each stage is called, in the order it happens.
 *
 * Here rather than beside the fixtures because it is the document's structure
 * rather than demo data: the fixture builder reads these too, so a stage cannot
 * be labelled one way in a seeded assessment and another way in one somebody
 * opened this morning.
 */
export const SIGN_OFF_STAGES: { stage: SignOffStage; label: string }[] = [
  { stage: "owner_submit", label: "Owner submits" },
  { stage: "governance_endorse", label: "Governance Lead endorses" },
  { stage: "approver_approve", label: "Approver accepts residual risk" },
];

export const ASSESSMENT_CREATE_SCHEMA = z
  .object({
    systemId: z
      .string()
      .trim()
      .min(1, "An assessment is about a system. Choose the one it covers.")
      .max(200),
    /* Empty means the assessment covers the system as a whole rather than one
     * of its use cases — the normal case for a tool used one way. */
    useCaseId: z.string().trim().max(200),
    dueAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date it is due."),
    ownerId: z
      .string()
      .trim()
      .min(1, "Name the owner who submits it.")
      .max(200),
    endorserId: z
      .string()
      .trim()
      .min(1, "Name the governance lead who endorses it.")
      .max(200),
    approverId: z
      .string()
      .trim()
      .min(1, "Name the approver who accepts the residual risk.")
      .max(200),
  })
  .strict()
  .refine((v) => v.endorserId !== v.approverId, {
    path: ["approverId"],
    message:
      "Endorsement and approval are different judgements. They cannot be the same person.",
  });

export type AssessmentCreateInput = z.output<typeof ASSESSMENT_CREATE_SCHEMA>;

/**
 * A newly opened assessment: nothing answered, nobody signed, the owner up.
 *
 * The first stage is `current` and the other two `pending` — the chain has to
 * start somewhere and it starts where the work does. No stage is `complete`,
 * which is the invariant worth stating: a signature is an act somebody performs
 * here, never a state a record is created in.
 */
export function newAssessment(
  id: string,
  input: AssessmentCreateInput,
  now: Date,
): AssessmentInstance {
  const assignees = [input.ownerId, input.endorserId, input.approverId];

  return {
    id,
    templateId: IMPACT_TEMPLATE.id,
    systemId: input.systemId,
    useCaseId: input.useCaseId || null,
    status: "not_started",
    answers: {},
    signOff: SIGN_OFF_STAGES.map((step, i) => ({
      stage: step.stage,
      label: step.label,
      assigneeId: assignees[i],
      state: i === 0 ? ("current" as const) : ("pending" as const),
      completedAt: null,
    })),
    updatedAt: now.toISOString(),
    dueAt: input.dueAt,
  };
}

/** An assessment id, slugged off the system it covers. */
export function newAssessmentId(systemName: string, random = Math.random): string {
  return recordId("asmt", systemName, "assessment", random);
}

/** How long a freshly opened assessment has before it is late, if nobody says. */
export const DEFAULT_ASSESSMENT_DAYS = 30;

/** The due date a dialog offers before anybody changes it. */
export function defaultAssessmentDue(now: Date): string {
  return new Date(now.getTime() + DEFAULT_ASSESSMENT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
