CREATE TABLE "ai_activity_event" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"field" text,
	"before" text,
	"after" text,
	"at" timestamp DEFAULT now() NOT NULL,
	"via_suggestion_id" text,
	CONSTRAINT "ai_activity_event_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_applicability" (
	"organization_id" text NOT NULL,
	"framework_id" text NOT NULL,
	"control_id" text NOT NULL,
	"applicability" text DEFAULT 'yes' NOT NULL,
	"justification" text DEFAULT '' NOT NULL,
	"implementation_status" text DEFAULT 'not_started' NOT NULL,
	"owner_id" text,
	"linked_policy_id" text,
	"last_reviewed_at" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_applicability_organization_id_framework_id_control_id_pk" PRIMARY KEY("organization_id","framework_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "ai_applicability_system" (
	"organization_id" text NOT NULL,
	"framework_id" text NOT NULL,
	"control_id" text NOT NULL,
	"system_id" text NOT NULL,
	CONSTRAINT "ai_applicability_system_organization_id_framework_id_control_id_system_id_pk" PRIMARY KEY("organization_id","framework_id","control_id","system_id")
);
--> statement-breakpoint
CREATE TABLE "ai_assessment" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"system_id" text NOT NULL,
	"use_case_id" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"sign_off" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_assessment_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_assessment_answer" (
	"organization_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_assessment_answer_organization_id_assessment_id_field_id_pk" PRIMARY KEY("organization_id","assessment_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "ai_control" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"framework_id" text NOT NULL,
	"node_id" text NOT NULL,
	"official_ref" text NOT NULL,
	"short_title" text NOT NULL,
	"requirement_summary" text DEFAULT '' NOT NULL,
	"evidence_guidance" text DEFAULT '' NOT NULL,
	"development_only" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_control_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_evidence" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'policy' NOT NULL,
	"owner_id" text,
	"source" text DEFAULT '' NOT NULL,
	"collected_at" text NOT NULL,
	"expires_at" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"file" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_evidence_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_evidence_link" (
	"organization_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	CONSTRAINT "ai_evidence_link_organization_id_evidence_id_target_kind_target_id_pk" PRIMARY KEY("organization_id","evidence_id","target_kind","target_id")
);
--> statement-breakpoint
CREATE TABLE "ai_finding" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'self_identified' NOT NULL,
	"raised_by" text DEFAULT '' NOT NULL,
	"raised_at" text NOT NULL,
	"due_at" text NOT NULL,
	"owner_id" text,
	"system_id" text,
	"control_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"root_cause" text,
	"corrective_action" text,
	"verified_by_id" text,
	"verified_at" text,
	"verification_note" text,
	"closed_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_finding_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_finding_risk" (
	"organization_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"risk_id" text NOT NULL,
	"kind" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_finding_risk_organization_id_finding_id_risk_id_pk" PRIMARY KEY("organization_id","finding_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "ai_framework" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ai_framework_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_framework_node" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"framework_id" text NOT NULL,
	"official_ref" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"short_title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_framework_node_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_intake_request" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"reference" text NOT NULL,
	"submission" jsonb NOT NULL,
	"submitted_by_id" text,
	"submitted_at" text NOT NULL,
	"status" text DEFAULT 'awaiting_decision' NOT NULL,
	"reviewer_id" text,
	"review_type" text,
	"override_justification" text,
	"decision" text,
	"decided_by_id" text,
	"decided_at" text,
	"comments" text DEFAULT '' NOT NULL,
	"created_system_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_intake_request_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_person" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"business_unit" text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_person_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_policy" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" text,
	"version" text DEFAULT '1.0' NOT NULL,
	"approved_at" text,
	"next_review_date" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_policy_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_questionnaire" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"requester" text NOT NULL,
	"requester_type" text DEFAULT 'customer' NOT NULL,
	"received_at" text NOT NULL,
	"due_at" text NOT NULL,
	"owner_id" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_questionnaire_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_questionnaire_question" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"questionnaire_id" text NOT NULL,
	"number" text NOT NULL,
	"text" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"control_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "ai_questionnaire_question_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_risk" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"system_id" text,
	"use_case_id" text,
	"inherent_likelihood" integer NOT NULL,
	"inherent_impact" integer NOT NULL,
	"treatment" text DEFAULT 'mitigate' NOT NULL,
	"treatment_summary" text DEFAULT '' NOT NULL,
	"residual_likelihood" integer NOT NULL,
	"residual_impact" integer NOT NULL,
	"owner_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"accepted_by_id" text,
	"accepted_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_risk_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_risk_control" (
	"organization_id" text NOT NULL,
	"risk_id" text NOT NULL,
	"control_id" text NOT NULL,
	CONSTRAINT "ai_risk_control_organization_id_risk_id_control_id_pk" PRIMARY KEY("organization_id","risk_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "ai_suggestion" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"recommendation" text NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"supporting_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_id" text,
	"decided_at" text,
	"edited_text" text,
	CONSTRAINT "ai_suggestion_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_system" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"vendor" text NOT NULL,
	"origin" text NOT NULL,
	"is_gen_ai" boolean DEFAULT false NOT NULL,
	"business_unit" text NOT NULL,
	"owner_id" text,
	"lifecycle_stage" text DEFAULT 'proposed' NOT NULL,
	"risk_tier" text DEFAULT 'minimal' NOT NULL,
	"assessment_status" text DEFAULT 'not_started' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"deployment_model" text DEFAULT 'vendor_multi_tenant' NOT NULL,
	"hosting_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_residency" text DEFAULT '' NOT NULL,
	"user_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approx_users" integer DEFAULT 0 NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"characteristics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vendor_detail" jsonb,
	"registered_at" text NOT NULL,
	"next_review_date" text NOT NULL,
	"discovered_via" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_system_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_use_case" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"system_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"business_unit" text DEFAULT '' NOT NULL,
	"owner_id" text,
	"risk_tier" text DEFAULT 'minimal' NOT NULL,
	"oversight_level" text DEFAULT 'human_in_the_loop' NOT NULL,
	"oversight_summary" text DEFAULT '' NOT NULL,
	"faces_customers" boolean DEFAULT false NOT NULL,
	"informs_decisions_about_people" boolean DEFAULT false NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approx_users" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_use_case_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_activity_event" ADD CONSTRAINT "ai_activity_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_applicability" ADD CONSTRAINT "ai_applicability_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_applicability_system" ADD CONSTRAINT "ai_applicability_system_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_applicability_system" ADD CONSTRAINT "ai_applicability_system_organization_id_system_id_ai_system_organization_id_id_fk" FOREIGN KEY ("organization_id","system_id") REFERENCES "public"."ai_system"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assessment" ADD CONSTRAINT "ai_assessment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assessment" ADD CONSTRAINT "ai_assessment_organization_id_system_id_ai_system_organization_id_id_fk" FOREIGN KEY ("organization_id","system_id") REFERENCES "public"."ai_system"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assessment_answer" ADD CONSTRAINT "ai_assessment_answer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assessment_answer" ADD CONSTRAINT "ai_assessment_answer_organization_id_assessment_id_ai_assessment_organization_id_id_fk" FOREIGN KEY ("organization_id","assessment_id") REFERENCES "public"."ai_assessment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_control" ADD CONSTRAINT "ai_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_evidence" ADD CONSTRAINT "ai_evidence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_evidence_link" ADD CONSTRAINT "ai_evidence_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_evidence_link" ADD CONSTRAINT "ai_evidence_link_organization_id_evidence_id_ai_evidence_organization_id_id_fk" FOREIGN KEY ("organization_id","evidence_id") REFERENCES "public"."ai_evidence"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_finding" ADD CONSTRAINT "ai_finding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_finding_risk" ADD CONSTRAINT "ai_finding_risk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_finding_risk" ADD CONSTRAINT "ai_finding_risk_organization_id_finding_id_ai_finding_organization_id_id_fk" FOREIGN KEY ("organization_id","finding_id") REFERENCES "public"."ai_finding"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_finding_risk" ADD CONSTRAINT "ai_finding_risk_organization_id_risk_id_ai_risk_organization_id_id_fk" FOREIGN KEY ("organization_id","risk_id") REFERENCES "public"."ai_risk"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_framework" ADD CONSTRAINT "ai_framework_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_framework_node" ADD CONSTRAINT "ai_framework_node_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_intake_request" ADD CONSTRAINT "ai_intake_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_person" ADD CONSTRAINT "ai_person_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_policy" ADD CONSTRAINT "ai_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_questionnaire" ADD CONSTRAINT "ai_questionnaire_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_questionnaire_question" ADD CONSTRAINT "ai_questionnaire_question_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_risk" ADD CONSTRAINT "ai_risk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_risk_control" ADD CONSTRAINT "ai_risk_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_risk_control" ADD CONSTRAINT "ai_risk_control_organization_id_risk_id_ai_risk_organization_id_id_fk" FOREIGN KEY ("organization_id","risk_id") REFERENCES "public"."ai_risk"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system" ADD CONSTRAINT "ai_system_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD CONSTRAINT "ai_use_case_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD CONSTRAINT "ai_use_case_organization_id_system_id_ai_system_organization_id_id_fk" FOREIGN KEY ("organization_id","system_id") REFERENCES "public"."ai_system"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_activity_org_subject_idx" ON "ai_activity_event" USING btree ("organization_id","subject_id","at");--> statement-breakpoint
CREATE INDEX "ai_applicability_org_fw_idx" ON "ai_applicability" USING btree ("organization_id","framework_id");--> statement-breakpoint
CREATE INDEX "ai_applicability_org_status_idx" ON "ai_applicability" USING btree ("organization_id","implementation_status");--> statement-breakpoint
CREATE INDEX "ai_applicability_system_org_system_idx" ON "ai_applicability_system" USING btree ("organization_id","system_id");--> statement-breakpoint
CREATE INDEX "ai_assessment_org_id_idx" ON "ai_assessment" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_assessment_org_system_idx" ON "ai_assessment" USING btree ("organization_id","system_id");--> statement-breakpoint
CREATE INDEX "ai_assessment_org_status_idx" ON "ai_assessment" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_assessment_answer_org_field_idx" ON "ai_assessment_answer" USING btree ("organization_id","field_id");--> statement-breakpoint
CREATE INDEX "ai_control_org_fw_idx" ON "ai_control" USING btree ("organization_id","framework_id");--> statement-breakpoint
CREATE INDEX "ai_control_org_node_idx" ON "ai_control" USING btree ("organization_id","node_id");--> statement-breakpoint
CREATE INDEX "ai_evidence_org_id_idx" ON "ai_evidence" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_evidence_org_state_idx" ON "ai_evidence" USING btree ("organization_id","verification_state");--> statement-breakpoint
CREATE INDEX "ai_evidence_org_expiry_idx" ON "ai_evidence" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "ai_evidence_link_org_target_idx" ON "ai_evidence_link" USING btree ("organization_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "ai_finding_org_id_idx" ON "ai_finding" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_finding_org_status_idx" ON "ai_finding" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_finding_org_source_idx" ON "ai_finding" USING btree ("organization_id","source");--> statement-breakpoint
CREATE INDEX "ai_finding_org_system_idx" ON "ai_finding" USING btree ("organization_id","system_id");--> statement-breakpoint
CREATE INDEX "ai_finding_risk_org_risk_idx" ON "ai_finding_risk" USING btree ("organization_id","risk_id");--> statement-breakpoint
CREATE INDEX "ai_framework_org_idx" ON "ai_framework" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_framework_node_org_fw_idx" ON "ai_framework_node" USING btree ("organization_id","framework_id");--> statement-breakpoint
CREATE INDEX "ai_intake_org_id_idx" ON "ai_intake_request" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_intake_org_status_idx" ON "ai_intake_request" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_intake_org_reference_idx" ON "ai_intake_request" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "ai_person_org_unit_idx" ON "ai_person" USING btree ("organization_id","business_unit");--> statement-breakpoint
CREATE INDEX "ai_policy_org_status_idx" ON "ai_policy" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_questionnaire_org_due_idx" ON "ai_questionnaire" USING btree ("organization_id","due_at");--> statement-breakpoint
CREATE INDEX "ai_qq_org_questionnaire_idx" ON "ai_questionnaire_question" USING btree ("organization_id","questionnaire_id","position");--> statement-breakpoint
CREATE INDEX "ai_risk_org_id_idx" ON "ai_risk" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_risk_org_status_idx" ON "ai_risk" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_risk_org_system_idx" ON "ai_risk" USING btree ("organization_id","system_id");--> statement-breakpoint
CREATE INDEX "ai_risk_control_org_control_idx" ON "ai_risk_control" USING btree ("organization_id","control_id");--> statement-breakpoint
CREATE INDEX "ai_suggestion_org_target_idx" ON "ai_suggestion" USING btree ("organization_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "ai_suggestion_org_status_idx" ON "ai_suggestion" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_system_org_id_idx" ON "ai_system" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_system_org_origin_idx" ON "ai_system" USING btree ("organization_id","origin");--> statement-breakpoint
CREATE INDEX "ai_system_org_risk_idx" ON "ai_system" USING btree ("organization_id","risk_tier");--> statement-breakpoint
CREATE INDEX "ai_system_org_lifecycle_idx" ON "ai_system" USING btree ("organization_id","lifecycle_stage");--> statement-breakpoint
CREATE INDEX "ai_use_case_org_id_idx" ON "ai_use_case" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "ai_use_case_org_system_idx" ON "ai_use_case" USING btree ("organization_id","system_id");--> statement-breakpoint
CREATE INDEX "ai_use_case_org_decisions_idx" ON "ai_use_case" USING btree ("organization_id","informs_decisions_about_people");