CREATE TABLE "ai_intake_note" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_intake_note_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_intake_note" ADD CONSTRAINT "ai_intake_note_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_intake_note" ADD CONSTRAINT "ai_intake_note_organization_id_request_id_ai_intake_request_organization_id_id_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."ai_intake_request"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_intake_note_org_request_idx" ON "ai_intake_note" USING btree ("organization_id","request_id","created_at");