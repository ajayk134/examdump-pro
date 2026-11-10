/**
 * Tiny, dependency-free migration runner.
 *
 * Migrations are declared in code (not read from disk) so this works the same
 * in tsx (dev/deploy checkout) and any future bundled runtime. Each migration
 * runs once and is recorded in the `migrations` collection.
 *
 * Usage:
 *   doppler run -- npx tsx src/scripts/migrate.ts
 */
import mongoose from 'mongoose';
import { getEnv } from '../config/env.js';
import { connectDB, disconnectDB } from '../db/connect.js';

interface Migration {
  id: string;
  description: string;
  up: (db: mongoose.mongo.Db) => Promise<void>;
}

const migrations: Migration[] = [
  {
    id: '001-unset-null-google-id',
    description: 'Remove null googleId values so the partial unique index is valid',
    up: async (db) => {
      await db.collection('users').updateMany(
        { googleId: null },
        { $unset: { googleId: '' } },
      );
    },
  },
  {
    id: '002-backfill-user-stats',
    description: 'Create a UserStats document for every user missing one',
    up: async (db) => {
      const users = await db
        .collection('users')
        .find({}, { projection: { _id: 1 } })
        .toArray();
      const statsUserIds = new Set(
        (await db.collection('userstats').find({}, { projection: { userId: 1 } }).toArray()).map((s) =>
          String(s.userId),
        ),
      );
      const missing = users.filter((u) => !statsUserIds.has(String(u._id)));
      if (missing.length > 0) {
        await db.collection('userstats').insertMany(
          missing.map((u) => ({
            userId: u._id,
            totalQuestions: 0,
            totalCorrect: 0,
            totalStudyMs: 0,
            mockTests: 0,
            currentStreak: 0,
            longestStreak: 0,
            lastActiveDate: '',
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
      }
    },
  },
];

async function run(): Promise<void> {
  const env = getEnv();
  await connectDB({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB });
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database connection is not ready');

  const migrationsCollection = db.collection<{
    _id: string;
    description: string;
    appliedAt: Date;
  }>('migrations');
  const applied = new Set(
    (await migrationsCollection.find().toArray()).map((m) => m._id),
  );

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      console.log(`skip  ${migration.id}`);
      continue;
    }
    console.log(`apply ${migration.id} — ${migration.description}`);
    await migration.up(db);
    await migrationsCollection.insertOne({
      _id: migration.id,
      description: migration.description,
      appliedAt: new Date(),
    });
    count += 1;
  }
  console.log(`done: ${count} migration(s) applied`);
  await disconnectDB();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});