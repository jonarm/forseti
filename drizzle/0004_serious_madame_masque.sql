CREATE TABLE "control_mapping" (
	"organization_id" text NOT NULL,
	"control_id" text NOT NULL,
	"framework_id" text NOT NULL,
	"area_id" text NOT NULL,
	"ref" text NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "control_mapping_organization_id_control_id_framework_id_pk" PRIMARY KEY("organization_id","control_id","framework_id")
);
--> statement-breakpoint
ALTER TABLE "control_mapping" ADD CONSTRAINT "control_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_mapping_org_idx" ON "control_mapping" USING btree ("organization_id");