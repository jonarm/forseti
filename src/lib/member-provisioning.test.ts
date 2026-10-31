/** Keep admin-created password accounts compatible with Better Auth upgrades. */
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  linkAccount: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    ok: true,
    ctx: { userId: "admin", organizationId: "org-a" },
  }),
}));
vi.mock("@/lib/ai-store", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: { hash: async () => "test-hash" },
      internalAdapter: {
        findUserByEmail: async () => null,
        createUser: mocks.createUser,
        linkAccount: mocks.linkAccount,
      },
    }),
    api: { addMember: mocks.addMember },
  },
}));

import { POST } from "../app/api/members/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createUser.mockResolvedValue({ id: "new-user" });
});

it("declares password provisioning and links the account to the requesting tenant", async () => {
  const response = await POST(new Request("https://instance.example/api/members", {
    method: "POST",
    body: JSON.stringify({
      name: "New Person", email: "new@example.com",
      password: "test-only-long-password", role: "auditor",
    }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, userId: "new-user" });
  expect(mocks.createUser).toHaveBeenCalledWith({
    email: "new@example.com", name: "New Person", emailVerified: false,
  }, { method: "email-password" });
  expect(mocks.linkAccount).toHaveBeenCalledWith({
    userId: "new-user", accountId: "new-user", providerId: "credential", password: "test-hash",
  });
  expect(mocks.addMember).toHaveBeenCalledWith(expect.objectContaining({
    body: { userId: "new-user", role: "auditor", organizationId: "org-a" },
  }));
  expect(response.headers.get("set-cookie")).toBeNull();
});
