/**
 * What may be changed about a request already in the queue.
 *
 * A request is an account of something somebody wants to do, and accounts are
 * wrong before they are complete: the vendor turns out to be a reseller, the
 * DPA gets signed, "no personal data" becomes "customer transcripts, actually".
 * Until this existed the only way to correct one was to submit a second request
 * and delete the first, which loses the reference people have already quoted in
 * an email and leaves two rows in the queue for one asking.
 *
 * **The schema can name submission fields and nothing else.** `status`,
 * `reference`, `decision`, `decidedById`, `decidedAt`, `reviewType`,
 * `overrideJustification`, `createdSystemId`, `submittedById`, `submittedAt`
 * and `reviewerId` are all absent, and `strict()` makes sending one a 400
 * rather than a silent drop. That is the rule `POST /api/intake` already states
 * for the same reason: a client that could name its own status could move a
 * request to endorsed without anybody deciding it.
 *
 * **The decision is not here, because a decision is not edited.** What the
 * requester said and what the reviewer concluded are separate records, and
 * `POST /api/intake/decision` refuses a request that already carries one. That
 * separation is what makes an editable submission safe: correcting an answer
 * cannot reach back and rewrite what was decided against the old one.
 *
 * `origin` is editable, and it is the one field with a consequence past its own
 * value — it selects the question set, and `toValueBag` spreads those answers
 * flat for the triage rules, so an answer left behind from the old origin would
 * go on firing a rule that no longer applies. The route clears the answers when
 * origin moves rather than freezing the field: an origin nobody can correct is
 * the wrong question set forever, which is the same judgement `system-patch.ts`
 * records about the same field.
 *
 * The activity trail is not built here. `saveIntakeRequest` diffs the stored
 * row against the one it is handed, so a second differ in this file would be a
 * second answer to "what changed".
 */
import { z } from "zod";

import { DATA_CATEGORY, ORIGIN } from "./labels";

const line = (max = 200) => z.string().trim().max(max);

const ORIGINS = Object.keys(ORIGIN) as [
  keyof typeof ORIGIN,
  ...Array<keyof typeof ORIGIN>,
];

const CATEGORIES = Object.keys(DATA_CATEGORY) as [
  keyof typeof DATA_CATEGORY,
  ...Array<keyof typeof DATA_CATEGORY>,
];

/**
 * One answer to an origin question, in the shapes the question sets produce.
 *
 * Scalars and short string arrays only, and nothing nested — the same bound the
 * create route puts on the bag. These values reach a prompt later through the
 * drafting routes and an auditor's export after that, so what may be stored
 * here is decided once in a schema rather than by whatever the form sent.
 */
const ANSWER = z.union([
  z.string().max(2000),
  z.boolean(),
  z.number(),
  z.array(line()).max(50),
]);

/** What one origin question may hold — the editors commit this, not `unknown`. */
export type IntakeAnswer = z.output<typeof ANSWER>;

/**
 * Every editable field, all optional — a patch says what changed and nothing else.
 *
 * `originAnswers` is a **partial** bag: the route merges it over the stored one
 * rather than replacing it, because the screen commits one answer at a time and
 * a replacing write would clear the other four every time one was corrected.
 */
export const INTAKE_PATCH_SCHEMA = z
  .object({
    name: line().min(2, "Give the request a name people will recognise."),
    description: z.string().trim().max(4000),
    businessUnit: line().min(2, "Name the team asking for this."),
    vendor: line(),
    origin: z.enum(ORIGINS),
    isGenAi: z.boolean(),
    facesCustomers: z.boolean(),
    informsDecisionsAboutPeople: z.boolean(),
    dataCategories: z.array(z.enum(CATEGORIES)).max(20),
    originAnswers: z.record(line(), ANSWER),
  })
  .partial()
  .strict();

export type IntakePatch = z.output<typeof INTAKE_PATCH_SCHEMA>;
