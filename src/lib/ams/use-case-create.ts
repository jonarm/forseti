/**
 * What adding a use case by hand takes, and what the record starts as.
 *
 * The dialog and the route parse the *same* schema, for the reason
 * `system-create.ts` gives at length: a second copy in the client drifts, and it
 * drifts quietly — the form accepting what the route refuses, or asking for less
 * than the route stores.
 *
 * **At least one `systemId` is required, and this is where this register differs
 * from the risk one.** A risk that names no system is organisation-level and
 * perfectly ordinary; a use case that names none is nothing at all. Several are
 * ordinary too — one purpose is often served by several tools — so the field is
 * a set with a floor of one rather than a single id. The floor is enforced here
 * and again in the route, because the join table cannot express it: a use case
 * with no links is a legal row that means nothing.
 *
 * **The two questions are asked, and asked plainly.** `facesCustomers` and
 * `informsDecisionsAboutPeople` carry most of the regulatory weight — the second
 * pulls a whole fairness and adverse-impact section into an assessment — and
 * they are the two things somebody writing down a use case actually knows. They
 * default to false rather than being required because a checkbox has no unset
 * state to distinguish "no" from "not yet considered", and a required tick box
 * is a tick box people tick.
 *
 * **The tier and the oversight level are required and not defaulted**, for the
 * reason the risk importer refuses a blank rating: a register full of minimal-risk
 * use cases with a human in the loop, because that is what the form filled in,
 * looks assessed and is not.
 *
 * **`assessmentId` cannot be sent.** It is derived on read from the assessment
 * that names this use case, so a create body carrying one would be asserting a
 * link the assessment itself has not made.
 */
import { z } from "zod";

import { DATA_CATEGORY, OVERSIGHT, RISK_TIER } from "./labels";
import { USE_CASE_STATUS } from "./labels";
import { recordId } from "./record-id";
import type { AIUseCase } from "./types";

const keys = (vocab: Record<string, unknown>) =>
  Object.keys(vocab) as [string, ...string[]];

export const USE_CASE_CREATE_SCHEMA = z
  .object({
    name: z
      .string()
      .trim()
      .min(4, "Name the job this tool is doing, in a phrase somebody would recognise.")
      .max(300),
    /* At least one, and no upper bound worth naming: a purpose served by every
     * tool in the inventory is unusual rather than invalid. The empty array is
     * the refusal — a use case nothing implements is not a use case, and there
     * is no organisation-level form of one the way there is for a risk. */
    systemIds: z
      .array(z.string().trim().min(1).max(200))
      .min(1, "A use case is implemented by at least one system. Choose the ones that run it.")
      .max(100),
    description: z
      .string()
      .trim()
      .min(10, "Say what it actually does, in a sentence — at least 10 characters.")
      .max(20_000),
    businessUnit: z.string().trim().max(200),
    ownerId: z
      .string()
      .trim()
      .min(1, "An unowned use case is one nobody is answerable for.")
      .max(200),
    riskTier: z.enum(keys(RISK_TIER), {
      message: "Choose the tier this use sits at.",
    }),
    oversightLevel: z.enum(keys(OVERSIGHT), {
      message: "Say who is watching the output.",
    }),
    oversightSummary: z
      .string()
      .trim()
      .min(10, "Say how the oversight actually works — at least 10 characters.")
      .max(20_000),
    status: z.enum(keys(USE_CASE_STATUS), {
      message: "Choose where this use case is in its life.",
    }),
    facesCustomers: z.boolean(),
    informsDecisionsAboutPeople: z.boolean(),
    dataCategories: z.array(z.enum(keys(DATA_CATEGORY))).max(20),
    approxUsers: z
      .number()
      .int()
      .min(0, "Users cannot be negative.")
      .max(10_000_000),
  })
  .strict();

export type UseCaseCreateInput = z.output<typeof USE_CASE_CREATE_SCHEMA>;

/**
 * A newly recorded use case, covered by no assessment of its own.
 *
 * `assessmentId` is null and stays null until an assessment is opened against
 * it — the link lives on the assessment, and this field is joined back from
 * there on every read.
 */
export function newUseCase(id: string, input: UseCaseCreateInput): AIUseCase {
  return {
    id,
    systemIds: input.systemIds,
    /* A new use case has no pairing that differs yet — it cannot, since the
     * form asks the question once for the purpose. Overrides are recorded
     * later, against the pairing that turned out to be different. */
    systemOverrides: [],
    name: input.name,
    description: input.description,
    businessUnit: input.businessUnit,
    ownerId: input.ownerId,
    riskTier: input.riskTier as AIUseCase["riskTier"],
    oversightLevel: input.oversightLevel as AIUseCase["oversightLevel"],
    oversightSummary: input.oversightSummary,
    facesCustomers: input.facesCustomers,
    informsDecisionsAboutPeople: input.informsDecisionsAboutPeople,
    dataCategories: input.dataCategories as AIUseCase["dataCategories"],
    approxUsers: input.approxUsers,
    status: input.status as AIUseCase["status"],
    assessmentId: null,
  };
}

/** A use case id. See `recordId` for why the suffix is there. */
export function newUseCaseId(name: string, random = Math.random): string {
  return recordId("uc", name, "use-case", random);
}
