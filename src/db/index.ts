import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * The database handle.
 *
 * Two drivers, chosen by connection string, because they speak different
 * protocols:
 *
 *   - Neon's driver talks **HTTP** to Neon's endpoint, not the Postgres wire
 *     protocol. It is the right production choice — one stateless request per
 *     query, so a serverless invocation pays no connection setup — but it
 *     cannot talk to an ordinary Postgres at all.
 *   - `node-postgres` speaks the wire protocol, which is what a local container
 *     or any self-hosted Postgres actually serves.
 *
 * Getting this wrong is silent until the first query, so the branch is on the
 * host rather than on a separate env flag someone can forget to set.
 *
 * The Neon path has no interactive transactions (a consequence of HTTP). If a
 * flow ever needs one, that is the signal to move production to the WebSocket
 * driver — not to work around it.
 */

if (!process.env.DATABASE_URL) {
  // Fail at import rather than on the first query. A missing URL is a
  // deployment mistake, and discovering it during a page render turns it into a
  // confusing 500 several layers from the actual cause.
  throw new Error(
    "DATABASE_URL is not set. Add a connection string to .env.local — `npm run db:up` starts a local Postgres, or use a Neon URL. See .env.example.",
  );
}

const url = process.env.DATABASE_URL;

/** Neon serves its HTTP endpoint on *.neon.tech; anything else is wire protocol. */
const isNeonHttp = new URL(url).hostname.endsWith(".neon.tech");

export type Database =
  | NeonHttpDatabase<typeof schema>
  | NodePgDatabase<typeof schema>;

export const db: Database = isNeonHttp
  ? drizzleNeonHttp(neon(url), { schema })
  : drizzleNodePg(new Pool({ connectionString: url }), { schema });

export { schema };
