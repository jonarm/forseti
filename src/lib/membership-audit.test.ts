import { describe, expect, it, vi } from "vitest";

/*
 * The module graph, not the behaviour, is what needs stubbing here.
 * `membership-audit` imports the store for `writeAudit`, and the store imports
 * `@/db`, which throws at import without a connection string. Nothing under test
 * touches either — these are the pure functions that decide what an event says.
 */
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { describeRole, describeUser, roleChangeEntry, membershipAuditHooks } =
  await import("./membership-audit");

/**
 * What a membership event says.
 *
 * The gap this closes was total: promoting somebody to platform admin produced
 * no record at all, because the browser calls Better Auth's endpoints directly
 * and never passes through `ai-store.ts`. So the thing worth pinning is not that
 * a row is written — that is the plugin hook's job — but that the row a reader
 * eventually finds actually answers "who could do what, from when".
 */

describe("describeUser", () => {
  it("prefers the email, which is what an auditor can act on", () => {
    expect(describeUser({ id: "u1", email: "dana@example.com", name: "Dana" })).toBe(
      "dana@example.com",
    );
  });

  it("falls back to the name, then to the id, rather than rendering nothing", () => {
    expect(describeUser({ id: "u1", email: null, name: "Dana" })).toBe("Dana");
    expect(describeUser({ id: "u1", email: null, name: null })).toBe("u1");
  });
});

describe("describeRole", () => {
  it("names the role a person would recognise", () => {
    expect(describeRole("platform_admin")).toBe("Platform Admin");
    expect(describeRole("auditor")).toBe("Auditor");
  });

  it("resolves a legacy role to what it actually confers", () => {
    // A trail printing `owner` — a role the product no longer has — invites the
    // reader to guess what it meant. It meant this.
    expect(describeRole("owner")).toBe("Platform Admin");
    expect(describeRole("contributor")).toBe("AI System Owner");
    expect(describeRole("member")).toBe("AI System Owner");
  });

  it("reads an unrecognised role as the read-only one it resolves to", () => {
    // Matches `normaliseRole`: an unknown string confers nothing, and the trail
    // must not imply it conferred something.
    expect(describeRole("superuser")).toBe("Auditor");
  });

  it("is null for no role, rather than the string 'null'", () => {
    expect(describeRole(null)).toBeNull();
    expect(describeRole(undefined)).toBeNull();
    expect(describeRole("")).toBeNull();
  });
});

describe("roleChangeEntry", () => {
  const user = { id: "u-dana", email: "dana@example.com", name: "Dana" };

  it("names both ends of the change", () => {
    const entry = roleChangeEntry(
      { userId: "u-dana", role: "platform_admin" },
      "auditor",
      user,
    );

    expect(entry.before).toBe("Auditor");
    expect(entry.after).toBe("Platform Admin");
    expect(entry.action).toBe("changed dana@example.com's role");
  });

  it("keys on the user, not the membership row", () => {
    // A member row is destroyed and recreated when somebody leaves and rejoins.
    // Keying on it would scatter one person's access history across rows that
    // cannot be joined back together.
    const entry = roleChangeEntry({ userId: "u-dana", role: "auditor" }, "auditor", user);
    expect(entry.subjectId).toBe("u-dana");
    expect(entry.subjectKind).toBe("member");
  });

  it("survives a promotion out of a legacy role", () => {
    // The case a database migrated from the old four-role model produces.
    const entry = roleChangeEntry(
      { userId: "u-dana", role: "governance_lead" },
      "member",
      user,
    );
    expect(entry.before).toBe("AI System Owner");
    expect(entry.after).toBe("AI Governance Lead");
  });
});

describe("the hooks Better Auth is given", () => {
  it("covers every way access is granted or taken away", () => {
    // Missing one is not a partial trail, it is a blind spot — and the obvious
    // one to forget is the invitation, where the granting decision is made by
    // somebody other than the person who eventually accepts.
    expect(Object.keys(membershipAuditHooks).sort()).toEqual([
      "afterAddMember",
      "afterCancelInvitation",
      "afterCreateInvitation",
      "afterRemoveMember",
      "afterUpdateMemberRole",
    ]);
  });
});
