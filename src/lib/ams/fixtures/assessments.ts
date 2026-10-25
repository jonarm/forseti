/**
 * Assessment instances — the record, not the form.
 *
 * The form itself is a template config (screen 5); what lives here is the state
 * a profile needs to answer "where has this got to and who is holding it up".
 * That is nearly always a sign-off question rather than a completeness one, so
 * `signOff` is the part modelled properly.
 *
 * Three stages, always in the same order: the owner submits what they know, the
 * governance lead endorses that it was done properly, the approver accepts the
 * residual risk. They are separate because they are different judgements made by
 * different people — collapsing endorsement into approval is how an assessment
 * ends up approved by the person who wrote it.
 *
 * `answers` here are partial on purpose. A real assessment in progress is
 * partial, and a fixture where every field is filled makes the completion rail
 * on screen 5 look decorative.
 */
import type { AnswerMap, AssessmentInstance, OversightLevel } from "../types";
import { DATA_CATEGORY, ORIGIN, OVERSIGHT } from "../labels";
import { IMPACT_TEMPLATE } from "./assessment-template";
import { evaluate } from "../predicate";
import { SIGN_OFF_STAGES } from "../assessment-create";
import { APPROVER, GOVERNANCE_LEAD } from "./people";
import type { Workspace } from "../workspace";

const signOff = (
  ownerId: string,
  reached: "owner" | "governance" | "approver" | "done",
  dates: { submitted?: string; endorsed?: string; approved?: string } = {},
): AssessmentInstance["signOff"] => {
  const order = ["owner", "governance", "approver", "done"];
  const at = order.indexOf(reached);
  const state = (i: number) =>
    at > i ? ("complete" as const) : at === i ? ("current" as const) : ("pending" as const);

  /* The stages and their labels come from `assessment-create.ts`, so a seeded
   * assessment and one somebody opened this morning cannot describe the same
   * chain differently. Only the assignees and the dates are fixture data. */
  const assignees = [ownerId, GOVERNANCE_LEAD, APPROVER];
  const completed = [dates.submitted, dates.endorsed, dates.approved];

  return SIGN_OFF_STAGES.map((step, i) => ({
    stage: step.stage,
    label: step.label,
    assigneeId: assignees[i],
    state: state(i),
    completedAt: completed[i] ?? null,
  }));
};

export const ASSESSMENTS: AssessmentInstance[] = [
  {
    id: "asmt-copilot-meetings",
    templateId: "tpl-ai-impact-v2",
    systemId: "sys-m365-copilot",
    useCaseId: "uc-copilot-meetings",
    status: "approved",
    answers: {
      intended_use:
        "Generate notes and action items from Teams meeting recordings for the people who attended or were invited.",
      informs_decisions_about_people: false,
      faces_customers: false,
      oversight_level: "human_in_the_loop",
      benefits:
        "Recovers roughly forty minutes per person per week and makes meeting outcomes legible to people who could not attend.",
      known_limitations:
        "Attribution errors on crosstalk; summaries flatten disagreement, so a contested meeting can read as settled.",
    },
    signOff: signOff("p-devi", "done", {
      submitted: "2026-06-04",
      endorsed: "2026-06-19",
      approved: "2026-06-28",
    }),
    updatedAt: "2026-06-28",
    dueAt: "2027-06-28",
  },
  {
    id: "asmt-copilot-studio",
    templateId: "tpl-ai-impact-v2",
    systemId: "sys-copilot-studio",
    useCaseId: "uc-studio-order-status",
    status: "in_progress",
    answers: {
      intended_use:
        "A public agent on the help centre answering where an order is, from the order system and the shipping feed.",
      informs_decisions_about_people: false,
      faces_customers: true,
      oversight_level: "human_on_the_loop",
      benefits:
        "Deflects around 30% of status enquiries out of the support queue and answers them at any hour.",
      known_limitations: "",
    },
    signOff: signOff("p-hallberg", "owner"),
    updatedAt: "2026-08-04",
    dueAt: "2026-09-15",
  },
  {
    id: "asmt-claim-triage",
    templateId: "tpl-ai-impact-v2",
    systemId: "sys-claim-triage-api",
    useCaseId: "uc-claim-extraction",
    status: "endorsed",
    answers: {
      intended_use:
        "Read an inbound claim, extract the structured fields and propose a routing category for a handler to confirm.",
      informs_decisions_about_people: true,
      faces_customers: false,
      oversight_level: "human_in_the_loop",
      affected_groups: ["claimants"],
      disparity_testing:
        "Override rates are compared quarterly across claim types and claimant segments. No material divergence found in the last two quarters.",
      appeal_route:
        "A claimant may ask for a decision to be re-reviewed by a team lead, who sees the original text alongside the extracted fields.",
      known_limitations:
        "Extraction degrades on handwritten attachments and on claims submitted in languages outside the supported eleven.",
    },
    signOff: signOff("p-ferreira", "approver", {
      submitted: "2026-07-08",
      endorsed: "2026-07-16",
    }),
    updatedAt: "2026-07-16",
    dueAt: "2026-08-20",
  },
  {
    id: "asmt-demand-forecast",
    templateId: "tpl-ai-impact-v2",
    systemId: "sys-demand-forecast",
    useCaseId: "uc-demand-planning",
    status: "approved",
    answers: {
      intended_use: "Forecast weekly order volume by region to set staffing and stock levels.",
      informs_decisions_about_people: false,
      faces_customers: false,
      oversight_level: "human_in_command",
      benefits: "Reduced stockouts by 12% year on year and cut expedited freight spend.",
      known_limitations:
        "Trained on three years of history, so it has never seen a demand shock of the kind that would matter most.",
    },
    signOff: signOff("p-nakamura", "done", {
      submitted: "2026-03-30",
      endorsed: "2026-04-08",
      approved: "2026-04-15",
    }),
    updatedAt: "2026-04-15",
    dueAt: "2027-04-15",
  },
  {
    id: "asmt-talentscreen",
    templateId: "tpl-ai-impact-v2",
    systemId: "sys-talentscreen",
    useCaseId: "uc-talent-screening",
    status: "overdue",
    answers: {
      intended_use:
        "Summarise applications and rank candidates against the role profile to build a recruiter shortlist.",
      informs_decisions_about_people: true,
      faces_customers: false,
      oversight_level: "human_in_the_loop",
      affected_groups: ["applicants", "protected"],
      disparity_testing: "",
      appeal_route: "",
      known_limitations:
        "Vendor supplies aggregate disparity figures across its whole customer base, not ours. We have not tested on our own applicant pool.",
    },
    signOff: signOff("p-boateng", "owner", { submitted: "2025-07-24" }),
    updatedAt: "2026-07-30",
    dueAt: "2026-07-30",
  },
];

