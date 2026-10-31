/** Permission lookup failures must never restore permissions a tenant removed. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { where } = vi.hoisted(() => ({ where: vi.fn() }));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where }) }) },
}));

import { readRoleGrants } from "./ai-store";
import { can } from "./permissions";

beforeEach(() => {
  where.mockReset();
});

describe("readRoleGrants", () => {
  it("uses default permissions after a successful lookup with no overrides", async () => {
    where.mockResolvedValue([]);
    const grants = await readRoleGrants("org-a");
    expect(grants).toEqual({});
    expect(can("system_owner", { system: ["update"] }, grants)).toBe(true);
  });

  it("honours a tenant's removed permission", async () => {
    where.mockResolvedValue([
      { role: "system_owner", resource: "system", actions: [] },
    ]);
    const grants = await readRoleGrants("org-a");
    expect(can("system_owner", { system: ["update"] }, grants)).toBe(false);
  });

  it("propagates a lookup failure instead of returning default permissions", async () => {
    const failure = new Error("Permission store unavailable");
    where.mockRejectedValue(failure);
    await expect(readRoleGrants("org-a")).rejects.toBe(failure);
  });
});
