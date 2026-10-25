-- One control satisfies several clauses of the same standard, and a real
-- mapping table says so in a single cell — "PRO-04, ISM-1406, ISM-1914".
--
-- Written by hand rather than generated, so the existing single refs survive:
-- add, backfill, then drop. A generated drop-and-create would have silently
-- discarded every crosswalk row an organization had already imported.
ALTER TABLE "control_mapping" ADD COLUMN "refs" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "control_mapping" SET "refs" = ARRAY["ref"] WHERE "ref" IS NOT NULL AND "ref" <> '';--> statement-breakpoint
ALTER TABLE "control_mapping" DROP COLUMN "ref";