/**
 * The answers an assessment starts with, before anyone types anything.
 *
 * This lives in the fixture layer rather than in the renderer on purpose. The
 * renderer's whole claim is that it knows no field names — so the mapping from
 * "what the use case already told us" to "which template field that fills" has
 * to sit next to the template, where knowing a field id is the entire job.
 *
 * Seeding matters beyond convenience: an assessor who has to retype facts the
 * organisation already recorded will eventually retype one of them wrong, and
 * the two records will disagree with nobody noticing which is true.
 */
export function seedAnswers(ws: Workspace, assessment: AssessmentInstance): AnswerMap {
  const useCase = assessment.useCaseId ? ws.getUseCase(assessment.useCaseId) : undefined;
  return {
    informs_decisions_about_people: useCase?.informsDecisionsAboutPeople ?? false,
    faces_customers: useCase?.facesCustomers ?? false,
    oversight_level: useCase?.oversightLevel,
    ...assessment.answers,
  };
}

/**
 * The records a drafted answer cites, so the assessor can go and check them.
 *
 * Also fixture-layer, and for the same reason: picking out "the oversight level"
 * means naming the field that holds it.
 */
export function assessmentContextFacts(
  ws: Workspace,
  assessment: AssessmentInstance,
  answers: AnswerMap,
): { label: string; detail: string }[] {
  const system = ws.systemById(assessment.systemId);
  const useCase = assessment.useCaseId ? ws.getUseCase(assessment.useCaseId) : undefined;
  const oversight = answers.oversight_level as OversightLevel | undefined;

  return [
    system && { label: "Origin", detail: ORIGIN[system.origin].label },
    useCase && { label: "Use case", detail: useCase.description },
    oversight && OVERSIGHT[oversight]
      ? { label: "Oversight recorded", detail: OVERSIGHT[oversight].label }
      : null,
    system && {
      label: "Data declared",
      detail:
        system.dataCategories.map((c) => DATA_CATEGORY[c].label).join(", ") ||
        "none recorded",
    },
  ].filter(Boolean) as { label: string; detail: string }[];
}

/** The stage a reader actually wants: who is holding it, right now. */
export function currentStage(assessment: AssessmentInstance) {
  return assessment.signOff.find((s) => s.state === "current") ?? null;
}

/**
 * How much of an assessment is actually answered.
 *
 * Walks the template the same way the renderer does — evaluating `showIf`
 * against the answers — so the register and the form can never disagree about
 * completion. Counting every required field in the template regardless of
 * visibility would leave every assessment permanently incomplete for questions
 * nobody was asked.
 */
export function assessmentProgress(ws: Workspace, assessment: AssessmentInstance) {
  const answers = seedAnswers(ws, assessment);
  const system = ws.systemById(assessment.systemId);

  const sections = IMPACT_TEMPLATE.sections.filter((section) => {
    if (section.origins && system && !section.origins.includes(system.origin)) return false;
    return section.showIf ? evaluate(section.showIf, answers) : true;
  });

  const required = sections.flatMap((section) =>
    section.fields.filter(
      (field) => field.required && (field.showIf ? evaluate(field.showIf, answers) : true),
    ),
  );

  const done = required.filter((field) => {
    const value = answers[field.id];
    if (value === undefined || value === null || value === "") return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });

  return {
    required: required.length,
    done: done.length,
    percent: required.length === 0 ? 0 : Math.round((done.length / required.length) * 100),
    sections: sections.length,
  };
}
