CREATE TABLE "ai_use_case_system" (
	"organization_id" text NOT NULL,
	"use_case_id" text NOT NULL,
	"system_id" text NOT NULL,
	CONSTRAINT "ai_use_case_system_organization_id_use_case_id_system_id_pk" PRIMARY KEY("organization_id","use_case_id","system_id")
);
--> statement-breakpoint
ALTER TABLE "ai_use_case_system" ADD CONSTRAINT "ai_use_case_system_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_system" ADD CONSTRAINT "ai_use_case_system_organization_id_use_case_id_ai_use_case_organization_id_id_fk" FOREIGN KEY ("organization_id","use_case_id") REFERENCES "public"."ai_use_case"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case_system" ADD CONSTRAINT "ai_use_case_system_organization_id_system_id_ai_system_organization_id_id_fk" FOREIGN KEY ("organization_id","system_id") REFERENCES "public"."ai_system"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_use_case_system_org_system_idx" ON "ai_use_case_system" USING btree ("organization_id","system_id");
--> statement-breakpoint
--
-- Backfill, hand-appended to the generated DDL the way 0013 appends its trigger.
--
-- Every use case today names exactly one system in `ai_use_case.system_id`, so
-- each becomes exactly one link and nothing changes meaning: a use case that
-- reached one system before reaches the same one after. The column is dropped
-- in 0025 rather than here, so a backfill that turned out wrong could still be
-- re-run from the source it read.
--
-- No WHERE clause is needed. The column is NOT NULL and its composite foreign
-- key guarantees the system exists in the same organisation, which is exactly
-- the pair the new table's own foreign keys require.
--
INSERT INTO "ai_use_case_system" ("organization_id", "use_case_id", "system_id")
SELECT "organization_id", "id", "system_id" FROM "ai_use_case"
ON CONFLICT DO NOTHING;