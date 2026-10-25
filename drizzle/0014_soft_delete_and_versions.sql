ALTER TABLE "ai_risk" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_risk" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "ai_risk" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_system" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_system" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "ai_system" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_risk_org_live_idx" ON "ai_risk" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "ai_system_org_live_idx" ON "ai_system" USING btree ("organization_id","deleted_at");