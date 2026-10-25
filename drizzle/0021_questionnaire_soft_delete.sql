ALTER TABLE "ai_questionnaire" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_questionnaire" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "ai_questionnaire_org_live_idx" ON "ai_questionnaire" USING btree ("organization_id","deleted_at");