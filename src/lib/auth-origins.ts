/**
 * Which URL this deployment thinks it is, and which origins it will accept.
 *
 * Split out of `auth.ts` so it can be tested. `auth.ts` throws at import when
 * `BETTER_AUTH_SECRET` is missing and constructs the whole Better Auth instance
 * as a side effect, so nothing in it can be exercised in isolation — and this is
 * the part that most needs to be, because getting it wrong fails at runtime, in
 * production, with an error that names the wrong thing.
 *
 * The failure it is written against, in full: a preview deployment answers on a
 * hostname Vercel regenerates every push. Better Auth validates the browser's
 * `Origin` header against `baseURL` plus `trustedOrigins` and refuses a
 * mismatch — correctly, it is a CSRF control. Resolve `baseURL` to a configured
 * production URL and every preview then refuses every sign-in, reporting
 * `Invalid origin: https://<the preview host>` — which names the browser's URL,
 * the one part of the arrangement that is right.
 */

import { APP_ORIGIN } from "./domains";

/** `example.com` -> `https://example.com`. Vercel supplies hosts, not URLs. */
function asOrigin(host: string | undefined): string | undefined {
  return host ? `https://${host}` : undefined;
}

/** The environment this reads. Injectable so the tests need no global mutation. */
export interface DeploymentEnv {
  BETTER_AUTH_URL?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  /* `process.env` carries arbitrary keys, and the index signature is also what
   * stops TypeScript's weak-type check rejecting it: an all-optional interface
   * demands the argument share a declared property, which `ProcessEnv` does not
   * promise. */
  [key: string]: string | undefined;
}

/**
 * The configured URL, unless it is one a deployed app could never be served on.
 *
 * `.env.example` ships `BETTER_AUTH_URL=http://localhost:3000` because that is
 * right locally, and copying that file into Vercel's dashboard is the ordinary
 * way it ends up set in production. The result is an app whose base URL claims
 * localhost while requests arrive on a vercel.app host, and every sign-in fails.
 * Ignoring it when deployed costs nothing: no deployment is served from
 * localhost, so the value cannot have been meant.
 */
export function configuredBaseURL(env: DeploymentEnv): string | undefined {
  const configured = env.BETTER_AUTH_URL;
  if (!configured) return undefined;
  if (!env.VERCEL) return configured;
  return /localhost|127\.0\.0\.1/.test(configured) ? undefined : configured;
}

/**
 * The application's own origin, once deployed.
 *
 * This exists because splitting the deployment across two domains invalidated
 * an assumption the rest of this file was written on.
 * `VERCEL_PROJECT_PRODUCTION_URL` used to be a sound guess at where the app
 * answers — it was the only place it did. It is now the *marketing* domain,
 * which serves one static page and forwards everything else. Resolving
 * `baseURL` to it produced exactly the failure this file's own header warns
 * about, in production, on the live site:
 * `Invalid origin: https://demo.theforseti.ai` — naming the application
 * domain, the one part of the arrangement that was right.
 *
 * Gated on `VERCEL` so a local run still resolves to nothing and lets
 * better-auth default to localhost. A developer's machine is not this
 * deployment, and claiming otherwise would break local sign-in to fix a
 * production bug.
 */
function deployedAppOrigin(env: DeploymentEnv): string | undefined {
  return env.VERCEL ? APP_ORIGIN : undefined;
}

/**
 * Where this deployment lives.
 *
 * Without it Better Auth infers the origin from the incoming request, which
 * makes OAuth callbacks and post-sign-in redirects follow whatever `Host` header
 * arrived — so it is worth setting, and worth setting to the host the browser
 * actually used.
 *
 * **A preview resolves to itself**, ahead of any configured value. That order is
 * the fix: the reverse is what broke sign-in on every preview deployment, and it
 * made `auth.ts` contradict the comment in `.env.example` promising a fallback
 * to `VERCEL_URL` that the code never reached.
 *
 * Returns `undefined` locally, where Better Auth defaults to localhost:3000.
 */
export function resolveBaseURL(env: DeploymentEnv): string | undefined {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) {
    return asOrigin(env.VERCEL_URL);
  }

  return (
    configuredBaseURL(env) ??
    deployedAppOrigin(env) ??
    asOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) ??
    asOrigin(env.VERCEL_URL)
  );
}

/**
 * Every origin this deployment will accept a mutating request from.
 *
 * An explicit list rather than a `https://*.vercel.app` wildcard, which Better
 * Auth would accept and which would trust every site anyone has ever deployed to
 * Vercel — a strange reading of "trusted" for a control whose job is deciding
 * which sites may act on a user's session.
 *
 * The three Vercel values are the hostnames one deployment legitimately answers
 * on: its immutable per-push URL, its branch alias, and the project's production
 * domain. Vercel supplies each per deployment, so nothing here is pinned to a
 * project, a team or a machine.
 */
export function resolveTrustedOrigins(env: DeploymentEnv): string[] {
  const origins = [
    configuredBaseURL(env),
    deployedAppOrigin(env),
    asOrigin(env.VERCEL_PROJECT_PRODUCTION_URL),
    asOrigin(env.VERCEL_URL),
    asOrigin(env.VERCEL_BRANCH_URL),
  ].filter((origin): origin is string => Boolean(origin));

  return [...new Set(origins)];
}
