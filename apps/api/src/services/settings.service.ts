import type { Env } from '../config/env.js';
import { Settings, type SettingsDoc } from '../db/models/index.js';

let cached: { value: SettingsDoc; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(env: Env, force = false): Promise<SettingsDoc> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  let settings = await Settings.findOne({ key: 'global' });
  if (!settings) {
    settings = await Settings.create({
      key: 'global',
      freeQuestionsPerExam: env.FREE_QUESTIONS_PER_EXAM,
      freeMockExamsPerDay: 1,
      freeRandomQuestionsPerDay: 20,
      premiumDailyQuestionLimit: env.PREMIUM_DAILY_QUESTION_LIMIT,
    });
  }
  cached = { value: settings, expiresAt: Date.now() + TTL_MS };
  return settings;
}

export function invalidateSettingsCache(): void {
  cached = null;
}

export async function updateSettings(
  patch: Partial<
    Pick<
      SettingsDoc,
      | 'freeQuestionsPerExam'
      | 'freeMockExamsPerDay'
      | 'freeRandomQuestionsPerDay'
      | 'premiumDailyQuestionLimit'
      | 'maintenanceMode'
      | 'registrationsOpen'
      | 'announcement'
    >
  >,
): Promise<SettingsDoc> {
  const settings = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set: patch, $setOnInsert: { key: 'global' } },
    { new: true, upsert: true },
  );
  invalidateSettingsCache();
  return settings;
}