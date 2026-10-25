import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { APP_ORIGIN, LANDING_ASSET, LANDING_HOST } from "@/lib/domains";

/**
 * Splits one deployment across two hostnames, then redirects signed-out
 * visitors to /sign-in.
 *
 * Both domains are attached to the same Vercel project, so both resolve to the
 * same deployment and the same bundle. Nothing but the `Host` header
 * distinguishes a customer reading the marketing page from a tenant opening
 * their register, which is why the split lives here rather than in a route:
 * `src/app/page.tsx` cannot see the hostname before it has already decided what
 * `/` means.
 *
 * The hosts live in `lib/domains.ts`, because `auth-origins.ts` needs them
 * too: the Vercel production domain is the *marketing* domain now, so it is
 * no longer a usable guess for where the application answers, and Better Auth
 * resolved `baseURL` to it and refused every sign-in until it stopped guessing.
 *
 * Two things this file is deliberately NOT:
 *
 * 1. It is not the security boundary. It checks only for the *presence* of a
 *    session cookie — it does not validate it — so a forged cookie gets past it.
 *    Every page and every API route re-checks the session server-side via
 *    `requireOrgContext()`; that is the gate. Next.js has shipped more than one
 *    middleware auth-bypass CVE, and the proxy docs themselves warn against
 *    relying on shared state here. Treat this as a UX affordance that saves a
 *    signed-out user from a flash of empty dashboard.
 * 2. It is not a database call. Validating the session here would add a round
 *    trip to every request including static assets, to re-derive something the
 *    destination has to check anyway.
 *
 * Next 16 note: this file is `proxy.ts`, not `middleware.ts` — the middleware
 * convention is deprecated. It must NOT export a `runtime` config; proxy runs
 * on Node by default and setting `runtime` throws at build time.
 */


/**
 * Pages a signed-out visitor is meant to reach.
 *
 * These used to be carved out of the matcher below, which was enough while the
 * only question was the session cookie. It is not enough now: the marketing
 * host has to answer for every path to forward it, so the matcher widened and
 * the carve-out moved in here, where the redirect that would otherwise loop
 * `/sign-in` onto itself is.
 */
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/onboarding"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * The requested hostname, lowercased and without any port.
 *
 * Read from the `Host` header, which on Vercel is the domain the browser asked
 * for.
 *
 * **Compared by equality, and it has to be.** The application lives at a
 * subdomain *of the marketing domain*, so `demo.theforseti.ai` ends with
 * `theforseti.ai`: a suffix test — the natural way to write this — matches the
 * application on every request and serves the marketing page to every tenant,
 * the whole product replaced by a brochure. A substring test fails the same
 * way. Previews are the milder version of it: they answer on `*.vercel.app`
 * and must get the build somebody deployed to look at.
 */
function hostOf(request: NextRequest): string {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  return host.split(":")[0].toLowerCase();
}

export function proxy(request: NextRequest) {
  if (hostOf(request) === LANDING_HOST) {
    if (request.nextUrl.pathname === "/") {
      return NextResponse.rewrite(new URL(LANDING_ASSET, request.url));
    }

    /*
     * Everything else belongs to the application, which lives at one origin.
     * Forwarding rather than serving keeps a tenant's session, their bookmarks
     * and their sign-in callbacks on a single hostname — two hosts answering
     * for the same page would mean two sets of cookies and a sign-in that
     * works or does not depending on which link somebody followed.
     *
     * 308 rather than 307: this is permanent and it must stay a GET.
     */
    const onward = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      APP_ORIGIN,
    );
    return NextResponse.redirect(onward, 308);
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = getSessionCookie(request);

  if (!hasSessionCookie) {
    const signIn = new URL("/sign-in", request.url);
    // Preserve where they were headed so sign-in can return them there.
    signIn.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Pages only. Everything below is excluded:
   *
   *   - /api/*  — ALL of it. Redirecting an API call to an HTML sign-in page is
   *     the wrong answer to the wrong audience: a fetch() caller gets a 307 and
   *     a login page where it expected JSON. Every route under /api guards
   *     itself with `requireOrgForApi()` and returns a proper 401/403, which is
   *     both correct for clients and the reason this file is not load-bearing.
   *     It also keeps the evidence upload routes out of proxy's body buffering
   *     (`proxyClientMaxBodySize`, 10MB default), which would otherwise copy
   *     every evidence file in memory for nothing. This exclusion survives the
   *     host split deliberately: the marketing host cannot forward `/api`
   *     without proxy seeing the body, and it has no reason to be asked.
   *   - Next internals and static assets.
   *
   * `/sign-in`, `/sign-up` and `/onboarding` are no longer excluded here. They
   * are reachable signed out — that is what `isPublicPath` is for — but the
   * marketing host has to be able to forward them, and a path excluded from the
   * matcher is a path this file never sees.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\.svg).*)",
  ],
};
