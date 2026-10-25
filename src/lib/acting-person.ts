import type { Person } from "./ams/types";

/**
 * Who a signed-in account *is*, and what to record when nobody knows.
 *
 * **An `ai_person` is deliberately not a Better Auth user.** `schema.ts` argues
 * that at length and the argument is right: a control owner is frequently
 * somebody who has never signed in, and wiring ownership to `user.id` would make
 * every accountability record conditional on provisioning.
 *
 * What that left open was the other direction — resolving *the signed-in caller*
 * to a person — and for a while nothing answered it. Two files papered over the
 * gap with a hardcoded id, which is how a placeholder becomes permanent: nobody
 * can grep for a decision that was never written down.
 *
 * `ai_account_person` now answers it. One row per member at most, matched by
 * somebody with `member: ["update"]`, and `requireOrgContext()` resolves it into
 * `OrgContext.personId` on every request. That is the only crossing between the
 * two id spaces, and it is a claim somebody made rather than something inferred
 * from a matching name — inferring it is precisely the "plausible-looking guess"
 * this module exists to refuse.
 *
 * **An unmatched caller is still recorded as unattributed, never as a guess.**
 * That is not a leftover: a member nobody has matched yet is the ordinary state
 * of a new seat, and it stays the normal path through this module. An audit
 * trail that confidently names the wrong person is strictly worse than one that
 * names nobody, because the second invites the question and the first closes it.
 * The *account* is recorded correctly either way: every store write takes an
 * `Actor` carrying the real `userId`, and `writeAudit` persists it.
 *
 * **History is not back-filled.** A decision taken before its caller was matched
 * stays unattributed, because that is what was true when it was taken. Nor is it
 * retracted: withdrawing a link says nothing about what was already decided.
 *
 * **One rule for whoever wires the sign-off chain to this.** When comparing the
 * caller to the person a record names, an unmatched caller is never a match.
 * `ctx.personId === step.assigneeId` is wrong, because `null === null` makes
 * every unmatched account the assignee of every unassigned stage — which turns
 * a missing name into an authorisation hole. Require a truthy `personId` first.
 * There is no helper for that comparison here, deliberately: sign-off does not
 * persist yet, nothing may gate on identity until it does, and an exported
 * function nobody calls is how a placeholder becomes permanent — which is the
 * mistake this module exists to have corrected.
 */

/**
 * What to store as the deciding person when the caller is not matched to one.
 *
 * A named constant rather than a bare `null` at each call site, so the reason is
 * attached to the value and `grep UNATTRIBUTED` finds every place that depends
 * on the mapping being absent.
 */
export const UNATTRIBUTED: string | null = null;

/**
 * The person to record as having decided this, from the request's own context.
 *
 * Takes the resolved context rather than doing the lookup, so the tenant
 * boundary stays the one place an account is turned into anything — a resolver
 * that queried here would be a second path to the same answer, reachable
 * without an `organizationId`.
 */
export function actingPersonId(ctx: { personId: string | null }): string | null {
  return ctx.personId ?? UNATTRIBUTED;
}

/**
 * The people who *could* be named, for a picker that asks somebody to choose.
 *
 * Deliberately not a default. Offering a sorted list is a question; silently
 * selecting the first name is an answer nobody gave.
 */
export function selectablePeople(people: Person[]): Person[] {
  return [...people].sort((a, b) => a.name.localeCompare(b.name));
}
