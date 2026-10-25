CREATE TABLE "org_control" (
	"organization_id" text NOT NULL,
	"control_id" text NOT NULL,
	"code" text,
	"domain_id" text,
	"title" text,
	"statement" text,
	"guidance" text,
	"tier" text,
	"supports" text,
	"target_asset" text,
	"expected_evidence" text[],
	"weight" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_control_organization_id_control_id_pk" PRIMARY KEY("organization_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "org_control_domain" (
	"organization_id" text NOT NULL,
	"domain_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"owner" text,
	"pillar_id" text,
	"pillar_name" text,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_control_domain_organization_id_domain_id_pk" PRIMARY KEY("organization_id","domain_id")
);
--> statement-breakpoint
ALTER TABLE "org_control" ADD CONSTRAINT "org_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_control_domain" ADD CONSTRAINT "org_control_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_control_org_idx" ON "org_control" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_control_domain_org_idx" ON "org_control_domain" USING btree ("organization_id");