ALTER TABLE "ai_intake_request" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_intake_request" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "ai_intake_org_live_idx" ON "ai_intake_request" USING btree ("organization_id","deleted_at");