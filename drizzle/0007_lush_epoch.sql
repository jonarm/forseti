CREATE TABLE "control_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"control_id" text NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"before" text,
	"after" text,
	"actor_id" text,
	"actor_name" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_control" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "control_revision" ADD CONSTRAINT "control_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_revision_org_control_idx" ON "control_revision" USING btree ("organization_id","control_id","at");