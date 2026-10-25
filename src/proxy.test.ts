import { describe, expect, it, vi } from "vitest";

/**
 * Which hostname gets which product, and the redirect loop that widening the
 * matcher would otherwise have shipped.
 *
 * Every case here is a request a real browser makes once two domains point at
 * one Vercel project. None of them can be caught by a typecheck, and none can
 * be caught locally, because locally there is one hostname and it is
 * `localhost`. The two that matter most:
 *
 * 1. **A signed-out visitor on `/sign-in`.** `/sign-in` used to be carved out
 *    of the matcher, so proxy never saw it. The marketing host has to forward
 *    every path, so the matcher widened — and a widened matcher without
 *    `isPublicPath` redirects `/sign-in` to `/sign-in` forever. That is a
 *    locked-out production deployment, from a change about domains.
 * 2. **A preview deployment.** Previews answer on `*.vercel.app`, which is
 *    neither domain. A loose host test would pass there and serve the landing
 *    page instead of the build somebody pushed in order to look at it.
 *
 * `getSessionCookie` is mocked rather than a cookie forged: the point under
 * test is the routing, and the real function's job — reading Better Auth's
 * cookie name out of its own config — is not this file's decision.
 */

const hasCookie = vi.hoisted(() => vi.fn<() => string | null>());

vi.mock("better-auth/cookies", () => ({ getSessionCookie: hasCookie }));

const { proxy, config } = await import("./proxy");
const { NextRequest } = await import("next/server");

/** A request as it arrives: an absolute URL, and the `Host` the browser asked for. */
function request(host: string, path: string) {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

function signedOut() {
  hasCookie.mockReturnValue(null);
}

function signedIn() {
  hasCookie.mockReturnValue("a-session-cookie");
}

describe("the marketing host", () => {
  it("serves the landing page at the bare domain, without changing the URL", () => {
    signedOut();
    const response = proxy(request("theforseti.ai", "/"));

    // A rewrite, not a redirect: the visitor stays on `https://theforseti.ai/`
    // and `landing.html` never appears in the address bar or in a share.
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://theforseti.ai/landing.html",
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not ask a marketing visitor for a session", () => {
    signedOut();
    proxy(request("theforseti.ai", "/"));

    expect(hasCookie).not.toHaveBeenCalled();
  });

  it("forwards an application path to the application origin, preserving the query", () => {
    signedIn();
    const response = proxy(request("theforseti.ai", "/inventory?tab=risks"));

    expect(response.headers.get("location")).toBe(
      "https://demo.theforseti.ai/inventory?tab=risks",
    );
    // 308, so the method survives and the browser stops asking.
    expect(response.status).toBe(308);
  });

  it("forwards sign-in rather than answering it, so one origin holds the session", () => {
    signedOut();
    const response = proxy(request("theforseti.ai", "/sign-in"));

    expect(response.headers.get("location")).toBe(
      "https://demo.theforseti.ai/sign-in",
    );
  });

  it("is matched by hostname equality, so a port does not defeat it", () => {
    signedOut();
    const response = proxy(
      new NextRequest("https://theforseti.ai:443/", {
        headers: { host: "theforseti.ai:443" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/landing.html",
    );
  });
});

describe("the application host", () => {
  it("sends a signed-out visitor to sign-in, remembering where they were headed", () => {
    signedOut();
    const response = proxy(request("demo.theforseti.ai", "/risks"));

    expect(response.headers.get("location")).toBe(
      "https://demo.theforseti.ai/sign-in?next=%2Frisks",
    );
  });

  it("lets a signed-out visitor reach sign-in itself", () => {
    signedOut();
    const response = proxy(request("demo.theforseti.ai", "/sign-in"));

    // The regression the widened matcher would otherwise be: /sign-in
    // redirecting to /sign-in, forever.
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/sign-up", "/onboarding", "/sign-in/anything-nested"])(
    "lets a signed-out visitor reach %s",
    (path) => {
      signedOut();
      expect(
        proxy(request("demo.theforseti.ai", path)).headers.get("location"),
      ).toBeNull();
    },
  );

  it("does not treat a path that merely starts with a public one as public", () => {
    signedOut();
    // `/sign-included` is not `/sign-in`. The boundary is the slash.
    const response = proxy(request("demo.theforseti.ai", "/sign-included"));

    expect(response.headers.get("location")).toContain("/sign-in?next=");
  });

  it("lets a signed-in visitor through", () => {
    signedIn();
    const response = proxy(request("demo.theforseti.ai", "/overview"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does not serve the landing page at its root, though it ends with the marketing host", () => {
    signedIn();
    const response = proxy(request("demo.theforseti.ai", "/"));

    /*
     * The case that would replace the product with a brochure. The app lives
     * at a subdomain of the marketing domain, so
     * `"demo.theforseti.ai".endsWith("theforseti.ai")` is true — write the host
     * check as a suffix or a substring and every tenant, on every path, gets
     * the landing page. Equality is the only test that survives this shape.
     */
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("a preview deployment", () => {
  /*
   * The reason the host test is equality rather than a substring or a suffix.
   * A preview is the application, on a hostname regenerated every push.
   */
  it.each([
    "forseti-6iav0w9py-jonarmarzan3-3980s-projects.vercel.app",
    "forseti-git-main-jonarmarzan3-3980s-projects.vercel.app",
    "localhost",
  ])("behaves as the application on %s", (host) => {
    signedOut();
    const response = proxy(request(host, "/overview"));

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBe(
      `https://${host}/sign-in?next=%2Foverview`,
    );
  });
});

describe("the matcher", () => {
  const [pattern] = config.matcher;
  /*
   * Next compiles the matcher itself; anchoring the same source string is an
   * approximation of that, not a reimplementation of it. It is close enough to
   * answer the only question asked here — which paths the exclusion list lets
   * through — and it fails loudly if somebody edits the pattern without meaning
   * to change that answer.
   */
  const matches = (path: string) => new RegExp("^" + pattern + "$").test(path);

  it("still excludes every API route, so uploads are never buffered", () => {
    // The evidence upload routes stream multipart bodies; proxy seeing them
    // would copy every file into memory to decide nothing.
    expect(matches("/api/records/evidence/upload")).toBe(false);
    expect(matches("/api/auth/callback/google")).toBe(false);
  });

  it("now includes the auth pages, so the marketing host can forward them", () => {
    expect(matches("/sign-in")).toBe(true);
    expect(matches("/sign-up")).toBe(true);
    expect(matches("/onboarding")).toBe(true);
  });

  it("excludes Next internals and static assets", () => {
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/globe.svg")).toBe(false);
  });
});
