/**
 * Migration runner backed by drizzle-kit generated SQL.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run migrate -w @examdump/api
 *   (or) doppler run -- npm run migrate -w @examdump/api
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEnv } from '../config/env.js';
import { connectDB, disconnectDB, getDb } from '../db/client.js';

async function run(): Promise<void> {
  const env = getEnv();
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), 'src/db/migrations'),
    resolve(process.cwd(), 'apps/api/src/db/migrations'),
    resolve(process.cwd(), 'db/migrations'),
  ].filter((p): p is string => Boolean(p));

  const folder = candidates.find((p) => existsSync(p));
  if (!folder) {
    throw new Error(`Could not locate migrations folder. Tried: ${candidates.join(', ')}`);
  }

  await connectDB({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 1 });
  console.log(`Applying migrations from ${folder} ...`);
  await migrate(getDb(), { migrationsFolder: folder });
  console.log('Migrations complete.');
  await disconnectDB();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
