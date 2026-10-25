CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"asset_type" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"owner" text,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_control" (
	"organization_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"control_id" text NOT NULL,
	CONSTRAINT "asset_control_asset_id_control_id_pk" PRIMARY KEY("asset_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"severity" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"framework_id" text,
	"control_id" text,
	"owner" text,
	"due_at" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_framework" (
	"organization_id" text NOT NULL,
	"framework_id" text NOT NULL,
	"enabled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_framework_organization_id_framework_id_pk" PRIMARY KEY("organization_id","framework_id")
);
--> statement-breakpoint
CREATE TABLE "risk" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"inherent_likelihood" text NOT NULL,
	"inherent_impact" text NOT NULL,
	"treatment" text DEFAULT 'mitigate' NOT NULL,
	"owner" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_control" (
	"organization_id" text NOT NULL,
	"risk_id" text NOT NULL,
	"control_id" text NOT NULL,
	CONSTRAINT "risk_control_risk_id_control_id_pk" PRIMARY KEY("risk_id","control_id")
);
--> statement-breakpoint
DROP INDEX "assessment_org_generated_idx";--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "framework_id" text DEFAULT 'gdpr' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_control" ADD CONSTRAINT "asset_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_control" ADD CONSTRAINT "asset_control_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_framework" ADD CONSTRAINT "organization_framework_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk" ADD CONSTRAINT "risk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_control" ADD CONSTRAINT "risk_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_control" ADD CONSTRAINT "risk_control_risk_id_risk_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_org_idx" ON "asset" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_org_source_external_idx" ON "asset" USING btree ("organization_id","source","external_id") WHERE "asset"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "asset_control_org_control_idx" ON "asset_control" USING btree ("organization_id","control_id");--> statement-breakpoint
CREATE INDEX "finding_org_status_idx" ON "finding" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "finding_org_control_idx" ON "finding" USING btree ("organization_id","control_id");--> statement-breakpoint
CREATE INDEX "risk_org_idx" ON "risk" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "risk_control_org_control_idx" ON "risk_control" USING btree ("organization_id","control_id");--> statement-breakpoint
CREATE INDEX "assessment_org_framework_generated_idx" ON "assessment" USING btree ("organization_id","framework_id","generated_at");