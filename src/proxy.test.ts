/** Routing must remain on the operator's host, including sign-in return URLs. */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cookie = vi.hoisted(() => vi.fn());
vi.mock("better-auth/cookies", () => ({ getSessionCookie: cookie }));
import { proxy } from "./proxy";

describe("independent-instance routing", () => {
  it.each(["app.example.com", "preview.vercel.app", "theforseti.ai", "localhost:3000"])(
    "keeps signed-out visitors on %s", (host) => {
      cookie.mockReturnValue(null);
      const result = proxy(new NextRequest(`https://${host}/inventory?sort=name`));
      const destination = new URL(result.headers.get("location")!);
      expect(destination.host).toBe(host);
      expect(destination.pathname).toBe("/sign-in");
      expect(destination.searchParams.get("next")).toBe("/inventory?sort=name");
      expect(result.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );
  it.each(["/sign-in", "/sign-up", "/onboarding", "/sign-in/callback"])(
    "does not redirect public page %s", (path) => {
      cookie.mockReturnValue(null);
      expect(proxy(new NextRequest(`https://app.example.com${path}`)).headers.get("location"))
        .toBeNull();
    },
  );
  it("does not treat a public-path prefix as public", () => {
    cookie.mockReturnValue(null);
    expect(proxy(new NextRequest("https://app.example.com/sign-in-private")).status).toBe(307);
  });
  it("lets a cookie-bearing request reach the server-side session guard", () => {
    cookie.mockReturnValue("test-cookie");
    expect(proxy(new NextRequest("https://app.example.com/inventory")).headers.get("location"))
      .toBeNull();
  });
});
