CREATE TABLE "ai_review_assignment" (
	"organization_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"stage" text NOT NULL,
	"assignee_user_id" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_assignment_organization_id_subject_kind_subject_id_stage_pk" PRIMARY KEY("organization_id","subject_kind","subject_id","stage")
);
--> statement-breakpoint
ALTER TABLE "ai_review_assignment" ADD CONSTRAINT "ai_review_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_review_assignment_org_assignee_idx" ON "ai_review_assignment" USING btree ("organization_id","assignee_user_id");