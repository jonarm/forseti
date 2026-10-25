CREATE TABLE "control_answer" (
	"organization_id" text NOT NULL,
	"control_id" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "control_answer_organization_id_control_id_pk" PRIMARY KEY("organization_id","control_id")
);
--> statement-breakpoint
ALTER TABLE "control_answer" ADD CONSTRAINT "control_answer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_answer_org_idx" ON "control_answer" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "company_profile" DROP COLUMN "existing_policies";--> statement-breakpoint
ALTER TABLE "company_profile" DROP COLUMN "pasted_policy_text";