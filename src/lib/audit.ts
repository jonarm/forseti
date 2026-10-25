/**
 * The audit trail's vocabulary, and the reason a write cannot avoid one.
 *
 * Forseti's tenant boundary works by making the scope impossible to omit:
 * `ai-store.ts` takes `organizationId` first in every function, so a missing
 * `WHERE` is a type error rather than a data leak. **This module does the same
 * thing on the second axis.** Every write in the store takes an `Actor`, and the
 * store emits the audit row itself — so there is no way to express an unaudited
 * write, and no way to write one by forgetting a call. A convention that says
 * "remember to log this" is a convention that is eventually not followed; a
 * required parameter is followed by construction.
 *
 * That is a stronger guarantee than "every write produces an audit event",
 * because it also holds for the writes nobody has written yet. The routes that
 * exist today were made to pass an actor by the compiler, not by review, and the
 * next one will be too.
 *
 * **Ordering: the audit row is written first.** Production runs on Neon's HTTP
 * driver, which has no interactive transactions (`src/db/index.ts` says so and
 * says what to do if that ever needs to change), so the audit insert and the
 * domain write cannot be made atomic here. Given that, the order is a choice
 * between two failure modes: audit-last can lose the record of a write that
 * succeeded, and audit-first can record a change that then failed. Only one of
 * those is survivable in evidence — a trail that over-reports is repairable by
 * reading it, a trail with silent holes is not evidence at all. The store
 * appends a second, explicit failure event when the domain write throws, so the
 * over-report is visible rather than misleading.
 *
 * Nothing here touches the database. It is the vocabulary, the diff and the
 * rules about reasons; `writeAudit()` in `ai-store.ts` is the only insert.
 */

/**
 * What kind of thing an event's `subjectId` names.
 *
 * `subjectId` holds ids from different spaces — a system id, a control id, a
 * Better Auth user id — so without the kind beside it, "show me every
 * membership change" can only be answered by pattern-matching id prefixes,
 * which is a guess dressed up as a query.
 *
 * `record` is the value rows written before the column existed carry. It means
 * "unclassified", and it is deliberately not reconstructed: see `drizzle/0013`.
 */
export type AuditSubjectKind =
  | "system"
  | "use_case"
  | "intake_request"
  | "assessment"
  | "risk"
  | "finding"
  | "evidence"
  | "policy"
  | "control"
  | "applicability"
  | "person"
  | "questionnaire"
  | "review_assignment"
  /** A membership, an invitation, a role change. `subjectId` is a user id. */
  | "member"
  /** The organization itself — settings, profile, deletion. */
  | "organization"
  /** Written before `subject_kind` existed. Unclassified, and stays that way. */
  | "record";

/**
 * Who is making a change, and why.
 *
 * Threaded through every store write as the last argument. `userId` is a Better
 * Auth user id rather than an `ai_person` id, and the distinction matters: an
 * `ai_person` is a name a record can carry and frequently belongs to somebody
 * who has never signed in, whereas an audit trail has to name the account that
 * actually made the request. A trail that names the control's owner when
 * somebody else changed it is worse than no trail.
 */
export interface Actor {
  /** Better Auth user id, from `requireOrgContext()`. Never an `ai_person`. */
  userId: string;
  /**
   * Why, in the actor's own words.
   *
   * Optional at this layer because most edits carry no reason and inventing one
   * would be worse than its absence. The acts where somebody is accountable for
   * a judgement — accepting a risk, closing a finding, overriding a triage —
   * demand one, and `requireReason()` is how a caller demands it.
   */
  reason?: string | null;
  /**
   * Set when this change originated in an AI suggestion the actor accepted.
   *
   * What makes "the model proposed, a person disposed" provable rather than
   * merely plausible. The trail then names both, and only that pair is a
   * defensible answer to "why does the register say this?".
   */
  viaSuggestionId?: string | null;
}

/**
 * The actor for writes with no signed-in user: the seed, a migration backfill,
 * a scheduled job.
 *
 * A real value rather than an optional parameter, because "no actor" and "the
 * system did it" read identically as a null column and mean different things.
 * The id is not a valid Better Auth user id and cannot collide with one.
 */
export const SYSTEM_ACTOR: Actor = { userId: "system" };

/** One row of the trail, before it reaches the database. */
export interface AuditEntry {
  subjectKind: AuditSubjectKind;
  subjectId: string;
  /** Past tense, plain language: "registered a system", "accepted the risk". */
  action: string;
  /** Which field changed, where the event describes one. */
  field?: string | null;
  before?: string | null;
  after?: string | null;
}

