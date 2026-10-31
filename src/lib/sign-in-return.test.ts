/** Exercise the sign-in page's handling of the user-controlled next parameter. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/oauth-providers", () => ({ configuredOAuthProviders: () => [] }));
vi.mock("@/components/auth-form", () => ({ AuthForm: () => null }));

import SignInPage from "../app/(auth)/sign-in/page";

describe("sign-in return destination", () => {
  it.each([
    { next: "/inventory?sort=name", expected: "/inventory?sort=name" },
    { next: "/inventory/../overview", expected: "/overview" },
    { next: "/\\external.example", expected: undefined },
    { next: "//external.example", expected: undefined },
    { next: "/\n/external.example", expected: undefined },
    { next: "/.//external.example", expected: undefined },
    { next: ["/overview", "/inventory"], expected: undefined },
    { next: undefined, expected: undefined },
  ])("passes only a safe destination to the auth form: $next", async ({ next, expected }) => {
    const page = await SignInPage({ searchParams: Promise.resolve({ next }) });
    expect(page.props.next).toBe(expected);
  });
});
