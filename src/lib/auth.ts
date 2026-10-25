import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { asc, eq } from "drizzle-orm";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";

import { db } from "@/db";
import * as schema from "@/db/schema";

import { CREATOR_ROLE, LEAST_PRIVILEGED_ROLE, ac, roles } from "./permissions";
import { MIN_PASSWORD_LENGTH } from "./password-policy";
import { resolveBaseURL, resolveTrustedOrigins } from "./auth-origins";
import { membershipAuditHooks } from "./membership-audit";

/**
 * Authentication and tenancy.
 *
 * Better Auth rather than a hand-rolled layer because the organization plugin
 * supplies the thing Forseti actually needs — orgs, members, invitations and
 * roles — as tables and endpoints rather than as something to build. The tenant
 * key lands on the session as `activeOrganizationId`, and every scoped query in
 * the app reads it from there (see `src/lib/session.ts`).
 *
 * `nextCookies()` must stay last in the plugin list: it wraps the response so
 * Set-Cookie headers survive Next's server-action and route-handler boundaries,
 * and it can only do that for plugins registered before it.
 */

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.",
  );
}

export const auth = betterAuth({
  appName: "Forseti",
  /* Both read `process.env` here and nowhere else, so the rules live in one
   * tested module rather than in a config object nothing can exercise. */
  baseURL: resolveBaseURL(process.env),
  trustedOrigins: resolveTrustedOrigins(process.env),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  databaseHooks: {
    session: {
      create: {
        /**
         * Select an organization when the session is created.
         *
         * The organization plugin does not do this: a new session starts with
         * `activeOrganizationId` null even when the user belongs to exactly one
         * org. Since every scoped query derives its tenant from that field, the
         * result was a returning user signing in successfully and then being
         * sent to onboarding to create a *second* organization.
         *
         * Oldest membership wins — for the overwhelmingly common single-org
         * case it is the only one, and for multi-org users it is a stable,
         * predictable default they can change with the org switcher.
         */
        before: async (session) => {
          const [firstMembership] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1);

          return {
            data: {
              ...session,
              activeOrganizationId: firstMembership?.organizationId ?? null,
            },
          };
        },
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    // No email transport is wired up yet, so a verification requirement would
    // lock every new account out. This flips on with the mail integration.
    requireEmailVerification: false,
    /* From `password-policy.ts` so the sign-up form, the admin's add-a-user
     * form and this configuration cannot promise three different numbers. */
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },

  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          },
        }
      : {}),
  },

  plugins: [
    organization({
      // A GRC tool is bought by a team, not a person: whoever onboards the
      // company is its owner and can bring the rest of the function in.
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      invitationExpiresIn: 60 * 60 * 24 * 7,

      /**
       * The same access control the app authorises with.
       *
       * Handing `ac` and `roles` to the plugin means Better Auth polices its own
       * member and invitation endpoints from the definitions in
       * `permissions.ts`, rather than from its built-in owner/admin/member set.
       * Without this the plugin would reject `system_owner` and `reviewer` as
       * unknown roles the moment someone tried to assign one.
       */
      ac,
      roles,

      /**
       * The tenant's owner, and what a new member starts as.
       *
       * **`creatorRole` is load bearing, not cosmetic.** Every last-one-out
       * protection the plugin has — you cannot remove, demote or leave as the
       * only holder — compares against this exact string and nothing else. Name
       * a role here that no member holds and an organization can be left with
       * nobody able to administer it, repairable only from the database. Both
       * constants come from `permissions.ts` so this file and the UI guard in
       * `members-table.tsx` cannot drift apart.
       *
       * A new member starts read-only. Better Auth's own default is `member`,
       * which this app reads as a system owner; defaulting an invitation to that
       * would mean every person added to an organization could immediately
       * answer assessments and attach evidence — a grant nobody chose. Promotion
       * is a deliberate act.
       */
      creatorRole: CREATOR_ROLE,
      defaultRole: LEAST_PRIVILEGED_ROLE,

      /**
       * Every membership change, in the audit trail.
       *
       * Hooked here rather than wrapped in a route of ours because the client
       * calls Better Auth's endpoints directly: a route would audit only the
       * calls that chose to use it. These fire inside the plugin, so there is no
       * path that promotes, removes or invites somebody without leaving a record.
       * `membership-audit.ts` argues the rest, including why they are `after`.
       */
      organizationHooks: membershipAuditHooks,
    }),
    twoFactor(),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
