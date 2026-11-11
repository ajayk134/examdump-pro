ALTER TYPE "public"."access_scope" ADD VALUE IF NOT EXISTS 'multi' BEFORE 'all';--> statement-breakpoint
ALTER TYPE "public"."payment_provider" ADD VALUE IF NOT EXISTS 'hyperswitch' BEFORE 'none';--> statement-breakpoint
