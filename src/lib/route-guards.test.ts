import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every route that writes must check a permission.
 *
 * The matrix in `permissions.test.ts` proves the roles are right. This proves
 * they are *reached* — which is the half that rots, because the failure is
 * invisible: a new route that calls `requireOrgForApi()` and stops there works
 * perfectly, passes review, and quietly lets a viewer rewrite the control
 * library. Nothing else in the suite would notice.
 *
 * So the rule is structural rather than per-route: **a handler exporting POST,
 * PUT, PATCH or DELETE calls `requirePermission`.** GET may stop at
 * `requireOrgForApi`, because read is granted by membership — a role that can
 * open the app can see what is in it.
 */

const API_DIR = new URL("../app/api/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

/** Route handlers that write. */
const MUTATING = ["POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Better Auth's own catch-all, which is the plugin's endpoints rather than
 * ours. It polices itself from the same `ac` and roles — see `auth.ts` — so
 * wrapping it here would be a second, weaker check on top of the real one.
 */
const NOT_OURS = ["auth"];

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (NOT_OURS.includes(entry.name)) continue;
      routeFiles(path, found);
    } else if (entry.name === "route.ts") {
      found.push(path);
    }
  }
  return found;
}

/** The body of one exported handler, from its signature to the next export. */
function handlerBody(source: string, verb: string): string | null {
  const start = source.search(new RegExp(`export async function ${verb}\\s*\\(`));
  if (start === -1) return null;

  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (async function|const|function) /);
  return next === -1 ? rest : rest.slice(0, next);
}

const files = routeFiles(API_DIR);

describe("route guards", () => {
  it("resolves the API directory at all", () => {
    // A path that silently resolves to nothing would make every assertion below
    // vacuously pass — the worst possible outcome for a test like this. It can
    // no longer be pinned to a route count: removing the GDPR toolkit took
    // every route we own with it, and the AI management system has not grown
    // its own yet. So this checks the directory resolves and Better Auth's
    // catch-all is where the walk expects it, which is what would break if the
    // URL-to-path conversion above ever stopped working on this platform.
    expect(readdirSync(API_DIR).map((e) => e.toString())).toContain("auth");
  });

  it("checks a permission on every handler that writes", () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const name = relative(API_DIR, file).replace(/\\/g, "/");

      for (const verb of MUTATING) {
        const body = handlerBody(source, verb);
        if (body === null) continue;

        if (!body.includes("requirePermission(")) {
          unguarded.push(
            `${name} ${verb} — writes, but only calls ${
              body.includes("requireOrgForApi(") ? "requireOrgForApi" : "no guard at all"
            }`,
          );
        }
      }
    }

    expect(unguarded).toEqual([]);
  });

  it("guards before doing anything else", () => {
    // The guard has to be the first statement. A route that parses the body,
    // reads the store or calls a model *before* checking has already done the
    // work — and for the AI routes, already spent the money.
    const late: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const name = relative(API_DIR, file).replace(/\\/g, "/");

      for (const verb of MUTATING) {
        const body = handlerBody(source, verb);
        if (!body?.includes("requirePermission(")) continue;

        const guardAt = body.indexOf("requirePermission(");
        const before = body.slice(0, guardAt);

        for (const forbidden of ["await request.json", "await request.formData", "await read"]) {
          if (before.includes(forbidden)) {
            late.push(`${name} ${verb} — ${forbidden} runs before the permission check`);
          }
        }
      }
    }

    expect(late).toEqual([]);
  });

  it("still resolves the tenant on read-only handlers", () => {
    // A GET does not need a permission, but it absolutely needs an organization
    // — that is the tenant boundary, and it is not optional for reads.
    //
    // `requireCronRequest` is the one alternative, and it is not a loophole: it
    // is the guard for a handler that has no tenant *because nobody is signed
    // in*, and the assertion below pins which paths are allowed to use it. A
    // route that reached for it to skip a session check would have to be added
    // to that list first, in a diff somebody reviews.
    const missing: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const name = relative(API_DIR, file).replace(/\\/g, "/");

      const body = handlerBody(source, "GET");
      if (body === null) continue;

      const guarded =
        body.includes("requireOrgForApi(") ||
        body.includes("requirePermission(") ||
        body.includes("requireCronRequest(");

      if (!guarded) missing.push(`${name} GET — no tenant check`);
    }

    expect(missing).toEqual([]);
  });

  it("lets only the scheduled jobs run without a session, and makes them prove it", () => {
    /*
     * The other half of the exemption above.
     *
     * `requireCronRequest` verifies a shared secret instead of a session, which
     * makes it the only way to reach a handler here without signing in. Two
     * things have to stay true: nothing outside `cron/` uses it, and everything
     * inside `cron/` does. The first stops it becoming a way around the tenant
     * boundary; the second stops a scheduled job being added with no guard at
     * all, which is the mistake that would put an unauthenticated delete
     * endpoint on the internet.
     */
    const wrong: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const name = relative(API_DIR, file).replace(/\\/g, "/");
      const isCron = name.startsWith("cron/");
      const usesCronGuard = source.includes("requireCronRequest(");

      if (usesCronGuard && !isCron) {
        wrong.push(`${name} — uses the cron guard but is not a scheduled job`);
      }
      if (isCron && !usesCronGuard) {
        wrong.push(`${name} — is a scheduled job but does not check the cron secret`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it("names the action in every permission check", () => {
    // `requirePermission({ control: ["update"] })` with no second argument gives
    // "You do not have permission to do that", which tells the user nothing they
    // can act on.
    const vague: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const name = relative(API_DIR, file).replace(/\\/g, "/");

      for (const match of source.matchAll(/requirePermission\(([^;]*?)\);/g)) {
        if (!match[1].includes(",")) {
          vague.push(`${name} — requirePermission(${match[1].trim()}) has no action phrase`);
        }
      }
    }

    expect(vague).toEqual([]);
  });
});