/**
 * Demand a reason, for the acts that need defending.
 *
 * Lives here rather than in the store on purpose. `ai-store.ts` is the tenant
 * boundary and deliberately not a policy layer — the seed and the tests write
 * through it directly and must be able to — so the rule about *which* acts
 * require a justification belongs to the caller that knows what act it is
 * performing. This is the function that caller uses, so the message and the
 * threshold are at least the same everywhere.
 *
 * Throws rather than returning a flag: a risk accepted without a recorded reason
 * is not a slightly worse record, it is an acceptance nobody can be held to.
 */
export function requireReason(actor: Actor, action: string): string {
  const reason = (actor.reason ?? "").trim();

  if (reason.length === 0) {
    throw new Error(`A reason is required to ${action}.`);
  }

  return reason;
}

/**
 * Render a value the way the trail stores it.
 *
 * `before` and `after` are text because an audit trail is read, not recomputed:
 * a union of every field type an event could describe would be a type that means
 * nothing and satisfies no auditor. Arrays and objects are rendered rather than
 * JSON-encoded where a person could reasonably read the result, because the
 * audience for this column is somebody in an audit meeting, not a parser.
 *
 * `null` and `undefined` both become `null` — a distinction the column cannot
 * hold and nobody reading it would act on.
 */
export function renderAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    // Comma-separated rather than JSON: these are almost always short string
    // arrays — hosting regions, data categories — and `["EU","UK"]` in an
    // evidence pack is noise where `EU, UK` is a fact.
    return value.map((item) => renderAuditValue(item) ?? "—").join(", ");
  }

  try {
    /*
     * Keys sorted, and that is load bearing rather than tidy.
     *
     * These objects go to Postgres as `jsonb`, which does not preserve key
     * order — so the same unchanged value comes back from a read ordered
     * differently from the object that was written. With `JSON.stringify`'s
     * default ordering, every save of an untouched `vendorDetail` reports
     * itself as a change, and the trail fills with edits nobody made. A false
     * entry in an audit log is worse than a missing feature: it is a fact an
     * auditor will ask somebody to explain, and there is no explanation.
     */
    return JSON.stringify(value, (_key, val) => {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        return Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        );
      }
      return val;
    });
  } catch {
    // A cycle, a BigInt, a function. The trail records that the field changed
    // even when it cannot say to what, which is strictly better than dropping
    // the event because rendering failed.
    return "[unrenderable]";
  }
}

/** A single field's movement, as the trail records it. */
export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/**
 * What actually changed between two versions of a record.
 *
 * Field-level rather than whole-record, because "somebody saved this system" is
 * not something an auditor can act on and "somebody moved it from pilot to
 * production" is. One event per changed field is also the shape the activity
 * panel already renders, so the trail and the screen stay one design.
 *
 * A save that changes nothing produces no events at all. Recording a no-op edit
 * would pad the trail with rows that look like activity, and a trail nobody can
 * skim is one nobody reads.
 *
 * Comparison is on the *rendered* values, deliberately: `0` and `"0"`,
 * `[]` and `null`, `""` and `null` are all the same fact to a reader, and an
 * event claiming a change nobody can see is a false positive in evidence.
 */
export function describeChanges(
  // `object` rather than `Record<string, unknown>`: the callers pass domain
  // interfaces, and a TypeScript interface has no index signature, so the
  // stricter type would reject every real argument.
  before: object | null | undefined,
  after: object,
  /** Restrict to these fields; defaults to every key on `after`. */
  fields?: readonly string[],
): FieldChange[] {
  const to_ = after as Record<string, unknown>;
  const from_ = (before ?? null) as Record<string, unknown> | null;
  const keys = fields ?? Object.keys(to_);
  const changes: FieldChange[] = [];

  for (const field of keys) {
    const to = renderAuditValue(to_[field]);

    if (!from_) {
      // A creation. Only the fields that carry something are worth recording —
      // listing every empty column as "set to nothing" buries the real content.
      if (to !== null) changes.push({ field, before: null, after: to });
      continue;
    }

    const from = renderAuditValue(from_[field]);
    if (from !== to) changes.push({ field, before: from, after: to });
  }

  return changes;
}

/**
 * A stable id for an audit row.
 *
 * `crypto.randomUUID()` rather than a counter or a timestamp: the rows are
 * written from several processes against one database, and the primary key is
 * `(organizationId, id)`. A collision here would not corrupt a row — the insert
 * would fail — but it would fail a write for a reason nobody could diagnose.
 */
export function auditId(): string {
  return `act-${crypto.randomUUID()}`;
}
