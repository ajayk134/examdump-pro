/**
 * Migration runner.
 *
 * Drizzle generated SQL lives in `src/db/migrations` and is applied in journal
 * order. Two things differ from the stock runner:
 *
 *  1. `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on
 *     PostgreSQL, so statements are executed one by one (each DDL statement in
 *     this project is additive and idempotent-safe). Enum values are guarded by
 *     a duplicate check.
 *  2. Progress is recorded in the same `drizzle.__drizzle_migrations` table
 *     Drizzle uses, so `drizzle-kit` stays in sync.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run migrate -w @examdump/api
 *   doppler run -- npm run migrate -w @examdump/api
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { getEnv } from '../config/env.js';
import { applyMigrations } from '../db/apply-migrations.js';

async function run(): Promise<void> {
  const env = getEnv();
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), 'src/db/migrations'),
    resolve(process.cwd(), 'apps/api/src/db/migrations'),
    resolve(process.cwd(), 'db/migrations'),
  ].filter((p): p is string => Boolean(p));

  const folder = candidates.find((p) => existsSync(p));
  if (!folder) throw new Error(`Could not locate migrations folder. Tried: ${candidates.join(', ')}`);

  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const result = await applyMigrations(sql, folder);
    console.log(
      result.applied.length === 0
        ? 'Database is up to date.'
        : `Migrations complete (${result.applied.length} applied).`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
