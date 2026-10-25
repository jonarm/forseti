import { Redis } from "@upstash/redis";

/**
 * Spend caps on the routes that cost money.
 *
 * Authentication answers "who may call this"; it does not answer "how often".
 * A single signed-in account can still run the assessment in a loop, and each
 * run is an Opus request at `effort: "high"`. This is the control that actually
 * bounds the bill.
 *
 * Limits are per organization rather than per user — the tenant is what gets
 * billed, and per-user limits are trivially bypassed by inviting colleagues.
 *
 * Fails open. If Redis is unreachable the request proceeds: a rate limiter that
 * takes the product down when its own backing store hiccups has traded a
 * bounded cost problem for an unbounded availability one. The failure is
 * logged so it doesn't pass silently.
 */

interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const LIMITS = {
  /** Full seven-area assessment: the most expensive call in the product. */
  assessment: { max: 10, windowSeconds: 60 * 60 },
  /**
   * Auto-mapping the whole control library.
   *
   * Its own bucket rather than sharing the assessment's, because the two are
   * different sizes and different jobs: one run here is a *batched* Opus call
   * per twenty-five controls, so a seventy-control library is three requests
   * from one click and scales with the library rather than being fixed. Sharing
   * a counter would let a few mapping runs lock someone out of the assessment
   * they were actually working towards.
   *
   * Lower than the assessment for that reason. Mapping is a thing you do after
   * an import and then rarely again, not something a working session repeats.
   */
  controlMapping: { max: 6, windowSeconds: 60 * 60 },
  /** Short single answers — cheaper, so a working session isn't interrupted. */
  questionnaire: { max: 60, windowSeconds: 60 * 60 },
  /** No model call, but PDF rendering is CPU-bound and worth bounding. */
  trustPackage: { max: 30, windowSeconds: 60 * 60 },
  /**
   * Parsing an uploaded spreadsheet — the same reasoning as `trustPackage`.
   *
   * No model call and no spend, but an `.xlsx` is a ZIP that exceljs has to
   * decompress, and `zip-guard` only catches the archives that declare their
   * size honestly. Generous, because a person mapping columns re-uploads a
   * corrected file two or three times and being rate-limited mid-fix is the
   * wrong lesson; low enough that a loop cannot pin a serverless function.
   */
  inventoryImport: { max: 40, windowSeconds: 60 * 60 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

let client: Redis | null = null;

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  client ??= Redis.fromEnv();
  return client;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
  remaining: number;
}

/** True when Redis is configured and the limits are actually being enforced. */
export function rateLimitingActive(): boolean {
  return redis() !== null;
}

let warnedUnconfigured = false;

/**
 * Say so, once, when the limiter is inert.
 *
 * Without this an unconfigured deployment is indistinguishable from a working
 * one until the bill arrives: the guarded routes return exactly the same
 * responses either way. Verifying it the other way round means exhausting a real
 * limit, and every one of those requests is a paid Opus call.
 *
 * Local dev without Redis is normal and expected, so this stays quiet there.
 */
function warnUnconfiguredOnce(): void {
  if (warnedUnconfigured || process.env.NODE_ENV !== "production") return;
  warnedUnconfigured = true;
  console.warn(
    "[rate-limit] No Upstash Redis configured — spend limits are NOT being enforced. " +
      "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN).",
  );
}

/**
 * Fixed-window counter: INCR a key, set its TTL on first use.
 *
 * A sliding window would be smoother, but this is two commands and no stored
 * history, and the failure mode it allows — a burst straddling a window
 * boundary — costs at most one extra window's worth of calls. That is an
 * acceptable trade for a spend cap.
 */
export async function checkRateLimit(
  name: LimitName,
  organizationId: string,
): Promise<RateLimitResult> {
  const { max, windowSeconds } = LIMITS[name];
  const store = redis();

  if (!store) {
    // No Redis configured (local dev, typically). Don't pretend to limit.
    warnUnconfiguredOnce();
    return { allowed: true, retryAfterSeconds: 0, remaining: max };
  }

  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `ratelimit:${name}:${organizationId}:${window}`;

  try {
    const count = await store.incr(key);

    if (count === 1) {
      // First hit in this window — start the clock. Without this the key
      // would live forever and the org would be permanently limited.
      await store.expire(key, windowSeconds);
    }

    if (count > max) {
      const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
      return {
        allowed: false,
        retryAfterSeconds: windowSeconds - elapsed,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, max - count),
    };
  } catch (err) {
    console.error("[rate-limit] check failed, allowing request", err);
    return { allowed: true, retryAfterSeconds: 0, remaining: max };
  }
}

/** Build the 429 response, including the header clients actually honour. */
export function rateLimitResponse(result: RateLimitResult, what: string) {
  const minutes = Math.ceil(result.retryAfterSeconds / 60);
  return Response.json(
    {
      error: `You've reached the limit for ${what}. Try again in ${
        minutes <= 1 ? "a minute" : `${minutes} minutes`
      }.`,
    },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    },
  );
}
