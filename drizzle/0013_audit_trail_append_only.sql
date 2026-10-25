ALTER TABLE "ai_activity_event" ADD COLUMN "subject_kind" text DEFAULT 'record' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_activity_event" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "ai_activity_org_at_idx" ON "ai_activity_event" USING btree ("organization_id","at");--> statement-breakpoint
CREATE INDEX "ai_activity_org_kind_at_idx" ON "ai_activity_event" USING btree ("organization_id","subject_kind","at");--> statement-breakpoint

-- Rows written before `subject_kind` existed keep the column default, `record`.
-- They could be reclassified by pattern-matching the id prefixes the fixtures
-- happen to use, and that is exactly what an audit trail must not contain: a
-- guess indistinguishable from a fact. An honest "unclassified" is worth more
-- than a plausible reconstruction.

-- Make the trail append-only, in the database.
--
-- The application must not be able to revise its own audit log. That is not a
-- statement about trusting this codebase — it is what makes the trail evidence
-- rather than a report. A rule enforced in `ai-store.ts` holds until somebody
-- writes a second caller, and `ai-seed.ts` was already deleting from this table
-- to reseed the demo. Enforced here, the guarantee survives the seed, a future
-- route, a migration script and a psql session.
--
-- **The one permitted delete is a tenant leaving.** `organization_id` is
-- ON DELETE CASCADE, so removing an organization must be able to take its
-- history with it; refusing that would make an organization undeletable, which
-- is both a support problem and an erasure-request problem. The trigger detects
-- the case by asking whether the owning organization still exists: PostgreSQL
-- runs a cascade as a separate action *after* the parent row is gone, so during
-- a legitimate cascade the lookup finds nothing, while a stray
-- `DELETE FROM ai_activity_event` still has its organization present and is
-- refused. No flag, no session variable, nothing an ordinary caller can set.
--
-- TRUNCATE is deliberately not covered. It is a table-level operation that no
-- application path reaches, and the test harness truncates between cases; a
-- statement trigger here would buy no protection against anyone who already has
-- DDL rights and would cost the suite its isolation.
CREATE OR REPLACE FUNCTION "ai_activity_event_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "organization" WHERE "id" = OLD."organization_id";
    IF NOT FOUND THEN
      -- The tenant is already gone; this is the FK cascade, not a rewrite.
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION
    'ai_activity_event is append-only; % is not permitted', TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "ai_activity_event_no_update" ON "ai_activity_event";--> statement-breakpoint
CREATE TRIGGER "ai_activity_event_no_update"
  BEFORE UPDATE ON "ai_activity_event"
  FOR EACH ROW EXECUTE FUNCTION "ai_activity_event_append_only"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "ai_activity_event_no_delete" ON "ai_activity_event";--> statement-breakpoint
CREATE TRIGGER "ai_activity_event_no_delete"
  BEFORE DELETE ON "ai_activity_event"
  FOR EACH ROW EXECUTE FUNCTION "ai_activity_event_append_only"();
