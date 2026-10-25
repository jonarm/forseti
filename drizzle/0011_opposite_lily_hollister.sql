-- The GDPR toolkit's sixteen tables.
--
-- `IF EXISTS` on every drop, because this migration is not the only thing that
-- has removed them. The tables were already gone from the Neon database by the
-- time this was first run — dropped by hand when the toolkit was deleted, with
-- nothing recorded in `__drizzle_migrations` — so a bare `DROP TABLE` failed on
-- the first statement and took 0012 through 0015 down with it: every later
-- migration stayed unapplied while the schema silently diverged from the code.
--
-- A migration that describes an end state rather than a transition can be run
-- against a database that is already partly there. That is worth more than the
-- error, which only told us a table we wanted gone was gone.

DROP TABLE IF EXISTS "assessment" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "asset" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "asset_control" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "company_profile" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "control_answer" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "control_mapping" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "control_revision" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "evidence" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "finding" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "org_control" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "org_control_domain" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "organization_framework" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "policy" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "policy_control" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "risk" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "risk_control" CASCADE;