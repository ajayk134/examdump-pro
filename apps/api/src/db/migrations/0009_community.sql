CREATE TABLE "question_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"exam_key" text NOT NULL,
	"question_id" text NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"exam_key" text NOT NULL,
	"question_id" text NOT NULL,
	"choice_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_comments" ADD CONSTRAINT "question_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_comments" ADD CONSTRAINT "question_comments_parent_id_question_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."question_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_comments_question_idx" ON "question_comments" USING btree ("provider_id","exam_key","question_id","created_at");--> statement-breakpoint
CREATE INDEX "question_comments_parent_idx" ON "question_comments" USING btree ("parent_id","created_at");--> statement-breakpoint
CREATE INDEX "question_comments_user_idx" ON "question_comments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "question_votes_user_question_unique" ON "question_votes" USING btree ("user_id","provider_id","exam_key","question_id");--> statement-breakpoint
CREATE INDEX "question_votes_question_idx" ON "question_votes" USING btree ("provider_id","exam_key","question_id");