/**
 * Turning a submitted form into an intake request.
 *
 * The counterpart to `system-create.ts`, and it exists for the same reason:
 * what a request *becomes* is decided on the server, never sent by the client.
 * A browser that could name its own status could submit a request that arrives
 * already endorsed, which is the intake equivalent of registering a system that
 * arrives already approved.
 *
 * **The reference is for people, the id is for the database.** `REQ-2026-0042`
 * is what somebody quotes in an email and what the reviewer searches for; it is
 * deliberately not unique-constrained, because two tenants both starting at
 * 0001 is correct and a global sequence would leak one customer's volume to
 * another. The id carries a random suffix and is the thing that must not
 * collide.
 */
import type { IntakeRequest, IntakeSubmission, ReviewType } from "./types";

/** Base-36, six characters — the same shape and the same argument as a system id. */
function suffix(random: () => number): string {
  return Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
}

export function newRequestId(random: () => number = Math.random): string {
  return `req-${suffix(random)}`;
}

/**
 * A note's id — a UUID, not the six-character suffix a request gets.
 *
 * The difference is not style. Every other record here is written with an
 * upsert, so a suffix collision is an overwrite somebody might notice and the
 * route re-reads to close the gap. A note is written with a plain insert, on
 * purpose — that is what makes it impossible to rewrite one by resending its id
 * — so a collision is a primary key violation and a 500 on a note somebody just
 * typed. `auditId()` reaches for `randomUUID()` for the same reason, and the
 * append-only trail is the same shape of record.
 */
export function newNoteId(): string {
  return `note-${crypto.randomUUID()}`;
}

/** How short a note may be and still be worth keeping. */
export const MIN_NOTE = 2;
/** And how long, matching the decision comments it sits beneath. */
export const MAX_NOTE = 4000;

/**
 * The next human reference for this organisation.
 *
 * **`reference` carries a unique index per organisation**, so this cannot be a
 * row count: soft-deleted requests keep their reference, and counting live rows
 * would hand REQ-2026-0043 to a second request the moment the first was
 * removed. It reads the highest number already issued instead — including the
 * ones in the trash — and adds one.
 *
 * Two simultaneous submissions can still compute the same number. The unique
 * index is what makes that safe: the second insert fails rather than
 * overwriting, and the caller retries. A counter table would remove the retry
 * and add a lock on every submission, which is the wrong trade for a string
 * people read out loud.
 */
export function nextReference(
  existingReferences: readonly string[],
  now: Date,
  attempt = 0,
): string {
  const year = now.getUTCFullYear();

  let highest = 0;
  for (const reference of existingReferences) {
    const match = /-(\d+)$/.exec(reference);
    if (match) highest = Math.max(highest, Number(match[1]));
  }

  return `REQ-${year}-${String(highest + 1 + attempt).padStart(4, "0")}`;
}

/**
 * A submission, become a request awaiting a decision.
 *
 * Everything a reviewer will later fill in starts null rather than empty: a
 * request with `decision: null` has not been looked at, while one with
 * `decision: ""` has been looked at and left blank, and the queue counts those
 * differently.
 */
export function newIntakeRequest(
  submission: IntakeSubmission,
  reviewType: ReviewType,
  who: { personId: string | null },
  reference: string,
  now: Date,
  id: string = newRequestId(),
): IntakeRequest {
  return {
    id,
    reference,
    submission,
    /* The person behind the account, or nobody. Never a guess: an unattributed
     * submission is a fact, and inventing a submitter would put somebody's name
     * on a request they never made. */
    submittedById: who.personId ?? "",
    submittedAt: now.toISOString().slice(0, 10),
    status: "awaiting_decision",
    /* Unassigned until somebody picks it up. The queue's whole job is showing
     * what is waiting, and pre-assigning every request to one person would make
     * that list read as somebody's backlog rather than the organisation's. */
    reviewerId: "",
    /* The triage recommendation, carried but not acted on. The reviewer may
     * depart from it, and the record of what was recommended is what makes that
     * departure visible. */
    reviewType,
    overrideJustification: null,
    decision: null,
    decidedById: null,
    decidedAt: null,
    comments: "",
    createdSystemId: null,
  };
}

/** Which status a decision leaves the request in. */
export const STATUS_AFTER: Record<string, IntakeRequest["status"]> = {
  endorse: "endorsed",
  note: "noted",
  reject: "rejected",
  more_info: "needs_more_info",
};

/**
 * The one decision that asks a question instead of answering one.
 *
 * "Needs more info" is written into `decision` like the other three, and it is
 * not like the other three: it leaves the request **open** — `needs_more_info`
 * is `open: true`, the queue goes on counting the days it has been waiting, and
 * its own blurb says "nothing is registered until it comes back". A decision
 * that is a question has to be answerable twice.
 */
export const REOPENING_DECISION = "more_info";

/**
 * Has a decision settled this request, or merely paused it?
 *
 * The write-once rule exists to protect a decision somebody made — the record's
 * value is that it says what was concluded at the time, and a second tab left
 * open is how that gets quietly rewritten. A request returned to its requester
 * concluded nothing, so refusing the second decision does not protect a record:
 * it strands the request, read-only and still accruing days waiting, with no way
 * back into the queue but to delete it and lose the reference.
 *
 * One predicate rather than three copies of `decision !== "more_info"`, because
 * the decision route, the edit route and the review screen have to agree about
 * which requests are still open — and the failure if they drift is a screen
 * offering a decision the route refuses.
 */
export function isSettled(decision: string | null): boolean {
  return decision !== null && decision !== REOPENING_DECISION;
}
