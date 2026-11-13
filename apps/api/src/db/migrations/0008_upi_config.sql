-- Operator-editable UPI configuration.
--
-- Until now every UPI setting lived in environment variables, so changing the
-- payee VPA or reconnecting the payment mailbox required a deploy. This table
-- moves the routine settings into the database so the admin dashboard can edit
-- them, while keeping the encryption key itself in Doppler.
--
-- Design rules enforced here:
--   * one global row, so `key` is the primary key defaulted to 'global';
--   * credentials are stored only as AES-256-GCM envelopes (`*_enc`), never in
--     clear text, so a database dump alone does not yield a usable Gmail token;
--   * NULL means "unset, fall back to the environment", which keeps an
--     environment-only deployment working and makes rollback trivial;
--   * the three switches are NULLABLE, and NULL means "no dashboard opinion, use
--     the environment". They are deliberately not `NOT NULL DEFAULT false`: such
--     a column would silently override UPI_AUTO_APPROVE=true the moment this row
--     existed, changing behaviour of a deployment nobody reconfigured. An absent
--     row plus an absent environment value still yields the safe answer (off),
--     because the resolver defaults to false; and the dashboard will not write
--     `true` for auto-approval without an explicit, confirmed action.

CREATE TABLE IF NOT EXISTS "upi_config" (
  "key" text PRIMARY KEY DEFAULT 'global',

  "payee_vpa" text,
  "payee_name" text,

  "payments_enabled" boolean,
  "gmail_enabled" boolean,
  "auto_approve" boolean,

  "gmail_user" text,
  "gmail_client_id" text,
  "gmail_client_secret_enc" text,
  "gmail_refresh_token_enc" text,

  "gmail_connected_at" timestamp with time zone,
  "gmail_connected_email" text,
  "gmail_scopes" text,
  "gmail_last_verified_at" timestamp with time zone,

  "updated_by" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- The dashboard reads this on every poll cycle; the table has one row, so the
-- only useful guarantee is that the singleton exists once. Insert it here so
-- later code never has to handle a missing row on a read path.
INSERT INTO "upi_config" ("key") VALUES ('global') ON CONFLICT ("key") DO NOTHING;
