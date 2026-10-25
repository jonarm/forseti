CREATE TABLE "ai_role_grant" (
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"resource" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_role_grant_organization_id_role_resource_pk" PRIMARY KEY("organization_id","role","resource")
);
--> statement-breakpoint
ALTER TABLE "ai_role_grant" ADD CONSTRAINT "ai_role_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_role_grant_org_idx" ON "ai_role_grant" USING btree ("organization_id");