/**
 * What may be changed about a registered AI system.
 *
 * The schema says which fields an edit may touch, and nothing else — the
 * activity trail is not built here. `saveAiSystem()` diffs the stored row
 * against the one it is handed and writes the entries itself, so a second
 * differ in this file would be a second answer to "what changed", and the two
 * would drift the first time a field was added to one of them.
 *
 * `assessmentStatus` is deliberately absent. It is moved by the sign-off chain,
 * and a dropdown that lets somebody mark a system "approved" without an
 * assessment behind it makes the register lie in the most useful column.
 *
 * `origin` is present, and it is the one field here with a consequence beyond
 * its own row: it selects the assessment question set, which the renderer
 * resolves live rather than from a snapshot, so changing it hides the sections
 * the old origin asked for. It is editable anyway. An import takes origin from a
 * spreadsheet column, and an origin nobody can correct is the wrong question set
 * forever — a worse register than one whose sections moved once, visibly, with
 * an audit entry saying who moved them.
 */
import { z } from "zod";

import {
  CHARACTERISTIC,
  DATA_CATEGORY,
  DEPLOYMENT,
  LIFECYCLE,
  ORIGIN,
  RISK_TIER,
} from "./labels";

const line = (max = 200) => z.string().trim().max(max);
const lines = (max = 200) => z.array(line(max)).max(50);

/** An ISO date, or the empty string for "not set". Never a string we could not parse. */
const isoDate = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Not a date.");

const VENDOR_DETAIL = z.object({
  name: line(),
  subProcessors: lines(),
  modelProvider: line().nullable(),
  contractType: z.enum(["enterprise_agreement", "click_through", "trial", "internal"]),
  dataProcessingAgreement: z.boolean(),
  certifications: lines(),
  trainsOnCustomerData: z.boolean(),
  renewalDate: isoDate.nullable(),
});

/**
 * Every editable field, all optional — a patch says what changed and nothing else.
 *
 * `strict()` rather than `strip()`: an unknown key is a client and a server that
 * disagree about the record, and dropping it silently means the person who sent
 * it believes it was saved. Reject rather than repair.
 */
export const SYSTEM_PATCH_SCHEMA = z
  .object({
    name: line().min(2, "Give the system a name people will recognise."),
    vendor: line().min(2, "Name the vendor, or “Built in house”."),
    purpose: z.string().trim().max(20_000),
    businessUnit: line(),
    ownerId: line(),
    isGenAi: z.boolean(),
    origin: z.enum(
      Object.keys(ORIGIN) as [keyof typeof ORIGIN, ...Array<keyof typeof ORIGIN>],
    ),
    lifecycleStage: z.enum(
      Object.keys(LIFECYCLE) as [keyof typeof LIFECYCLE, ...Array<keyof typeof LIFECYCLE>],
    ),
    riskTier: z.enum(
      Object.keys(RISK_TIER) as [keyof typeof RISK_TIER, ...Array<keyof typeof RISK_TIER>],
    ),
    deploymentModel: z.enum(
      Object.keys(DEPLOYMENT) as [keyof typeof DEPLOYMENT, ...Array<keyof typeof DEPLOYMENT>],
    ),
    dataResidency: line(),
    hostingRegions: lines(),
    userGroups: lines(),
    approxUsers: z.number().int().min(0).max(10_000_000),
    dataCategories: z
      .array(
        z.enum(
          Object.keys(DATA_CATEGORY) as [
            keyof typeof DATA_CATEGORY,
            ...Array<keyof typeof DATA_CATEGORY>,
          ],
        ),
      )
      .max(20),
    characteristics: z
      .array(
        z.enum(
          Object.keys(CHARACTERISTIC) as [
            keyof typeof CHARACTERISTIC,
            ...Array<keyof typeof CHARACTERISTIC>,
          ],
        ),
      )
      .max(20),
    nextReviewDate: isoDate,
    vendorDetail: VENDOR_DETAIL,
  })
  .partial()
  .strict();

export type SystemPatch = z.output<typeof SYSTEM_PATCH_SCHEMA>;
