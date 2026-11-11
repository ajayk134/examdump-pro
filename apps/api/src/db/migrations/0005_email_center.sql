-- ExamDump Mail: durable email queue, campaigns, suppression, preferences.
--
-- Additive and idempotent. Nothing existing is dropped or renamed. The
-- pre-existing `email_templates` table is extended in place so any rows already
-- present keep working.

/* ------------------------------- enums -------------------------------- */

DO $$ BEGIN
	CREATE TYPE "public"."email_queue_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'dead', 'cancelled', 'suppressed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."email_category" AS ENUM('transactional', 'marketing');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'complaint', 'unsubscribe_marketing', 'unsubscribe_all', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

/* --------------------- extend existing email_templates ----------------- */

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "text_body" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "category" "email_category" DEFAULT 'transactional' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "variables" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "is_system" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

/* ------------------------------ queue --------------------------------- */

CREATE TABLE IF NOT EXISTS "email_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"campaign_id" uuid,
	"template" text NOT NULL,
	"category" "email_category" DEFAULT 'transactional' NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" "email_queue_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"message_id" text,
	"dedupe_key" text,
	"reference_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "email_queue" ADD CONSTRAINT "email_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_queue_due_idx" ON "email_queue" USING btree ("status","scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_queue_recipient_idx" ON "email_queue" USING btree ("recipient","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_queue_campaign_idx" ON "email_queue" USING btree ("campaign_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_queue_status_idx" ON "email_queue" USING btree ("status","created_at");
--> statement-breakpoint

-- Idempotency: two workers noticing the same expiring subscription, or a
-- retried request, must not queue the message twice. Partial so rows without a
-- dedupe key are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "email_queue_dedupe_idx" ON "email_queue" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint

/* ---------------------------- campaigns -------------------------------- */

CREATE TABLE IF NOT EXISTS "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"template_key" text,
	"category" "email_category" DEFAULT 'marketing' NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_campaigns_status_idx" ON "email_campaigns" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_campaigns_scheduled_idx" ON "email_campaigns" USING btree ("status","scheduled_for");
--> statement-breakpoint

/* --------------------------- suppression ------------------------------- */

CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT 'marketing' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_email_idx" ON "email_suppressions" USING btree ("email");
--> statement-breakpoint

/* --------------------------- preferences ------------------------------- */

CREATE TABLE IF NOT EXISTS "email_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"product_updates" boolean DEFAULT true NOT NULL,
	"subscription_reminders" boolean DEFAULT true NOT NULL,
	"weekly_report" boolean DEFAULT true NOT NULL,
	"security_alerts" boolean DEFAULT true NOT NULL,
	"consent_source" text DEFAULT 'default' NOT NULL,
	"consent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

/* ------------------- new transactional template names ------------------- */

ALTER TYPE "public"."mail_template" ADD VALUE IF NOT EXISTS 'login_alert';
--> statement-breakpoint
ALTER TYPE "public"."mail_template" ADD VALUE IF NOT EXISTS 'password_changed';
--> statement-breakpoint
ALTER TYPE "public"."mail_template" ADD VALUE IF NOT EXISTS 'account_notice';
--> statement-breakpoint
ALTER TYPE "public"."mail_template" ADD VALUE IF NOT EXISTS 'support_received';
--> statement-breakpoint
ALTER TYPE "public"."mail_template" ADD VALUE IF NOT EXISTS 'announcement';
