"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, UserPlus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { selectablePeople } from "@/lib/acting-person";
import type { AccountPerson, Person } from "@/lib/ams/types";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from "@/lib/password-policy";
import {
  CREATOR_ROLE,
  LEAST_PRIVILEGED_ROLE,
  refusalNote,
  ROLE_BLURB,
  ROLE_LABEL,
  ROLE_ORDER,
  type RoleName,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * The membership list, and the only place a role is changed.
 *
 * Two rules are enforced here that the server cannot express on its own:
 *
 *   - **An organization must keep an owner.** Better Auth will happily let the
 *     last one demote themselves, which leaves nobody able to manage members,
 *     billing or the framework — an organization that can only be repaired from
 *     the database. Both the demote and the remove refuse it.
 *   - **Demoting yourself is allowed, but confirmed.** It is a legitimate thing
 *     to do and an easy thing to do by accident, and it takes effect on the next
 *     request because `requireOrgContext()` re-reads membership every time.
 *
 * Neither is a security boundary — a determined caller can hit Better Auth's
 * endpoints directly. They are guards against the ordinary mistake.
 *
 * **Adding a user and inviting one are two cards, not one control with a
 * switch.** They are different acts with different consequences: an invitation
 * asks somebody to come and creates nothing until they accept, while adding
 * mints the account and the password that opens it, which the admin then has to
 * carry to them by hand. Collapsing them would hide that difference behind a
 * toggle nobody reads. Adding is the narrower permission of the two — see
 * `uiPermissions().addMembers` — so a governance lead gets the invite card and
 * not the other.
 *
 * **"Acts as" is the third column, and it is not a role.** A role says what an
 * account may do; this says which *person* it is — the human the registers name
 * as an owner, an assignee, an approver. They are separate id spaces on purpose
 * (`ai_person` in `schema.ts`), and this is the only place the crossing is
 * declared. It goes through `/api/account-people` rather than Better Auth,
 * because the mapping is Forseti's and the trail behind it is Forseti's.
 *
 * Nothing is matched by name. "R. Andersen" the person and `lead@…` the account
 * look like the same human, and a product that assumes it eventually signs
 * somebody else's approval with their name. A person already claimed by another
 * account is offered as disabled rather than hidden, so the fix — clear that one
 * first — is visible instead of mysterious.
 */

export interface MemberRow {
  id: string;
  userId: string;
  role: RoleName;
  name: string | null;
  email: string | null;
  isYou: boolean;
}

const BTN =
  "rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-40";

export function MembersTable({
  members,
  people,
  accountPeople,
  canManage,
  canAdd,
  organizationId,
}: {
  members: MemberRow[];
  /** Everyone the registers can name — the options for "Acts as". */
  people: Person[];
  /** The links that already exist, one per account at most. */
  accountPeople: AccountPerson[];
  canManage: boolean;
  /** May mint an account outright. Narrower than `canManage`, deliberately. */
  canAdd: boolean;
  organizationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleName>(LEAST_PRIVILEGED_ROLE);
  const [inviting, setInviting] = useState(false);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<RoleName>(LEAST_PRIVILEGED_ROLE);
  const [showPassword, setShowPassword] = useState(false);
  const [adding, setAdding] = useState(false);

  const admins = members.filter((m) => m.role === CREATOR_ROLE).length;

  /** Which person each account acts as, and which account holds each person. */
  const personOf = new Map(accountPeople.map((row) => [row.userId, row.personId]));
  const heldBy = new Map(accountPeople.map((row) => [row.personId, row.userId]));
  const options = selectablePeople(people);

  /**
   * Say who somebody is — or, with a null person, withdraw the claim.
   *
   * The row's own select is the whole interaction: there is no confirm step,
   * because the act is reversible and its history is in the trail below. What is
   * not reversible is a *wrong* one going unnoticed, which is why the refusals
   * come back from the route as sentences rather than as a silent no-op.
   */
  async function actAs(member: MemberRow, personId: string | null) {
    if ((personOf.get(member.userId) ?? null) === personId) return;

    setError(null);
    setNote(null);
    setBusy(member.id);

    try {
      const response = await fetch("/api/account-people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId, personId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not record who that account is.");
      }

      const who = member.name ?? member.email ?? "That account";
      const person = people.find((p) => p.id === personId);
      setNote(
        person
          ? `${who} now acts as ${person.name}.`
          : `${who} is no longer matched to a person. Records already written keep the name they carry.`,
      );
      // Their next request re-reads the mapping, so anything they decide from
      // here is attributed — no sign-out required.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  /** Would this change leave the organization with nobody to administer it? */
  function lastAdmin(member: MemberRow): boolean {
    return member.role === CREATOR_ROLE && admins <= 1;
  }

  async function changeRole(member: MemberRow, role: RoleName) {
    if (role === member.role) return;
    if (lastAdmin(member)) {
      setError(
        `This is the only ${ROLE_LABEL[CREATOR_ROLE].toLowerCase()}. Promote someone else first, or the organization would be left with nobody who can manage it.`,
      );
      return;
    }

    setError(null);
    setNote(null);
    setBusy(member.id);

    try {
      const { error: err } = await authClient.organization.updateMemberRole({
        memberId: member.id,
        role,
        organizationId,
      });
      if (err) throw new Error(err.message ?? "Could not change that role.");

      setNote(
        `${member.name ?? member.email ?? "That member"} is now a ${ROLE_LABEL[role].toLowerCase()}.`,
      );
      // Their next request re-reads membership, so the change is live
      // immediately — no sign-out required.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: MemberRow) {
    if (lastAdmin(member)) {
      setError(`This is the only ${ROLE_LABEL[CREATOR_ROLE].toLowerCase()} and cannot be removed.`);
      setConfirming(null);
      return;
    }

    setError(null);
    setBusy(member.id);

    try {
      const { error: err } = await authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId,
      });
      if (err) throw new Error(err.message ?? "Could not remove that member.");

      setNote(`${member.name ?? member.email ?? "That member"} was removed.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  /**
   * Create the account, and say so without repeating the password back.
   *
   * The note names who was added and what they can do; it does not echo the
   * password, because the admin typed it and already has it, and a credential
   * left sitting on a screen behind somebody is a credential in a photograph.
   * The fields are cleared for the same reason.
   */
  async function addUser(e: React.FormEvent) {
    e.preventDefault();

    setError(null);
    setNote(null);
    setAdding(true);

    try {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not create that account.");
      }

      setNote(
        `${newName.trim()} can now sign in as a ${ROLE_LABEL[newRole].toLowerCase()}. Give them the password you set — it is not emailed, and it is not shown again.`,
      );
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setShowPassword(false);
      setNewRole(LEAST_PRIVILEGED_ROLE);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAdding(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;

    setError(null);
    setNote(null);
    setInviting(true);

    try {
      const { error: err } = await authClient.organization.inviteMember({
        email,
        role: inviteRole,
        organizationId,
      });
      if (err) throw new Error(err.message ?? "Could not send that invitation.");

      setNote(`Invited ${email} as a ${ROLE_LABEL[inviteRole].toLowerCase()}.`);
      setInviteEmail("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <p className="text-xs text-muted-foreground">
          You can see who is in this organization. Changing roles and inviting
          people are admin permissions.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical/10 p-3 text-sm text-critical">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {note && <p className="text-xs text-ok">{note}</p>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/40">
              <th className="px-4 py-2.5 text-left font-mono text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Member
              </th>
              <th className="px-4 py-2.5 text-left font-mono text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Role
              </th>
              <th className="px-4 py-2.5 text-left font-mono text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Acts as
              </th>
              <th className="px-4 py-2.5 text-right font-mono text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                {canManage ? "Actions" : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">
                    {member.name ?? member.email ?? "Unknown"}
                    {member.isYou && (
                      <span className="ml-2 text-xs text-muted-foreground">you</span>
                    )}
                  </div>
                  {member.name && member.email && (
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  )}
                </td>

                <td className="px-4 py-2.5">
                  {canManage ? (
                    <select
                      value={member.role}
                      disabled={busy === member.id}
                      onChange={(e) => changeRole(member, e.target.value as RoleName)}
                      className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:border-primary"
                      title={ROLE_BLURB[member.role]}
                    >
                      {ROLE_ORDER.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span title={ROLE_BLURB[member.role]}>{ROLE_LABEL[member.role]}</span>
                  )}
                  <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                    {ROLE_BLURB[member.role]}
                  </p>
                </td>

                <td className="px-4 py-2.5">
                  {/* Disabled rather than absent when the caller may not manage
                    * members: who somebody is, is worth reading even by people
                    * who cannot change it, and a missing control is a question
                    * where a disabled one is an answer. */}
                  <select
                    value={personOf.get(member.userId) ?? ""}
                    disabled={!canManage || busy === member.id}
                    onChange={(e) => actAs(member, e.target.value || null)}
                    className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:border-primary disabled:opacity-60"
                    title={
                      canManage
                        ? "Which person in the registers this account is"
                        : refusalNote("say which person an account acts as")
                    }
                  >
                    <option value="">Not matched</option>
                    {options.map((person) => {
                      const taken = heldBy.get(person.id);
                      return (
                        <option
                          key={person.id}
                          value={person.id}
                          disabled={taken !== undefined && taken !== member.userId}
                        >
                          {person.name} — {person.role}
                          {taken !== undefined && taken !== member.userId
                            ? " (another account)"
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                  {!personOf.has(member.userId) && (
                    <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                      Decisions record the account, not a name.
                    </p>
                  )}
                </td>

                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {canManage &&
                    (confirming === member.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[0.7rem] text-critical">
                          Remove from the organization?
                        </span>
                        <button
                          type="button"
                          className={cn(BTN, "border-critical/50 text-critical")}
                          onClick={() => remove(member)}
                          disabled={busy === member.id}
                        >
                          {busy === member.id ? (
                            <Loader2 className="size-3 animate-spin" aria-hidden />
                          ) : (
                            "Confirm"
                          )}
                        </button>
                        <button
                          type="button"
                          className={BTN}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={cn(BTN, "hover:border-critical hover:text-critical")}
                        onClick={() => setConfirming(member.id)}
                        disabled={lastAdmin(member)}
                        title={
                          lastAdmin(member)
                            ? `The only ${ROLE_LABEL[CREATOR_ROLE].toLowerCase()} cannot be removed`
                            : "Remove from this organization"
                        }
                      >
                        Remove
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {canAdd && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden />
              Add a user
            </p>
            <p className="text-xs text-muted-foreground">
              Creates the account and lets them sign in straight away. Nothing is
              emailed, so pass the password on yourself and ask them to change it.
            </p>

            <form onSubmit={addUser} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Name
                </span>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ada Lovelace"
                  className="w-48 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Email
                </span>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-56 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Initial password
                </span>
                <span className="relative inline-flex items-center">
                  <input
                    /* Revealable on purpose: the admin has to read this back to
                     * somebody, and a masked field they cannot check is how a
                     * typo becomes an account nobody can sign in to. */
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-52 rounded-md border border-border bg-background py-1.5 pl-2.5 pr-8 text-sm outline-none focus-visible:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    className="absolute right-2 text-muted-foreground transition-colors hover:text-foreground"
                    title={showPassword ? "Hide the password" : "Show the password"}
                    aria-label={showPassword ? "Hide the password" : "Show the password"}
                  >
                    {showPassword ? (
                      <EyeOff className="size-3.5" aria-hidden />
                    ) : (
                      <Eye className="size-3.5" aria-hidden />
                    )}
                  </button>
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Role
                </span>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as RoleName)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none"
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={
                  adding ||
                  !newName.trim() ||
                  !newEmail.trim() ||
                  newPassword.length < MIN_PASSWORD_LENGTH
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
              >
                {adding && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Create account
              </button>
            </form>

            {/* Same default as an invitation, and for the same reason: an
              * account that arrived able to answer controls would be a grant
              * nobody chose. Promotion is a separate, visible act. */}
            <p className="text-xs text-muted-foreground">
              {PASSWORD_HINT} {ROLE_BLURB[newRole]}
            </p>
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <UserPlus className="size-4 text-muted-foreground" aria-hidden />
              Invite someone
            </p>

            <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-64 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as RoleName)}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none"
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
              >
                {inviting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Send invitation
              </button>
            </form>

            {/*
              New people default to Viewer deliberately — an invitation that
              silently granted the ability to answer controls would be a grant
              nobody chose. Promotion is a separate, visible act.
            */}
            <p className="text-xs text-muted-foreground">
              {ROLE_BLURB[inviteRole]}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
