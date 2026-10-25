import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so it does not get .env.local loading for free.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Surfaces the SQL before it runs; this is a single-database project and a
  // silent destructive migration is not a trade worth making.
  verbose: true,
  strict: true,
});
