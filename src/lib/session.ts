import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { readActingPersonId, readRoleGrants } from "./ai-store";
import { auth } from "./auth";
import {
  can,
  refusalNote,
  type OrgGrants,
  type PermissionRequest,
} from "./permissions";

/**
 * The tenant boundary.
 *
 * `src/proxy.ts` only checks that a session cookie exists; it does not validate
 * it. This module is what actually decides who the caller is and which
 * organization they are acting as, and every page and every API route calls it
 * before touching data. Nothing in `src/lib/ai-store.ts` can be reached without
 * an `organizationId`, and this is the only place one comes from.
 */

export interface OrgContext {
  userId: string;
  organizationId: string;
  /**
   * The person this account *is*, in this organization, or null.
   *
   * The account and the person are separate id spaces on purpose — an
   * `ai_person` is frequently somebody who has never signed in — and this is
   * the resolved crossing between them, read from `ai_account_person`. Null is
   * the ordinary state for a member nobody has matched yet, not an error: see
   * `acting-person.ts`, which is where the rule about what to do with a null
   * lives. **Never use it as the actor of a write** — `Actor.userId` is the
   * account, always, and the two answer different questions.
   */
  personId: string | null;
  /**
   * The caller's role in this organization, as stored.
   *
   * A raw string rather than a union: rows written before `permissions.ts`
   * existed carry Better Auth's `member`, and a union here would make those a
   * type error at the boundary instead of something `normaliseRole()` resolves.
   * Never compare it directly — `can()` is the only thing that reads it.
   */
  role: string;
  /**
   * What the roles mean *in this organization*, where it has changed them.
   *
   * Resolved here rather than read wherever a check happens, so there is one
   * answer per request and no screen can render the shipped matrix for a tenant
   * that has edited it. An absent entry after a successful read means the code
   * default. A failed read aborts context resolution rather than restoring
   * permissions that the tenant may have removed.
   */
  grants: OrgGrants;
}

/** Distinguishes "not signed in" from "signed in but no org yet" for callers. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export class NoActiveOrganizationError extends Error {
  constructor() {
    super("No active organization for this session.");
    this.name = "NoActiveOrganizationError";
  }
}

/** The raw session, or null. Use when absence is an expected, handled state. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Resolve the caller and their active organization, or throw.
 *
 * Throws rather than returning null so a caller cannot accidentally proceed
 * with an undefined tenant: there is no falsy `organizationId` that could slip
 * into a query and match another org's rows.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const session = await getSession();

  if (!session?.user) {
    throw new UnauthenticatedError();
  }

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    // Signed in, but either mid-onboarding or their last active org was
    // deleted. The caller decides whether that means /onboarding or a 400.
    throw new NoActiveOrganizationError();
  }

  // Re-read membership rather than trusting the session's copy: a role change
  // or a removal should take effect on the next request, not on the next login.
  const members = await auth.api.listMembers({
    headers: await headers(),
    query: { organizationId },
  });

  const membership = members?.members?.find(
    (m: { userId: string }) => m.userId === session.user.id,
  );

  if (!membership) {
    // The session names an org this user is no longer a member of. Treat it as
    // no active org rather than authorising against a stale claim.
    throw new NoActiveOrganizationError();
  }

  /* After the membership check, not beside it: an id resolved for somebody who
   * turns out not to be a member is work done for a caller who gets nothing.
   * It degrades to null rather than throwing, so a broken mapping table costs
   * attribution on the next write and not the whole request. */
  /* Both after the membership check, and together: neither is needed by a caller
   * who turns out not to be a member, and serialising them would add a round
   * trip to every request for no ordering reason. This is the third and fourth
   * read here — `getSession` and `listMembers` are the first two — which is the
   * cost of resolving a caller completely in one place rather than partially in
   * fourteen. */
  const [personId, grants] = await Promise.all([
    readActingPersonId(organizationId, session.user.id),
    readRoleGrants(organizationId),
  ]);

  return {
    userId: session.user.id,
    organizationId,
    personId,
    role: membership.role,
    grants,
  };
}

/** Map a thrown auth error to an HTTP status and message, for API routes. */
export function describeAuthError(
  err: unknown,
): { status: number; message: string } | null {
  if (err instanceof UnauthenticatedError) {
    return { status: 401, message: "Sign in to continue." };
  }
  if (err instanceof NoActiveOrganizationError) {
    return {
      status: 403,
      message: "Select or create an organization before continuing.",
    };
  }
  return null;
}

/**
 * The tenant check, plus a permission check.
 *
 * Built on `requireOrgForApi()` rather than beside it, so there is no way to
 * authorise an action without also having resolved the tenant — a route cannot
 * accidentally check the role and forget the organization.
 *
 *     const auth = await requirePermission({ control: ["update"] });
 *     if (!auth.ok) return auth.response;
 *
 * **This is the gate.** Whatever the UI shows or hides is a courtesy; every
 * mutating route re-checks here, the same division `describeMissingSupport`
 * already draws between the checklist and `/api/controls`.
 *
 * The 403 names what is required rather than saying "forbidden", because the
 * user's next move — ask an admin — is only obvious if the message says so.
 */
export async function requirePermission(
  permission: PermissionRequest,
  /** What the caller was trying to do, for the message. */
  action = "do that",
): Promise<{ ok: true; ctx: OrgContext } | { ok: false; response: NextResponse }> {
  const auth = await requireOrgForApi();
  if (!auth.ok) return auth;

  if (!can(auth.ctx.role, permission, auth.ctx.grants)) {
    return {
      ok: false,
      response: NextResponse.json({ error: refusalNote(action) }, { status: 403 }),
    };
  }

  return auth;
}

/**
 * The API-route form of `requireOrgContext`.
 *
 * Returns a discriminated union rather than throwing so a route reads as a
 * guard clause and the failure path is impossible to forget:
 *
 *     const auth = await requireOrgForApi();
 *     if (!auth.ok) return auth.response;
 *
 * This must run before any work that costs money. Every AI route in Forseti was
 * reachable unauthenticated before this existed, which made
 * `/api/ai/answer-questionnaire` a free Opus proxy for anyone with the URL.
 */
export async function requireOrgForApi(): Promise<
  { ok: true; ctx: OrgContext } | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, ctx: await requireOrgContext() };
  } catch (err) {
    const described = describeAuthError(err);
    if (described) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: described.message },
          { status: described.status },
        ),
      };
    }
    // Not an auth failure — the session lookup itself broke. Don't leak the
    // reason, but don't misreport it as "sign in" either.
    console.error("[auth]", err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not verify your session. Please try again." },
        { status: 503 },
      ),
    };
  }
}

/*
 * The guard for a scheduled job lives in `./cron-auth`, not here.
 *
 * It verifies a shared secret and touches neither Better Auth nor the database,
 * which is the point: it is what protects the one handler that runs with nobody
 * signed in. Keeping it out of this module keeps that independence honest —
 * importing this file pulls in `auth.ts` and everything it configures, and a
 * scheduled job has no business needing any of it.
 */
export { requireCronRequest } from "./cron-auth";
