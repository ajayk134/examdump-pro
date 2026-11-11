-- ExamDump UPI: self-hosted UPI collection with notification-based matching.
--
-- Additive and idempotent: nothing existing is dropped or renamed. The existing
-- `payments` table remains the single source of truth for money owed and for
-- entitlement settlement; these tables model the *collection attempt* and the
-- *evidence* used to decide it was paid.

/* ------------------------------- enums -------------------------------- */

DO $$ BEGIN
	CREATE TYPE "public"."upi_order_status" AS ENUM('pending', 'under_review', 'settled', 'expired', 'cancelled', 'refunded', 'partially_refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."upi_notification_source" AS ENUM('gmail', 'sms', 'webhook', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."upi_notification_status" AS ENUM('received', 'matched', 'unmatched', 'rejected', 'ignored');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "public"."upi_match_decision" AS ENUM('auto_approved', 'manual_approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

/* ------------------------------ upi_orders ----------------------------- */

CREATE TABLE IF NOT EXISTS "upi_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount_paise" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payee_vpa" text NOT NULL,
	"payee_name" text NOT NULL,
	"status" "public"."upi_order_status" DEFAULT 'pending' NOT NULL,
	"upi_uri" text NOT NULL,
	"plan_id" text,
	"description" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"closed_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_orders" ADD CONSTRAINT "upi_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_orders" ADD CONSTRAINT "upi_orders_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "upi_orders_reference_idx" ON "upi_orders" USING btree ("reference");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_orders_status_expiry_idx" ON "upi_orders" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_orders_user_idx" ON "upi_orders" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_orders_amount_idx" ON "upi_orders" USING btree ("amount_paise","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_orders_payment_idx" ON "upi_orders" USING btree ("payment_id");
--> statement-breakpoint

/* --------------------------- upi_notifications ------------------------- */

CREATE TABLE IF NOT EXISTS "upi_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "public"."upi_notification_source" NOT NULL,
	"dedupe_key" text NOT NULL,
	"bank_reference" text,
	"amount_paise" integer,
	"sender_vpa" text,
	"observed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "public"."upi_notification_status" DEFAULT 'received' NOT NULL,
	"decision_reason" text,
	"confidence" integer,
	"raw_text" text DEFAULT '' NOT NULL,
	"raw_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The duplicate guard for source messages, and the "a UTR settles once, ever"
-- guard. The UTR index is partial so unmatched notifications without a
-- reference do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "upi_notifications_dedupe_idx" ON "upi_notifications" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "upi_notifications_utr_idx" ON "upi_notifications" USING btree ("bank_reference") WHERE "bank_reference" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_notifications_status_idx" ON "upi_notifications" USING btree ("status","received_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_notifications_observed_idx" ON "upi_notifications" USING btree ("observed_at");
--> statement-breakpoint

/* ------------------------------ upi_matches ---------------------------- */

CREATE TABLE IF NOT EXISTS "upi_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"decision" "public"."upi_match_decision" NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"amount_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_matches" ADD CONSTRAINT "upi_matches_order_id_upi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."upi_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_matches" ADD CONSTRAINT "upi_matches_notification_id_upi_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."upi_notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "upi_matches_notification_idx" ON "upi_matches" USING btree ("notification_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "upi_matches_order_settled_idx" ON "upi_matches" USING btree ("order_id") WHERE "decision" IN ('auto_approved', 'manual_approved');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_matches_order_idx" ON "upi_matches" USING btree ("order_id");
--> statement-breakpoint

/* ---------------------------- upi_risk_events -------------------------- */

CREATE TABLE IF NOT EXISTS "upi_risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"notification_id" uuid,
	"decision" text NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_risk_events" ADD CONSTRAINT "upi_risk_events_order_id_upi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."upi_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_risk_events" ADD CONSTRAINT "upi_risk_events_notification_id_upi_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."upi_notifications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "upi_risk_events_created_idx" ON "upi_risk_events" USING btree ("created_at");
--> statement-breakpoint

/* --------------------------- upi_observer_state ------------------------ */

CREATE TABLE IF NOT EXISTS "upi_observer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_poll_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "upi_observer_state_poll_idx" ON "upi_observer_state" USING btree ("last_poll_at");
--> statement-breakpoint

/* ------------------------------ upi_refunds ---------------------------- */

CREATE TABLE IF NOT EXISTS "upi_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"payout_reference" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_refunds" ADD CONSTRAINT "upi_refunds_order_id_upi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."upi_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "upi_refunds" ADD CONSTRAINT "upi_refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "upi_refunds_order_idx" ON "upi_refunds" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upi_refunds_status_idx" ON "upi_refunds" USING btree ("status");
--> statement-breakpoint

-- The `upi` provider value on the existing payments enum. ALTER TYPE ... ADD
-- VALUE cannot run inside a transaction, so the migration runner emits this one
-- as a standalone statement (same approach as 0005).
ALTER TYPE "public"."payment_provider" ADD VALUE IF NOT EXISTS 'upi';
