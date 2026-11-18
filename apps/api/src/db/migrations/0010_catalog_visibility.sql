ALTER TABLE "catalog_exams" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_providers" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;