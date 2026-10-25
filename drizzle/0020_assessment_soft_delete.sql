ALTER TABLE "ai_assessment" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_assessment" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "ai_assessment_org_live_idx" ON "ai_assessment" USING btree ("organization_id","deleted_at");