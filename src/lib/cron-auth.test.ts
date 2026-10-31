/** Test only the scheduled-job guard; never call the destructive purge handler. */
import { afterEach, expect, it, vi } from "vitest";
import { requireCronRequest } from "./cron-auth";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("refuses an unconfigured job", () => {
  vi.stubEnv("CRON_SECRET", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const result = requireCronRequest(new Request("https://example.com/api/cron/purge-trash"));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(503);
});

it.each(["", "Bearer wrong", "Bearer é", "Basic test-token"])(
  "refuses a missing or incorrect bearer token", (authorization) => {
    vi.stubEnv("CRON_SECRET", "test-token");
    const result = requireCronRequest(new Request("https://example.com", { headers: { authorization } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  },
);

it("accepts the matching bearer token", () => {
  vi.stubEnv("CRON_SECRET", "test-token");
  expect(requireCronRequest(new Request("https://example.com", {
    headers: { authorization: "Bearer test-token" },
  }))).toEqual({ ok: true });
});
