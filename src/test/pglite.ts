import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

/**
 * A real Postgres, in-process.
 *
 * PGlite is Postgres compiled to WASM, so these tests exercise actual SQL —
 * foreign keys, `onConflictDoUpdate`, array columns, JSONB — rather than a stub
 * that would happily agree with a broken query. It needs no container and no
 * network, so `npm test` works offline and in CI.
 *
 * The schema comes from the same `drizzle/` migrations the real database gets,
 * applied here rather than hand-built. A fixture that redefines the tables would
 * drift from production the first time someone adds a column, and the tests
 * would keep passing while the app broke.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: "./drizzle" });

  return {
    db,
    /** Free the WASM instance — without this each suite leaks one. */
    close: () => client.close(),
  };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
