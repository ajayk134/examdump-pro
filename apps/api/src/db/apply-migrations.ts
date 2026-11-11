/**
 * Shared migration applier used by the CLI (`scripts/migrate.ts`), the seed
 * script and the integration tests.
 *
 * Statements are executed individually because `ALTER TYPE ... ADD VALUE`
 * cannot run inside a transaction block; enum additions are guarded so the
 * runner is safe to re-run.
 */
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Sql } from 'postgres';

export interface ApplyResult {
  applied: string[];
}

export async function applyMigrations(sql: Sql, migrationsFolder: string): Promise<ApplyResult> {
  const migrations = readMigrationFiles({ migrationsFolder });

  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`;
  const [last] = await sql<{ created_at: string | null }[]>`
    select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
  const lastApplied = last?.created_at ? Number(last.created_at) : 0;

  const applied: string[] = [];
  for (const migration of migrations) {
    if (migration.folderMillis <= lastApplied) continue;
    for (const statement of migration.sql) {
      if (!statement.trim()) continue;
      if (/^\s*ALTER\s+TYPE/i.test(statement) && /ADD\s+VALUE/i.test(statement)) {
        const value = /ADD\s+VALUE\s+'([^']+)'/i.exec(statement)?.[1];
        const type = /ALTER\s+TYPE\s+(?:"?public"?\.)?"?(\w+)"?/i.exec(statement)?.[1];
        if (value && type) {
          const [exists] = await sql<{ exists: boolean }[]>`
            select exists (
              select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = ${type} and e.enumlabel = ${value}
            ) as exists`;
          if (exists?.exists) continue;
        }
      }
      await sql.unsafe(statement);
    }
    await sql`insert into drizzle.__drizzle_migrations ("hash", "created_at")
      values (${migration.hash}, ${migration.folderMillis})`;
    applied.push(String(migration.folderMillis));
  }
  return { applied };
}
