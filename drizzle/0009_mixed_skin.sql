CREATE TABLE "policy" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"doc_type" text DEFAULT 'policy' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"version" text,
	"owner" text,
	"next_review_at" timestamp,
	"body" text,
	"approved_by" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_control" (
	"organization_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"control_id" text NOT NULL,
	CONSTRAINT "policy_control_policy_id_control_id_pk" PRIMARY KEY("policy_id","control_id")
);
--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_control" ADD CONSTRAINT "policy_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_control" ADD CONSTRAINT "policy_control_policy_id_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_org_idx" ON "policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "policy_org_status_idx" ON "policy" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "policy_control_org_control_idx" ON "policy_control" USING btree ("organization_id","control_id");