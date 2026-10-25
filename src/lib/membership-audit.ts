import { headers } from "next/headers";

import { writeAudit } from "./ai-store";
import { normaliseRole, ROLE_LABEL } from "./permissions";
import type { AuditEntry } from "./audit";

/**
 * Membership changes, in the audit trail.
 *
 * **The gap this closes.** Every write to Forseti's own tables goes through
 * `ai-store.ts`, which cannot be called without an `Actor` and emits its own
 * trail row. Membership does not: `members-table.tsx` calls Better Auth's
 * endpoints straight from the browser, so promoting somebody to platform admin,
 * removing them, or inviting a stranger produced no record at all. That is the
 * event an auditor asks about first — "who gave them that access, and when" —
 * and it was the one event the trail could not answer.
 *
 * **Hooked at the plugin, not wrapped in a route.** A route of ours would only
 * audit the calls that went through it, leaving Better Auth's own endpoints
 * reachable and silent — and they are reachable, because the client calls them
 * directly today. `organizationHooks` fire inside the plugin however the
 * endpoint was reached, so there is no path that changes a membership without
 * passing here. Same reasoning as the store's required `Actor`: make the rule
 * structural rather than remembered.
 *
 * **These are `after` hooks, and that inverts the store's ordering on purpose.**
 * `ai-store.ts` writes the audit row first, because it owns both writes and can
 * choose. Here Better Auth owns the transaction and has already committed by the
 * time we are called, so there is nothing to order: the row records a fact
 * rather than an intention. The cost is that a failed audit insert leaves a
 * change unrecorded, which is why the failure is logged loudly rather than
 * swallowed — see `recordMembership`.
 *
 * **`subjectId` is the affected user's id, not the member row's.** A member row
 * is deleted and recreated when somebody leaves and rejoins; the user id is
 * stable, so it is the only key that keeps one person's access history together.
 */

/** The shape Better Auth hands these hooks. Narrowed to what the trail needs. */
interface HookMember {
  userId: string;
  role: string;
}
interface HookUser {
  id: string;
  email?: string | null;
  name?: string | null;
}
interface HookOrganization {
  id: string;
}

/**
 * Who is making the change.
 *
 * Better Auth's hook payloads carry the *affected* user and no actor, so the
 * caller is read back from the session. `auth` is referenced lazily — this runs
 * during a request, long after the module graph settles, so the cycle it would
 * otherwise create at import never forms.
 *
 * Returns `null` rather than throwing when the session cannot be read. An
 * unattributed record of a real role change is worth keeping; refusing to write
 * one because the actor is unclear would trade the whole event for a field.
 */
async function actingUserId(): Promise<string | null> {
  try {
    const { auth } = await import("./auth");
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
  } catch (err) {
    console.error("[membership-audit] could not resolve the acting user", err);
    return null;
  }
}

/** How a person reads in the trail: their email, else their name, else their id. */
export function describeUser(user: HookUser): string {
  return user.email || user.name || user.id;
}

/**
 * The role as a person would say it, from whatever string is stored.
 *
 * Through `normaliseRole` so a legacy `owner` or `member` row reads as the role
 * it actually confers rather than as a name nobody uses any more. An audit trail
 * that prints a role the product no longer has invites the reader to guess.
 */
export function describeRole(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABEL[normaliseRole(role)];
}

/**
 * The entries a role change should leave.
 *
 * Pure, so the wording and the before/after are testable without a database or a
 * request. A role change writes one entry naming both ends — the whole question
 * being asked of this record later is "what could they do, and from when".
 */
export function roleChangeEntry(
  member: HookMember,
  previousRole: string | null | undefined,
  user: HookUser,
): AuditEntry {
  return {
    subjectKind: "member",
    subjectId: member.userId,
    action: `changed ${describeUser(user)}'s role`,
    field: "role",
    before: describeRole(previousRole),
    after: describeRole(member.role),
  };
}

/**
 * Append, and shout if it does not land.
 *
 * The membership change has already committed, so there is nothing to roll back
 * and nothing useful to throw at: raising here would fail a request whose work is
 * done, and the user would retry a change that already happened. Logging is the
 * honest response, and it is deliberately at `error` — a silent gap in the trail
 * is exactly the thing this module exists to prevent.
 */
async function recordMembership(
  organizationId: string,
  entry: AuditEntry,
): Promise<void> {
  try {
    await writeAudit(organizationId, { userId: (await actingUserId()) ?? "" }, [entry]);
  } catch (err) {
    console.error("[membership-audit] FAILED to record a membership change", entry, err);
  }
}

/**
 * The hooks handed to `organization()` in `auth.ts`.
 *
 * Deliberately covers invitations as well as memberships. An invitation is the
 * moment access is *granted* — by the time it is accepted the decision has
 * already been made by somebody else — so a trail that recorded only acceptances
 * would name the wrong person for every invited member.
 */
export const membershipAuditHooks = {
  afterUpdateMemberRole: async (data: {
    member: HookMember;
    previousRole?: string | null;
    user: HookUser;
    organization: HookOrganization;
  }) => {
    await recordMembership(
      data.organization.id,
      roleChangeEntry(data.member, data.previousRole, data.user),
    );
  },

  afterAddMember: async (data: {
    member: HookMember;
    user: HookUser;
    organization: HookOrganization;
  }) => {
    await recordMembership(data.organization.id, {
      subjectKind: "member",
      subjectId: data.member.userId,
      action: `added ${describeUser(data.user)} to the organization`,
      field: "role",
      before: null,
      after: describeRole(data.member.role),
    });
  },

  afterRemoveMember: async (data: {
    member: HookMember;
    user: HookUser;
    organization: HookOrganization;
  }) => {
    await recordMembership(data.organization.id, {
      subjectKind: "member",
      subjectId: data.member.userId,
      action: `removed ${describeUser(data.user)} from the organization`,
      field: "role",
      before: describeRole(data.member.role),
      after: null,
    });
  },

  afterCreateInvitation: async (data: {
    invitation: { email: string; role?: string | null };
    organization: HookOrganization;
  }) => {
    await recordMembership(data.organization.id, {
      // No user id exists yet — an invitation names an email, and the email is
      // the only handle the record has until somebody accepts.
      subjectKind: "member",
      subjectId: data.invitation.email,
      action: `invited ${data.invitation.email}`,
      field: "role",
      before: null,
      after: describeRole(data.invitation.role),
    });
  },

  afterCancelInvitation: async (data: {
    invitation: { email: string; role?: string | null };
    organization: HookOrganization;
  }) => {
    await recordMembership(data.organization.id, {
      subjectKind: "member",
      subjectId: data.invitation.email,
      action: `cancelled the invitation to ${data.invitation.email}`,
      field: "role",
      before: describeRole(data.invitation.role),
      after: null,
    });
  },
};
