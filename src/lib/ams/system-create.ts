/**
 * What registering an AI system takes, and what the record starts as.
 *
 * The dialog and the route parse the *same* schema. A second copy in the client
 * would drift, and the drift is silent in the direction that matters: the form
 * would accept something the route then rejects, or — worse — the form would ask
 * for less than the route stores.
 *
 * **Only the eight fields somebody is actually asked for cross the wire.**
 * Everything else about a new row is decided here, server-side, and that is a
 * boundary rather than a convenience. `SYSTEM_PATCH_SCHEMA` deliberately refuses
 * `assessmentStatus` — "a dropdown that lets somebody mark a system approved
 * without an assessment behind it makes the register lie in the most useful
 * column" — and a create route that accepted a whole `AISystem` would reopen
 * exactly that hole on the way in. `.strict()` for the same reason it is strict
 * there: an unknown key means the client and the server disagree about the
 * record, and dropping it quietly tells the sender it was saved.
 *
 * Registering is not intake. Intake is a requester proposing something and being
 * triaged; this is somebody recording a tool the organisation is already
 * running. Same object at the end, two different jobs.
 */
import { z } from "zod";

import { ORIGIN } from "./labels";
import { recordId } from "./record-id";
import type { AISystem } from "./types";

export const SYSTEM_CREATE_SCHEMA = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Give the system a name people will recognise.")
      .max(200),
    vendor: z
      .string()
      .trim()
      .min(2, "Name the vendor, or “Built in house”.")
      .max(200),
    origin: z.enum(
      Object.keys(ORIGIN) as [keyof typeof ORIGIN, ...Array<keyof typeof ORIGIN>],
      { message: "Origin decides which questions this system has to answer." },
    ),
    isGenAi: z.enum(["yes", "no"], { message: "Say whether it generates content." }),
    businessUnit: z.string().trim().min(1, "Every system needs a business unit.").max(200),
    ownerId: z
      .string()
      .trim()
      .min(1, "An unowned system is a finding waiting to happen.")
      .max(200),
    purpose: z
      .string()
      .trim()
      .min(20, "Describe what it is used for in a sentence — at least 20 characters.")
      .max(20_000),
  })
  .strict();

export type SystemCreateInput = z.output<typeof SYSTEM_CREATE_SCHEMA>;

/** How long a freshly registered system has before somebody has to look again. */
const FIRST_REVIEW_DAYS = 90;

/**
 * When a new row says it was registered, and when it is next due.
 *
 * Shared with the importer so a system that arrived in a batch is on the same
 * clock as one somebody typed. Two windows would mean a review date that
 * depended on how the record got here, which is not a fact about the system.
 */
export function reviewWindow(now: Date): Pick<AISystem, "registeredAt" | "nextReviewDate"> {
  return {
    registeredAt: isoDay(now),
    nextReviewDate: isoDay(new Date(now.getTime() + FIRST_REVIEW_DAYS * 86_400_000)),
  };
}

/**
 * A newly registered system starts unassessed and at minimal risk.
 *
 * Not because it is safe, but because nobody has decided yet — and a register
 * that guesses a risk tier on the way in produces a tier nobody owns. It lands
 * in the attention list instead, which is where a system nobody has looked at
 * belongs.
 *
 * `now` is passed rather than read so the dates are the caller's single clock,
 * and so a test can pin them.
 */
export function newSystem(id: string, input: SystemCreateInput, now: Date): AISystem {
  const isGenAi = input.isGenAi === "yes";

  return {
    id,
    name: input.name,
    vendor: input.vendor,
    origin: input.origin,
    isGenAi,
    businessUnit: input.businessUnit,
    ownerId: input.ownerId,
    lifecycleStage: "proposed",
    riskTier: "minimal",
    assessmentStatus: "not_started",
    purpose: input.purpose,
    deploymentModel: "vendor_multi_tenant",
    hostingRegions: [],
    dataResidency: "Not recorded",
    userGroups: [],
    approxUsers: 0,
    dataCategories: [],
    characteristics: isGenAi ? ["generative"] : [],
    vendorDetail: {
      name: input.vendor,
      subProcessors: [],
      modelProvider: null,
      contractType: input.origin === "internal_model" ? "internal" : "click_through",
      dataProcessingAgreement: false,
      certifications: [],
      trainsOnCustomerData: false,
      renewalDate: null,
    },
    ...reviewWindow(now),
    discoveredVia: "manual",
  };
}

/**
 * A readable id, with enough randomness that two people registering the same
 * tool get two rows.
 *
 * `saveAiSystem` upserts on `(organizationId, id)` and does not fail on a
 * collision — it updates. So a purely name-derived id would mean the second
 * registration of "Convene Notetaker" silently overwrote the first, and nobody
 * would be told. `recordId` carries that argument in full; this is the
 * inventory's prefix over it, kept as a named function because the importer and
 * the route both call it and neither should be choosing a prefix.
 */
export function newSystemId(name: string, random = Math.random): string {
  return recordId("sys", name, "system", random);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
