import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth boundary's failure mapping.
 *
 * Two distinct states get confused constantly: "not signed in" and "signed in
 * but no organization selected". They need different responses — one sends you
 * to sign-in, the other to onboarding — and collapsing them produces a loop
 * where a signed-in user is repeatedly asked to sign in.
 *
 * `requireOrgForApi` additionally has to distinguish both from "the session
 * lookup itself broke", which must not be reported as an auth failure.
 */

const getSessionMock = vi.fn();
const listMembersMock = vi.fn();
const readActingPersonIdMock = vi.fn();
const readRoleGrantsMock = vi.fn();

vi.mock("./auth", () => ({
  auth: {
    api: {
      get getSession() {
        return getSessionMock;
      },
      get listMembers() {
        return listMembersMock;
      },
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

/*
 * The store, mocked for the same reason `./auth` is: this suite exercises the
 * boundary's decisions, and importing the real one would pull in a database
 * connection that a decision table has no business needing.
 */
vi.mock("./ai-store", () => ({
  readActingPersonId: (...args: unknown[]) => readActingPersonIdMock(...args),
  readRoleGrants: (...args: unknown[]) => readRoleGrantsMock(...args),
}));

const {
  describeAuthError,
  requireOrgContext,
  requireOrgForApi,
  requirePermission,
  UnauthenticatedError,
  NoActiveOrganizationError,
} = await import("./session");

beforeEach(() => {
  getSessionMock.mockReset();
  listMembersMock.mockReset();
  // Nobody matched, which is the ordinary state of a new seat.
  readActingPersonIdMock.mockReset();
  readActingPersonIdMock.mockResolvedValue(null);
  // A successful lookup for an organization that has never edited its roles.
  readRoleGrantsMock.mockReset();
  readRoleGrantsMock.mockResolvedValue({});
});

function signedIn(userId: string, activeOrganizationId: string | null) {
  return {
    user: { id: userId },
    session: { activeOrganizationId },
  };
}

describe("describeAuthError", () => {
  it("maps a missing session to 401", () => {
    expect(describeAuthError(new UnauthenticatedError())).toEqual({
      status: 401,
      message: "Sign in to continue.",
    });
  });

  it("maps a missing organization to 403, not 401", () => {
    // 401 here would bounce a signed-in user back to sign-in, where they would
    // sign in successfully and land in the same place again.
    const described = describeAuthError(new NoActiveOrganizationError());
    expect(described?.status).toBe(403);
    expect(described?.message).toMatch(/organization/i);
  });

  it("returns null for anything else", () => {
    // An unknown error must not be laundered into an auth failure — that would
    // tell a user to sign in when the database is down.
    expect(describeAuthError(new Error("connection refused"))).toBeNull();
    expect(describeAuthError("not an error")).toBeNull();
    expect(describeAuthError(undefined)).toBeNull();
  });
});

describe("requireOrgContext", () => {
  it("returns the caller's org and role", async () => {
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "user-1", role: "platform_admin" }],
    });

    await expect(requireOrgContext()).resolves.toEqual({
      userId: "user-1",
      organizationId: "org-a",
      personId: null,
      role: "platform_admin",
      grants: {},
    });
  });

  it("resolves which person the caller is, scoped to the active organization", async () => {
    // The account and the person are separate id spaces; this is the crossing,
    // and it is scoped like every other read — asking for org-a's mapping with
    // org-b's id is how one tenant's names leak into another's records.
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "user-1", role: "governance_lead" }],
    });
    readActingPersonIdMock.mockResolvedValue("p-anders");

    await expect(requireOrgContext()).resolves.toMatchObject({
      personId: "p-anders",
    });
    expect(readActingPersonIdMock).toHaveBeenCalledWith("org-a", "user-1");
  });

  it("does not resolve a person for somebody who is not a member", async () => {
    // Work done for a caller who gets nothing, and a lookup whose answer would
    // be discarded — the membership check comes first.
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "someone-else", role: "platform_admin" }],
    });

    await expect(requireOrgContext()).rejects.toBeInstanceOf(
      NoActiveOrganizationError,
    );
    expect(readActingPersonIdMock).not.toHaveBeenCalled();
    expect(readRoleGrantsMock).not.toHaveBeenCalled();
  });

  it("carries this organization's role edits onto the context", async () => {
    // Resolved once, here, so no screen and no route can evaluate against the
    // shipped matrix for a tenant that has changed it.
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "user-1", role: "reviewer" }],
    });
    readRoleGrantsMock.mockResolvedValue({ reviewer: { answer: ["update"] } });

    const ctx = await requireOrgContext();
    expect(ctx.grants).toEqual({ reviewer: { answer: ["update"] } });
    expect(readRoleGrantsMock).toHaveBeenCalledWith("org-a");
  });

  it("throws UnauthenticatedError with no session", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireOrgContext()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("throws NoActiveOrganizationError when no org is selected", async () => {
    getSessionMock.mockResolvedValue(signedIn("user-1", null));
    await expect(requireOrgContext()).rejects.toBeInstanceOf(
      NoActiveOrganizationError,
    );
  });

  it("refuses when the session names an org the user no longer belongs to", async () => {
    // The session is a cached claim. Membership is re-read every request so a
    // removal takes effect on the next call, not the next login.
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "someone-else", role: "platform_admin" }],
    });

    await expect(requireOrgContext()).rejects.toBeInstanceOf(
      NoActiveOrganizationError,
    );
  });

  it("reflects a role change without requiring a new session", async () => {
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "user-1", role: "member" }],
    });

    await expect(requireOrgContext()).resolves.toMatchObject({ role: "member" });
  });
});

