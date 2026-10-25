ALTER TABLE "ai_use_case" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_use_case_org_live_idx" ON "ai_use_case" USING btree ("organization_id","deleted_at");