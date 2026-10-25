import { describe, expect, it } from "vitest";

import { APP_ORIGIN } from "./domains";
import {
  configuredBaseURL,
  resolveBaseURL,
  resolveTrustedOrigins,
  type DeploymentEnv,
} from "./auth-origins";

/**
 * Sign-in, on the deployment that actually exists.
 *
 * This is not a unit test written for coverage. Every case here is a shape a
 * real deployment took, and the first one is the shape that shipped broken:
 * `Invalid origin: https://forseti-6iav0w9py-….vercel.app`, with sign-in
 * refused on every preview.
 *
 * The bug is worth restating because it is invisible in a typecheck and in a
 * local run. Better Auth validates the browser's `Origin` against `baseURL` plus
 * `trustedOrigins`; a Vercel preview answers on a hostname regenerated per push;
 * so a `baseURL` resolved to anything else refuses every request. It cannot be
 * caught by a build and it cannot be caught locally, because locally there is no
 * `VERCEL_ENV` and the configured URL is correct.
 */

/** A Vercel preview of this project, with `.env.example` copied into the dashboard. */
const BROKEN_PREVIEW: DeploymentEnv = {
  BETTER_AUTH_URL: "http://localhost:3000",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "forseti-6iav0w9py-jonarmarzan3-3980s-projects.vercel.app",
  VERCEL_BRANCH_URL: "forseti-git-feat-rbac-jonarmarzan3-3980s-projects.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "forseti.vercel.app",
};

describe("the deployment that could not sign in", () => {
  it("resolves a preview to the host the browser is actually on", () => {
    // The whole bug in one assertion. Anything else here and Better Auth refuses
    // the origin, because the origin is this and the base URL was not.
    expect(resolveBaseURL(BROKEN_PREVIEW)).toBe(
      "https://forseti-6iav0w9py-jonarmarzan3-3980s-projects.vercel.app",
    );
  });

  it("trusts that host, so the origin check passes", () => {
    expect(resolveTrustedOrigins(BROKEN_PREVIEW)).toContain(
      "https://forseti-6iav0w9py-jonarmarzan3-3980s-projects.vercel.app",
    );
  });

  it("also trusts the branch alias the same deployment answers on", () => {
    // Vercel serves a preview on both its immutable per-push URL and a branch
    // alias. Trusting only the first breaks the link people actually share.
    expect(resolveTrustedOrigins(BROKEN_PREVIEW)).toContain(
      "https://forseti-git-feat-rbac-jonarmarzan3-3980s-projects.vercel.app",
    );
  });

  it("never trusts the localhost value that was copied in by mistake", () => {
    // Trusting it would be harmless in practice and wrong in principle: a
    // deployed app accepting requests claiming to come from localhost is a
    // control that has stopped meaning anything.
    expect(resolveTrustedOrigins(BROKEN_PREVIEW)).not.toContain("http://localhost:3000");
  });
});

describe("configuredBaseURL", () => {
  it("honours the configured URL when running locally", () => {
    expect(configuredBaseURL({ BETTER_AUTH_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores a localhost URL once deployed", () => {
    // The single most likely misconfiguration, and the one with the least
    // helpful error message.
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect(configuredBaseURL({ BETTER_AUTH_URL: url, VERCEL: "1" }), url).toBeUndefined();
    }
  });

  it("honours a real configured URL once deployed", () => {
    expect(
      configuredBaseURL({ BETTER_AUTH_URL: "https://forseti.example.com", VERCEL: "1" }),
    ).toBe("https://forseti.example.com");
  });
});

describe("resolveBaseURL", () => {
  it("prefers a custom domain in production", () => {
    // Production has a stable hostname and OAuth callbacks are registered
    // against it, so the configured value wins there — it is only preview that
    // must override it.
    expect(
      resolveBaseURL({
        BETTER_AUTH_URL: "https://forseti.example.com",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_URL: "forseti-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "forseti.vercel.app",
      }),
    ).toBe("https://forseti.example.com");
  });

  it("falls back to the application's own origin, not the project's production domain", () => {
    /*
     * This used to expect the production domain, and that was right while the
     * production domain was the only place the app answered. It is the
     * *marketing* domain now — it serves one static page and forwards the rest —
     * so guessing it resolved `baseURL` to a host that never renders the app.
     * That shipped, and refused every sign-in in production with
     * `Invalid origin: https://demo.theforseti.ai`.
     */
    expect(
      resolveBaseURL({
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_URL: "forseti-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "theforseti.ai",
      }),
    ).toBe(APP_ORIGIN);
  });

  it("still lets an explicitly configured URL win over it", () => {
    // The escape hatch stays an escape hatch: the constant is a safety net for
    // an unset variable, not an override of a deliberate one.
    expect(
      resolveBaseURL({
        BETTER_AUTH_URL: "https://forseti.example.com",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "theforseti.ai",
      }),
    ).toBe("https://forseti.example.com");
  });

  it("still leaves a preview resolving to itself", () => {
    // The app origin must not outrank this. A preview answers on a hostname
    // regenerated every push, and pinning it to production is the original bug.
    expect(resolveBaseURL(BROKEN_PREVIEW)).toBe(
      "https://forseti-6iav0w9py-jonarmarzan3-3980s-projects.vercel.app",
    );
  });

  it("leaves local development to better-auth's own default", () => {
    expect(resolveBaseURL({})).toBeUndefined();
  });
});

describe("resolveTrustedOrigins", () => {
  it("is empty locally, so nothing is trusted by accident", () => {
    expect(resolveTrustedOrigins({})).toEqual([]);
  });

  it("does not repeat an origin that arrives twice", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://forseti.vercel.app",
      VERCEL: "1",
      VERCEL_PROJECT_PRODUCTION_URL: "forseti.vercel.app",
    });

    expect(origins).toEqual([...new Set(origins)]);
    expect(origins.filter((o) => o === "https://forseti.vercel.app")).toHaveLength(1);
  });

  it("always trusts the origin the application is actually served from", () => {
    // Without this the deployment refuses its own sign-in form.
    expect(
      resolveTrustedOrigins({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "theforseti.ai" }),
    ).toContain(APP_ORIGIN);
  });

  it("trusts nothing extra when it is not a deployment", () => {
    // The local gate. `resolveTrustedOrigins({})` staying empty is what keeps a
    // developer's machine from claiming to be production.
    expect(resolveTrustedOrigins({})).not.toContain(APP_ORIGIN);
  });

  it("never trusts a wildcard", () => {
    // `https://*.vercel.app` would make this work and would trust every site
    // anyone has ever deployed to Vercel. The list stays exact.
    for (const origin of resolveTrustedOrigins(BROKEN_PREVIEW)) {
      expect(origin, origin).not.toContain("*");
    }
  });
});
