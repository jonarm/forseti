/**
 * Apply pending migrations as part of a production deploy.
 *
 * Vercel runs a build command and nothing else — it never touches the database
 * schema. So a deploy that adds a column ships code expecting that column
 * against a database without it, and the first request to the new route 500s.
 * Every migration in this project has, until now, been a thing somebody had to
 * remember to run from a laptop that happened to hold the Neon URL.
 *
 * **Production only.** `VERCEL_ENV` is `production` for the main deployment,
 * `preview` for a branch. Previews share this project's single database, so
 * migrating from one would apply an unmerged branch's schema change to
 * production — a change nobody has reviewed yet, arriving from a deploy nobody
 * thinks of as a release. A preview deploy skips and says so; if a branch needs
 * its schema, merge it or run the migration by hand.
 *
 * **A failed migration fails the build, deliberately.** The alternative is
 * deploying code whose schema did not land, which is the exact failure this
 * script exists to prevent — better a red deployment than a green one that
 * 500s on the first click.
 *
 * Locally this does nothing at all: `npm run build` stays a pure typecheck and
 * build gate, and `npm run db:migrate` is still how you migrate by hand.
 */
import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV;

if (!env) {
  console.log("[migrate] Not a Vercel build — skipping. Use `npm run db:migrate`.");
  process.exit(0);
}

if (env !== "production") {
  console.log(`[migrate] VERCEL_ENV is "${env}" — skipping.`);
  console.log("[migrate] Previews share the production database; only the");
  console.log("[migrate] production deploy is allowed to change its schema.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set on this deployment.");
  process.exit(1);
}

console.log("[migrate] Applying pending migrations to production…");

const result = spawnSync("npx", ["drizzle-kit", "migrate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error("[migrate] Migration failed. Failing the build rather than");
  console.error("[migrate] deploying code whose schema did not land.");
  process.exit(result.status ?? 1);
}

console.log("[migrate] Done.");
