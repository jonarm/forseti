/**
 * What may be changed about one row of the Statement of Applicability.
 *
 * The schema says which fields an edit may touch, and nothing else — the
 * activity trail is not built here. `saveApplicability()` reads the stored row
 * back through `readApplicability`, diffs it against the one it is handed and
 * writes the entries itself, so a second differ in this file would be a second
 * answer to "what changed".
 *
 * **`linkedEvidenceIds` and `appliesToSystemIds` are deliberately absent**, and
 * their absence is what keeps this route safe. Both are join tables that
 * `saveApplicability` rewrites wholesale from whatever row it is handed, so a
 * patch able to name them would let one stale page-load un-claim every system
 * another person added. They are written by routes of their own —
 * `/api/applicability/claim|unclaim` and `/api/records/evidence/cite|uncite` —
 * each additive against a freshly read row.
 *
 * `lastReviewedAt` is absent for a different reason: it says somebody looked at
 * the control and decided it still holds, which is not the same act as changing
 * a field on it. Stamping it on every edit would make "last reviewed" mean "last
 * touched", and the column exists precisely because those differ.
 */
import { z } from "zod";

import { IMPLEMENTATION } from "./labels";

const line = (max = 200) => z.string().trim().max(max);

/**
 * Every editable field, all optional — a patch says what changed and nothing else.
 *
 * `strict()` rather than `strip()`: an unknown key is a client and a server that
 * disagree about the record, and dropping it silently means the person who sent
 * it believes it was saved. Reject rather than repair.
 */
export const APPLICABILITY_PATCH_SCHEMA = z
  .object({
    applicability: z.enum(["yes", "no", "na"]),
    implementationStatus: z.enum(
      Object.keys(IMPLEMENTATION) as [
        keyof typeof IMPLEMENTATION,
        ...Array<keyof typeof IMPLEMENTATION>,
      ],
    ),
    justification: z.string().trim().max(20_000),
    /** The empty string is "unassigned" — the select's own value for it. */
    ownerId: line(),
    linkedPolicyId: line().nullable(),
  })
  .partial()
  .strict();

export type ApplicabilityPatch = z.output<typeof APPLICABILITY_PATCH_SCHEMA>;

/**
 * How much prose an exclusion has to carry.
 *
 * Twenty characters is not a quality bar — nothing here can judge whether the
 * reasoning is any good. It is the floor below which the field is obviously
 * not an answer: "n/a", "-", a stray keystroke. The workbench already drew this
 * line in a warning (`missingJustification`), and the route now enforces the
 * same number so the screen and the server cannot disagree about what counts.
 */
export const MIN_JUSTIFICATION = 20;

/**
 * Whether a row that ends up looking like this may be saved.
 *
 * Evaluated against the **merged** row rather than the patch: somebody changing
 * only the implementation status on an already-excluded control has written no
 * justification in this request and must not be refused for it, and somebody
 * excluding a control cannot escape the rule by sending the fields separately.
 */
export function needsMoreJustification(row: {
  applicability: string;
  justification: string;
}): boolean {
  return row.applicability !== "yes" && row.justification.trim().length < MIN_JUSTIFICATION;
}
