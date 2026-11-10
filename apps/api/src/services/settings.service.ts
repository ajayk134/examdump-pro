import { eq } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { settings, type Settings } from '../db/schema/index.js';

let cached: { value: Settings; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(env: Env, force = false): Promise<Settings> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const db = getDb();

  const [existing] = await db.select().from(settings).where(eq(settings.key, 'global')).limit(1);
  let value = existing;
  if (!value) {
    const [created] = await db
      .insert(settings)
      .values({
        key: 'global',
        freeQuestionsPerExam: env.FREE_QUESTIONS_PER_EXAM,
        freeMockExamsPerDay: 1,
        freeRandomQuestionsPerDay: 20,
        premiumDailyQuestionLimit: env.PREMIUM_DAILY_QUESTION_LIMIT,
        supportEmail: 'support@examdump.pro',
        siteName: 'ExamDump Pro',
      })
      .onConflictDoNothing()
      .returning();
    value =
      created ??
      (await db.select().from(settings).where(eq(settings.key, 'global')).limit(1))[0]!;
  }
  cached = { value, expiresAt: Date.now() + TTL_MS };
  return value;
}

export function invalidateSettingsCache(): void {
  cached = null;
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'freeQuestionsPerExam'
    | 'freeMockExamsPerDay'
    | 'freeRandomQuestionsPerDay'
    | 'premiumDailyQuestionLimit'
    | 'maintenanceMode'
    | 'registrationsOpen'
    | 'announcement'
    | 'supportEmail'
    | 'siteName'
  >
>;

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const db = getDb();
  const [updated] = await db
    .update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.key, 'global'))
    .returning();
  invalidateSettingsCache();
  if (!updated) throw new Error('Settings row is missing');
  return updated;
}
