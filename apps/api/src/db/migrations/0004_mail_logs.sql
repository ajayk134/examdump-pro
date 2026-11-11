-- ExamDump Mail: delivery log.
--
-- Additive only. Nothing in the existing schema is altered, so this migration is
-- safe to apply on a live database while the previous API version is running.
-- Every statement that can be re-run is guarded.

DO $$ BEGIN
	CREATE TYPE "public"."mail_status" AS ENUM('queued', 'sent', 'failed', 'suppressed');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."mail_template" AS ENUM(
		'email_verify',
		'password_reset',
		'welcome',
		'payment_receipt',
		'subscription_activated',
		'subscription_renewed',
		'subscription_expiring',
		'subscription_cancelled',
		'refund_processed',
		'test'
	);
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mail_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"template" "mail_template" NOT NULL,
	"recipient" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" "mail_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"message_id" text,
	"last_error" text,
	"reference_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "mail_logs" ADD CONSTRAINT "mail_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mail_logs_created_idx" ON "mail_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_logs_recipient_idx" ON "mail_logs" USING btree ("recipient","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_logs_status_idx" ON "mail_logs" USING btree ("status","created_at");
