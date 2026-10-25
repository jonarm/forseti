ALTER TABLE "ai_evidence" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_evidence" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "ai_evidence_org_live_idx" ON "ai_evidence" USING btree ("organization_id","deleted_at");