import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The spend cap.
 *
 * Authentication answers "who may call this"; it does not answer "how often".
 * One signed-in account can still loop the assessment, and each run is an Opus
 * request at `effort: "high"`. These tests cover the behaviours that actually
 * bound the bill — and the fail-open decision, which is deliberate and would
 * otherwise look like a bug worth "fixing" into fail-closed.
 */

const store = new Map<string, number>();
const redisMock = {
  incr: vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  }),
  expire: vi.fn(async () => 1),
};

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redisMock },
}));

const { checkRateLimit, rateLimitResponse, rateLimitingActive, LIMITS } =
  await import("./rate-limit");

beforeEach(() => {
  store.clear();
  redisMock.incr.mockClear();
  redisMock.expire.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit and refuses the next one", async () => {
    const { max } = LIMITS.assessment;

    for (let i = 0; i < max; i++) {
      const result = await checkRateLimit("assessment", "org-a");
      expect(result.allowed).toBe(true);
    }

    const overflow = await checkRateLimit("assessment", "org-a");
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
    expect(overflow.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts down remaining accurately", async () => {
    const { max } = LIMITS.assessment;
    const first = await checkRateLimit("assessment", "org-a");
    expect(first.remaining).toBe(max - 1);
  });

  it("sets a TTL exactly once per window", async () => {
    await checkRateLimit("assessment", "org-a");
    await checkRateLimit("assessment", "org-a");
    // Without this the key would outlive its window and the org would be
    // limited permanently.
    expect(redisMock.expire).toHaveBeenCalledTimes(1);
    expect(redisMock.expire).toHaveBeenCalledWith(
      expect.any(String),
      LIMITS.assessment.windowSeconds,
    );
  });

  it("isolates organizations from each other", async () => {
    const { max } = LIMITS.assessment;
    for (let i = 0; i < max; i++) await checkRateLimit("assessment", "org-a");

    expect((await checkRateLimit("assessment", "org-a")).allowed).toBe(false);
    // Exhausting one tenant must never throttle another.
    expect((await checkRateLimit("assessment", "org-b")).allowed).toBe(true);
  });

  it("isolates limit buckets from each other", async () => {
    const { max } = LIMITS.assessment;
    for (let i = 0; i < max; i++) await checkRateLimit("assessment", "org-a");

    expect((await checkRateLimit("assessment", "org-a")).allowed).toBe(false);
    expect((await checkRateLimit("questionnaire", "org-a")).allowed).toBe(true);
  });

  it("resets when the window rolls over", async () => {
    const { max, windowSeconds } = LIMITS.assessment;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    for (let i = 0; i < max; i++) await checkRateLimit("assessment", "org-a");
    expect((await checkRateLimit("assessment", "org-a")).allowed).toBe(false);

    vi.setSystemTime(new Date(Date.now() + windowSeconds * 1000));
    expect((await checkRateLimit("assessment", "org-a")).allowed).toBe(true);
  });

  it("FAILS OPEN when Redis throws", async () => {
    // Deliberate: a limiter that takes the product down when its own backing
    // store hiccups has traded a bounded cost problem for an unbounded
    // availability one. Do not "fix" this into fail-closed.
    redisMock.incr.mockRejectedValueOnce(new Error("connection refused"));

    const result = await checkRateLimit("assessment", "org-a");
    expect(result.allowed).toBe(true);
  });

  it("is a no-op when Redis is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    const result = await checkRateLimit("assessment", "org-a");
    expect(result.allowed).toBe(true);
    // Local dev without Redis should not pretend to be limiting.
    expect(redisMock.incr).not.toHaveBeenCalled();
  });
});

describe("rateLimitingActive", () => {
  it("reports true when Redis is configured", () => {
    expect(rateLimitingActive()).toBe(true);
  });

  it("reports false when it is not", () => {
    // The distinction a deployment cannot otherwise observe: an unconfigured
    // limiter returns exactly the same responses as a working one.
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(rateLimitingActive()).toBe(false);
  });
});

describe("rateLimitResponse", () => {
  it("returns 429 with a Retry-After header clients honour", async () => {
    const response = rateLimitResponse(
      { allowed: false, retryAfterSeconds: 600, remaining: 0 },
      "running assessments",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");

    const body = await response.json();
    expect(body.error).toContain("running assessments");
    expect(body.error).toContain("10 minutes");
  });

  it("says 'a minute' rather than '1 minutes'", async () => {
    const response = rateLimitResponse(
      { allowed: false, retryAfterSeconds: 30, remaining: 0 },
      "drafting answers",
    );
    const body = await response.json();
    expect(body.error).toContain("a minute");
    expect(body.error).not.toContain("1 minutes");
  });
});
