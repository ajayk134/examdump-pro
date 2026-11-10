import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { dailyUsage, type DailyUsage } from '../db/schema/index.js';
import { quotaExceeded } from '../lib/errors.js';

export type UsageField = 'questionsViewed' | 'mockExams' | 'randomQuestions' | 'aiExplanations';

const COLUMN: Record<UsageField, 'questionsViewed' | 'mockExams' | 'randomQuestions' | 'aiExplanations'> = {
  questionsViewed: 'questionsViewed',
  mockExams: 'mockExams',
  randomQuestions: 'randomQuestions',
  aiExplanations: 'aiExplanations',
};

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function getDailyUsage(userId: string, date = todayKey()): Promise<DailyUsage> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, date)))
    .limit(1);
  if (existing) return existing;

  await db.insert(dailyUsage).values({ userId, date }).onConflictDoNothing();
  const [created] = await db
    .select()
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, date)))
    .limit(1);
  return created!;
}

export async function incrementUsage(userId: string, field: UsageField, amount = 1): Promise<DailyUsage> {
  const db = getDb();
  const date = todayKey();
  const column = dailyUsage[COLUMN[field]];
  const [row] = await db
    .insert(dailyUsage)
    .values({ userId, date, [field]: amount })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.date],
      set: { [field]: sql`${column} + ${amount}` },
    })
    .returning();
  return row!;
}

export interface QuotaCheck {
  field: UsageField;
  limit: number | null;
  label: string;
}

export async function assertWithinQuota(userId: string, checks: QuotaCheck[], amount = 1): Promise<void> {
  const usage = await getDailyUsage(userId);
  for (const check of checks) {
    if (check.limit === null) continue;
    const used = (usage[check.field] as number | undefined) ?? 0;
    if (used + amount > check.limit) {
      throw quotaExceeded(
        `You have reached your daily ${check.label} limit (${check.limit}). Upgrade for unlimited access.`,
        { field: check.field, limit: check.limit, used },
      );
    }
  }
}
