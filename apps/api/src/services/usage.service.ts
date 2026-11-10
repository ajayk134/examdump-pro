import type { Types } from 'mongoose';
import { DailyUsage, type DailyUsageDoc } from '../db/models/index.js';
import { quotaExceeded } from '../lib/errors.js';

export type UsageField = 'questionsViewed' | 'mockExams' | 'randomQuestions' | 'aiExplanations';

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function getDailyUsage(userId: Types.ObjectId | string, date = todayKey()): Promise<DailyUsageDoc> {
  const existing = await DailyUsage.findOne({ userId, date });
  if (existing) return existing;
  return DailyUsage.findOneAndUpdate(
    { userId, date },
    { $setOnInsert: { userId, date } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export async function incrementUsage(
  userId: Types.ObjectId | string,
  field: UsageField,
  amount = 1,
): Promise<DailyUsageDoc> {
  return DailyUsage.findOneAndUpdate(
    { userId, date: todayKey() },
    { $inc: { [field]: amount }, $setOnInsert: { userId, date: todayKey() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export interface QuotaCheck {
  field: UsageField;
  limit: number | null;
  label: string;
}

export async function assertWithinQuota(
  userId: Types.ObjectId | string,
  checks: QuotaCheck[],
  amount = 1,
): Promise<void> {
  const usage = await getDailyUsage(userId);
  for (const check of checks) {
    if (check.limit === null) continue;
    const used = (usage[check.field] as number | undefined) ?? 0;
    if (used + amount > check.limit) {
      throw quotaExceeded(
        `You have reached your daily ${check.label} limit (${check.limit}). Upgrade to Premium for unlimited access.`,
        { field: check.field, limit: check.limit, used },
      );
    }
  }
}