describe("requireOrgForApi", () => {
  it("returns the context on success", async () => {
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({
      members: [{ userId: "user-1", role: "governance_lead" }],
    });

    const result = await requireOrgForApi();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.organizationId).toBe("org-a");
  });

  it("returns a 401 JSON response, never a redirect", async () => {
    // An API caller expects JSON. Redirecting it to an HTML sign-in page is the
    // wrong answer to the wrong audience.
    getSessionMock.mockResolvedValue(null);

    const result = await requireOrgForApi();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get("content-type")).toContain(
        "application/json",
      );
      await expect(result.response.json()).resolves.toEqual({
        error: "Sign in to continue.",
      });
    }
  });

  it("returns 403 when signed in without an organization", async () => {
    getSessionMock.mockResolvedValue(signedIn("user-1", null));

    const result = await requireOrgForApi();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns 503 — not 401 — when the session lookup itself fails", async () => {
    // Telling a user to sign in because the database is unreachable sends them
    // to fix something that isn't broken.
    getSessionMock.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requireOrgForApi();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const body = await result.response.json();
      expect(body.error).not.toMatch(/sign in/i);
    }
  });
});

/**
 * The permission gate.
 *
 * `requirePermission` is built on `requireOrgForApi`, which is the point: there
 * is no way to authorise an action without having resolved the tenant first, so
 * a route cannot check the role and forget the organization.
 */
describe("requirePermission", () => {
  function signedInAs(role: string) {
    getSessionMock.mockResolvedValue(signedIn("user-1", "org-a"));
    listMembersMock.mockResolvedValue({ members: [{ userId: "user-1", role }] });
  }

  it("passes the context through when the role allows it", async () => {
    signedInAs("governance_lead");

    const result = await requirePermission({ control: ["update"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.organizationId).toBe("org-a");
  });

  it("returns 403 when the role does not allow it", async () => {
    signedInAs("system_owner");

    const result = await requirePermission({ control: ["update"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("names the action so the message is actionable", async () => {
    // "Forbidden" tells someone they cannot proceed. It does not tell them the
    // next move is to ask an admin.
    signedInAs("auditor");

    const result = await requirePermission({ control: ["delete"] }, "delete a control");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error).toMatch(/delete a control/);
      expect(body.error).toMatch(/admin/i);
    }
  });

  it("still lets a system owner do system-owner work", async () => {
    signedInAs("system_owner");

    await expect(
      requirePermission({ answer: ["update"] }).then((r) => r.ok),
    ).resolves.toBe(true);
    await expect(
      requirePermission({ evidence: ["create"] }).then((r) => r.ok),
    ).resolves.toBe(true);
  });

  it("treats a legacy `member` row as a contributor", async () => {
    // Everyone predating the permission model carries this role.
    signedInAs("member");

    await expect(
      requirePermission({ answer: ["update"] }).then((r) => r.ok),
    ).resolves.toBe(true);
    await expect(
      requirePermission({ control: ["update"] }).then((r) => r.ok),
    ).resolves.toBe(false);
  });

  it("checks authentication before the permission", async () => {
    // A signed-out caller must get 401, not 403 — telling someone they lack
    // permission when they simply are not signed in sends them to the wrong fix.
    getSessionMock.mockResolvedValue(null);

    const result = await requirePermission({ control: ["update"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("returns 503 without a context when permission overrides cannot be loaded", async () => {
    signedInAs("system_owner");
    readRoleGrantsMock.mockRejectedValue(new Error("Permission store unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Default system_owner grants allow this action; a failed lookup must not.
      const result = await requirePermission({ system: ["update"] });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("ctx");
      if (!result.ok) {
        expect(result.response.status).toBe(503);
        const body = await result.response.json();
        expect(body.error).not.toContain("Permission store unavailable");
      }
    } finally {
      log.mockRestore();
    }
  });

  it("refuses an unrecognised role rather than letting it through", async () => {
    signedInAs("superuser");

    const result = await requirePermission({ answer: ["update"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});
