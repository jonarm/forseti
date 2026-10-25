/**
 * What adding a risk by hand takes, and what the record starts as.
 *
 * The dialog and the route parse the *same* schema, for the reason
 * `system-create.ts` gives at length: a second copy in the client drifts, and it
 * drifts quietly — the form accepting what the route refuses, or asking for less
 * than the route stores.
 *
 * **Nine answers cross the wire and the acceptance does not.** `acceptedById`
 * and `acceptedAt` are forced null here however the form is filled in, which is
 * the same call the importer makes and for the same reason it gives: a risk
 * created as "accepted" has a status, not an acceptance, and carrying one across
 * on the way in would forge a signature. It also keeps the rule that matters
 * trivially true — accepting a residual demands a written justification inside
 * `POST /api/risks`, and a create route that could land an accepted risk would
 * be a way around it.
 *
 * **`status` starts open for the same reason**, rather than being asked for. The
 * three statuses somebody might want on the way in are reachable in one edit on
 * the risk itself, where the acceptance gate is.
 *
 * **The four ratings are required and not defaulted.** A risk without an
 * inherent and a residual rating is a sentence, not a risk; defaulting them
 * produces a register full of 1×1 entries that look assessed and are not, and
 * they sort to the bottom of a register ordered by residual — exactly where
 * nobody will find them again.
 *
 * **A risk that names no system is organisation-level, not broken.** That is the
 * store's rule and it holds here: `systemId` is nullable on purpose, because a
 * risk about "our use of AI generally" is the commonest kind in a real log.
 */
import { z } from "zod";

import { recordId } from "./record-id";
import { TREATMENT } from "./risk-scale";
import type { Risk } from "./types";

/** The 1–5 scale, written once for all four ratings. */
const rating = (what: string) =>
  z
    .number({ message: `Rate the ${what} from 1 to 5.` })
    .int()
    .min(1, `Rate the ${what} from 1 to 5.`)
    .max(5, `Rate the ${what} from 1 to 5.`);

export const RISK_CREATE_SCHEMA = z
  .object({
    title: z
      .string()
      .trim()
      .min(4, "Say what could go wrong, in a phrase somebody can disagree with.")
      .max(300),
    /* Empty means organisation-wide. A `null` would be the same thing, but the
     * form holds a string and a select cannot hold null without a sentinel. */
    systemId: z.string().trim().max(200),
    /*
     * The purpose this risk is about, when it is about one.
     *
     * Empty means the risk is about the system however it is used, which is the
     * common case and the reason this is not required. Where it is filled in,
     * the pair is the subject: "summarising meetings *on this tool*" is a
     * different risk from the tool in general and from the purpose in general,
     * and `ai_risk` has carried both columns since before either was fillable.
     *
     * The route refuses a use case the named system does not implement — the
     * same check `/api/assessments/create` makes, for the same reason.
     */
    useCaseId: z.string().trim().max(200),
    ownerId: z
      .string()
      .trim()
      .min(1, "An unowned risk is one nobody is working on.")
      .max(200),
    treatment: z.enum(
      Object.keys(TREATMENT) as [string, ...string[]],
      { message: "Choose what we are doing about it." },
    ),
    treatmentSummary: z
      .string()
      .trim()
      .min(10, "Say what is being done, in a sentence — at least 10 characters.")
      .max(20_000),
    inherentLikelihood: rating("inherent likelihood"),
    inherentImpact: rating("inherent impact"),
    residualLikelihood: rating("residual likelihood"),
    residualImpact: rating("residual impact"),
  })
  .strict();

export type RiskCreateInput = z.output<typeof RISK_CREATE_SCHEMA>;

/**
 * A newly registered risk: open, owned, and accepted by nobody.
 *
 * `controlIds` starts empty rather than being asked for. Linking a risk to the
 * controls that treat it is work done against the control library on the risk's
 * own page, where the controls are in front of the person doing it; asking for
 * them in a create dialog produces a list typed from memory.
 *
 * `useCaseId` *is* asked for, and is optional. It had been hardcoded null since
 * this file was written, which left `ai_risk.use_case_id` a column only the
 * seed ever populated — the intersection was modelled and unreachable.
 */
export function newRisk(id: string, input: RiskCreateInput): Risk {
  return {
    id,
    title: input.title,
    systemId: input.systemId || null,
    useCaseId: input.useCaseId || null,
    controlIds: [],
    inherentLikelihood: input.inherentLikelihood as Risk["inherentLikelihood"],
    inherentImpact: input.inherentImpact as Risk["inherentImpact"],
    treatment: input.treatment as Risk["treatment"],
    treatmentSummary: input.treatmentSummary,
    residualLikelihood: input.residualLikelihood as Risk["residualLikelihood"],
    residualImpact: input.residualImpact as Risk["residualImpact"],
    ownerId: input.ownerId,
    status: "open",
    acceptedById: null,
    acceptedAt: null,
  };
}

/** A risk id. See `recordId` for why the suffix is there. */
export function newRiskId(title: string, random = Math.random): string {
  return recordId("risk", title, "risk", random);
}
