import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/ai-store";
import { auth } from "@/lib/auth";
import { refusedPassword } from "@/lib/password-policy";
import { ROLE_LABEL, ROLE_ORDER, type RoleName } from "@/lib/permissions";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";

/**
 * POST /api/members  { name, email, password, role, reason? }
 *
 * Add a person to this organization by creating their account outright, rather
 * than by inviting them and hoping.
 *
 * **Why this exists beside the invitation form.** `auth.ts` says it plainly: no
 * email transport is wired up. So `organization.inviteMember` writes an
 * `invitation` row, leaves a trail entry, and the invited person never learns
 * they were invited — the flow is complete on our side and inert on theirs. An
 * admin standing up a tenant needs a colleague who can sign in *now*, and the
 * only honest way to do that without mail is to set the first password here and
 * hand it over out of band. The invitation path is left exactly as it was, for
 * the day the mail integration lands.
 *
 * **Deliberately not `auth.api.signUpEmail`.** `nextCookies()` is last in the
 * plugin list precisely so Set-Cookie survives Next's route-handler boundary,
 * and it does that for every endpoint invocation — including one this route
 * makes on the server. Signing the new user up from inside this handler would
 * therefore hand the *admin* the new user's session, silently, in the same
 * response that reported success. So the account is assembled the way
 * `sign-up.mjs` assembles it — hash, `createUser`, `linkAccount` with
 * `providerId: "credential"` — and no session is ever minted.
 *
 * **Not Better Auth's `admin` plugin either.** It has a `createUser` endpoint
 * that would do this, and it also adds `role` and `banned` columns to the user
 * table and a second, global role vocabulary sitting beside the organization
 * roles `permissions.ts` defines. Two answers to "what is this person allowed to
 * do" is the problem that file exists to prevent.
 *
 * **Gated on `role: ["update"]`, not `member: ["create"]`.** The organization
 * plugin's own create statement is held by the governance lead as well, and
 * minting a credential is not the same act as inviting one or changing a role:
 * the password exists, briefly, in the admin's hands. `role: ["update"]` is the
 * statement `platform_admin` holds alone and that no tenant may re-assign — the
 * same lock `/trash` uses, for the same reason. `uiPermissions().addMembers`
 * reads it too, so the button and the route agree by construction.
 *
 * **An email that already has an account is refused, never adopted.** Adding an
 * existing user to this organization would mean either leaving their password
 * alone — quietly ignoring the one the admin just typed — or overwriting it,
 * which is resetting somebody else's credential from another tenant's settings
 * screen. Neither is a thing to do by inference. The refusal names the state so
 * the admin can invite them instead.
 *
 * **Two trail entries, and the first is written before the account exists.**
 * `afterAddMember` in `membership-audit.ts` records the membership, which is
 * Better Auth's own write. It does not record that an account was *created* —
 * the event an auditor asks about first — so this route writes that one itself,
 * audit-first, per `audit.ts`: a trail that over-reports a creation that then
 * failed is repairable by reading it, and a trail with silent holes is not
 * evidence. Its `subjectId` is the email rather than a user id, because there is
 * no user id yet; `afterCreateInvitation` does the same, and the members page
 * resolves emails to names for exactly this reason.
 *
 * Audit-first is only honest with the other half `audit.ts` describes: when the
 * write it announced does not happen, a second, explicit entry says so. Both
 * failure paths below append one, so the over-report is visible in the trail
 * rather than only in a log nobody audits.
 *
 * The two rows do not carry the same reason, and that is the hook's doing rather
 * than a loss: `membership-audit.ts` resolves the actor from the session and has
 * no access to the note typed here, so the justification lands on this route's
 * entries and not on Better Auth's.
 */

/** What the form sends. Parsed by hand — one route, four scalar fields. */
interface Body {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  reason?: unknown;
}

