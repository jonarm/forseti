ALTER TABLE "ai_finding" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_finding" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "ai_finding_org_live_idx" ON "ai_finding" USING btree ("organization_id","deleted_at");