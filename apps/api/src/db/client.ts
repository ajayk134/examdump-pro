import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface ConnectOptions {
  url: string;
  max?: number;
  ssl?: boolean;
  applicationName?: string;
}

let sql: Sql | null = null;
let db: Database | null = null;

/**
 * Create the connection pool and Drizzle instance. Idempotent: repeated calls
 * with an already-open pool are ignored so tests can share one connection.
 */
export async function connectDB(options: ConnectOptions): Promise<Database> {
  if (db) return db;
  sql = postgres(options.url, {
    max: options.max ?? 20,
    idle_timeout: 30,
    connect_timeout: 15,
    ssl: options.ssl ? 'require' : false,
    connection: { application_name: options.applicationName ?? 'examdump-api' },
    onnotice: () => {},
  });
  // Fail fast if the database is unreachable.
  await sql`select 1`;
  db = drizzle(sql, { schema });
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database is not connected. Call connectDB() first.');
  return db;
}

export function getSql(): Sql {
  if (!sql) throw new Error('Database is not connected. Call connectDB() first.');
  return sql;
}

export async function disconnectDB(): Promise<void> {
  if (!sql) return;
  const closing = sql;
  sql = null;
  db = null;
  await closing.end({ timeout: 5 });
}

export async function isDBConnected(): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export { schema };