/** Enough to catch a typed mistake; the mailbox is proven by somebody using it. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  // Guard before the body is read: work done ahead of the check is work an
  // unauthorised caller got for free. `route-guards.test.ts` asserts it.
  const guard = await requirePermission(
    { role: ["update"] },
    "add a user to this organization",
  );
  if (!guard.ok) return guard.response;
  const { organizationId, userId: actorUserId } = guard.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  if (typeof body !== "object" || body === null) {
    return bad("Expected a JSON object.");
  }

  const { name, email, password, role, reason } = body as Body;

  const cleanName = cleanLine(name);
  if (!cleanName) return bad("A name is required.");

  const cleanEmail =
    typeof email === "string" ? cleanLine(email).toLowerCase() : "";
  if (!EMAIL.test(cleanEmail)) return bad("A valid email address is required.");

  const refusal = refusedPassword(password);
  if (refusal) return bad(refusal);

  /*
   * The role is matched against the list, never passed through `normaliseRole`.
   * That function's job is to make sense of a string already in the column, and
   * its floor is `auditor` — which is the safe answer when reading and the wrong
   * one when writing. A typo here would silently create somebody with less
   * access than the admin chose, and they would find out by being refused.
   */
  if (typeof role !== "string" || !ROLE_ORDER.includes(role as RoleName)) {
    return bad("Choose one of this organization's roles.");
  }
  const newRole = role as RoleName;

  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(cleanEmail);
  if (existing) {
    return bad(
      `${cleanEmail} already has an account. Invite them instead — setting a password here would overwrite the one they already use.`,
      409,
    );
  }

  const actor = {
    userId: actorUserId,
    /* Carried when given, not demanded. The common case is standing up a tenant,
     * which needs no justification, and demanding one there trains people to
     * type "n/a" — the same reasoning as `/api/account-people`. */
    reason: typeof reason === "string" ? cleanLine(reason) : null,
  };

  await writeAudit(organizationId, actor, [
    {
      subjectKind: "member",
      subjectId: cleanEmail,
      action: `created an account for ${cleanEmail}`,
      field: "role",
      before: null,
      after: ROLE_LABEL[newRole],
    },
  ]);

  /* Hashed before the user row exists, exactly as `sign-up.mjs` does it and for
   * the reason it gives: a hashing failure should break before there is an
   * account to clean up. */
  const hash = await ctx.password.hash(password as string);

  let userId: string;
  try {
    const created = await ctx.internalAdapter.createUser({
      email: cleanEmail,
      name: cleanName,
      emailVerified: false,
    }, { method: "email-password" });
    if (!created) throw new Error("createUser returned nothing");
    userId = created.id;

    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: hash,
    });
  } catch (err) {
    console.error("[members] could not create the account", err);
    /* The entry above announced a creation that did not happen. Retract it in
     * the trail, not only in the log — an auditor reads the one and not the
     * other. Best effort: a failed retraction must not replace a 500 the caller
     * can act on with one they cannot. */
    await writeAudit(organizationId, actor, [
      {
        subjectKind: "member",
        subjectId: cleanEmail,
        action: `failed to create an account for ${cleanEmail}`,
        field: "role",
        before: ROLE_LABEL[newRole],
        after: null,
      },
    ]).catch((e) => console.error("[members] could not retract the audit entry", e));
    return bad("Could not create that account. Try again.", 500);
  }

  try {
    /*
     * Better Auth's own endpoint rather than an insert of ours, because it is
     * what fires `afterAddMember` — the hook `membership-audit.ts` relies on to
     * make every membership change traceable however it was reached. Headers are
     * passed so the hook can resolve *who* did this from the session; the
     * organization is named explicitly so nothing depends on the admin's active
     * one matching the tenant this route already resolved.
     */
    await auth.api.addMember({
      headers: await headers(),
      body: { userId, role: newRole, organizationId },
    });
  } catch (err) {
    /*
     * There is no transaction to fall back on — Neon's HTTP driver has none, and
     * this spans Better Auth's writes as well as ours. So the account is undone
     * by hand. An orphan user with a working credential and no membership is the
     * one outcome worse than the failure itself: they could sign in, land on
     * onboarding, and create an organization nobody expected.
     */
    console.error("[members] could not add the new account to the org", err);

    let removed = true;
    try {
      await ctx.internalAdapter.deleteAccounts(userId);
      await ctx.internalAdapter.deleteUser(userId);
    } catch (cleanup) {
      removed = false;
      console.error("[members] FAILED to clean up an orphaned account", userId, cleanup);
    }

    /* The retraction, and it says which of the two things happened. An account
     * that could not be cleaned up is the one state somebody has to go and fix
     * by hand, so the trail has to name it rather than report a tidy rollback
     * that did not occur. */
    await writeAudit(organizationId, actor, [
      {
        subjectKind: "member",
        subjectId: cleanEmail,
        action: removed
          ? `failed to add ${cleanEmail} to the organization; the account was removed`
          : `failed to add ${cleanEmail} to the organization, and the account could not be removed`,
        field: "role",
        before: ROLE_LABEL[newRole],
        after: null,
      },
    ]).catch((e) => console.error("[members] could not retract the audit entry", e));

    return bad("Could not add that person to the organization. Try again.", 500);
  }

  return NextResponse.json({ ok: true, userId, email: cleanEmail, role: newRole });
}
