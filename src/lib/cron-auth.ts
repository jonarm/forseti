import { NextResponse } from "next/server";

/**
 * The guard for a scheduled job: no session, no organisation, a shared secret.
 *
 * **This is the one route class in Forseti that is not a tenant.** The nightly
 * purge has to run when nobody is signed in, across every organisation with
 * something overdue, so `requireOrgForApi()` cannot be what protects it — there
 * is no browser and no cookie to resolve. That makes it the only handler that
 * can be reached without a person behind it, which is exactly why it gets its
 * own named guard rather than an `if` inside the route: `route-guards.test.ts`
 * asserts that every handler under `/api` calls one of these three functions,
 * so a second unauthenticated endpoint cannot be added quietly.
 *
 * **Unset means refused, never open.** A deployment that forgot `CRON_SECRET`
 * gets a 503 and a log line rather than a world-readable delete endpoint. The
 * failure mode of a misconfigured secret has to be "the purge does not run",
 * which somebody notices from a growing trash, and never "anybody can run it".
 *
 * The comparison is length-checked before it is compared so a wrong-length
 * guess fails on the cheap path, and the tokens are compared in full rather
 * than short-circuiting on the first differing byte. Vercel Cron sends the
 * secret as `Authorization: Bearer <CRON_SECRET>`.
 */
export function requireCronRequest(
  request: Request,
): { ok: true } | { ok: false; response: NextResponse } {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run a scheduled job unauthenticated.",
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Scheduled jobs are not configured on this deployment." },
        { status: 503 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!timingSafeEquals(offered, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authorised." }, { status: 401 }),
    };
  }

  return { ok: true };
}

/**
 * Compare two secrets without leaking where they first differ.
 *
 * `crypto.timingSafeEqual` needs equal-length buffers and throws otherwise, so
 * the length check comes first and is itself a disclosure — of the length only,
 * which a caller who can send requests can measure anyway.
 */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let differences = 0;
  for (let i = 0; i < a.length; i++) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
}
