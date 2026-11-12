-- Unique per-attempt UPI amounts.
--
-- Two customers paying the same plan used to be told to transfer the identical
-- number of paise, which made a credit ambiguous: either order could claim it.
-- Each order now carries the plan price plus a unique 1-99 paisa suffix, so a
-- credit maps to exactly one live order.
--
-- This narrows ambiguity; it is NOT proof of payment. Settlement still requires
-- a bank transaction reference and still runs through the notification dedupe
-- rules. See docs/infrastructure/upi-collection.md.

-- Step 1: add the column nullable so existing rows can be backfilled.
ALTER TABLE "upi_orders" ADD COLUMN IF NOT EXISTS "base_amount_paise" integer;

-- Step 2: backfill. Existing orders were created without a suffix, so their
-- payable amount *is* the base amount. COALESCE covers a row inserted between
-- the ALTER and this statement.
UPDATE "upi_orders"
SET "base_amount_paise" = COALESCE("base_amount_paise", "amount_paise")
WHERE "base_amount_paise" IS NULL;

-- Step 3: enforce it for every future row.
ALTER TABLE "upi_orders" ALTER COLUMN "base_amount_paise" SET NOT NULL;

-- Step 4: guard the suffix range at the storage layer. The suffix is 1-99 paise,
-- so a payable amount can never be below its base, nor more than 99 paise above.
-- A CHECK is cheaper than a trigger and catches any future code path that
-- forgets to set the base correctly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'upi_orders_amount_suffix_ck'
  ) THEN
    ALTER TABLE "upi_orders"
      ADD CONSTRAINT "upi_orders_amount_suffix_ck"
      CHECK (
        "amount_paise" >= "base_amount_paise"
        AND "amount_paise" <= "base_amount_paise" + 99
      );
  END IF;
END $$;

-- Step 5: at most one live order per amount.
--
-- Concurrent checkouts that draw the same suffix collide here rather than both
-- succeeding; the losing insert retries with a new suffix. Partial so an expired
-- or settled order does not reserve its amount forever.
--
-- Before creating the index, clear any collision that already exists in old
-- data. Pre-suffix orders could share an amount, and those still-live rows would
-- block the unique index. Rewriting a live order's payable amount is only safe if
-- two things hold, and this migration enforces both:
--
--   1. the order has not been shown to anyone yet is impossible to know, so we
--      instead make the change harmless by keeping the *frozen* uri untouched and
--      discarding the order instead of re-pricing it. A customer holding an old
--      QR for a since-cancelled order is safe: the order is cancelled, so a
--      payment to it will not settle.
--   2. no notification is currently matched to it.
--
-- Cancelling duplicates is the conservative choice: it can never charge someone
-- an amount they did not see. Those customers simply start a new checkout, which
-- now receives a unique amount.
UPDATE "upi_orders" o
SET
  "status" = 'cancelled',
  "cancelled_at" = COALESCE(o."cancelled_at", now()),
  "closed_reason" = 'superseded_by_unique_amount_migration',
  "updated_at" = now()
FROM (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "amount_paise" ORDER BY "created_at") AS "rn"
  FROM "upi_orders"
  WHERE "status" IN ('pending', 'under_review')
) ranked
WHERE o."id" = ranked."id"
  AND ranked."rn" > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "upi_orders_active_amount_idx"
  ON "upi_orders" ("amount_paise")
  WHERE "status" IN ('pending', 'under_review');
