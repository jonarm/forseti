CREATE TABLE "ai_account_person" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"person_id" text NOT NULL,
	"linked_by" text,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_account_person_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ai_account_person" ADD CONSTRAINT "ai_account_person_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_account_person" ADD CONSTRAINT "ai_account_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_account_person" ADD CONSTRAINT "ai_account_person_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."ai_person"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_account_person_org_person_uidx" ON "ai_account_person" USING btree ("organization_id","person_id");