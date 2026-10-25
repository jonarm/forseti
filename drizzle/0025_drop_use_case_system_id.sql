ALTER TABLE "ai_use_case" DROP CONSTRAINT "ai_use_case_organization_id_system_id_ai_system_organization_id_id_fk";
--> statement-breakpoint
DROP INDEX "ai_use_case_org_system_idx";--> statement-breakpoint
ALTER TABLE "ai_use_case" DROP COLUMN "system_id";