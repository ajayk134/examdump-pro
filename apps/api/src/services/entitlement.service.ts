import type { UserDoc } from '../db/models/index.js';
import type { SettingsDoc } from '../db/models/index.js';

export interface Entitlements {
  plan: 'free' | 'premium';
  unlimitedQuestions: boolean;
  questionsPerExam: number | null;
  mockExamsPerDay: number | null;
  randomQuestionsPerDay: number | null;
  dailyQuestionLimit: number;
}

export function isPremiumActive(user: Pick<UserDoc, 'plan' | 'premiumUntil'> | null | undefined): boolean {
  if (!user) return false;
  if (user.plan !== 'premium') return false;
  if (!user.premiumUntil) return true;
  return user.premiumUntil.getTime() > Date.now();
}

export function getEntitlements(
  user: Pick<UserDoc, 'plan' | 'premiumUntil'> | null | undefined,
  settings: Pick<
    SettingsDoc,
    'freeQuestionsPerExam' | 'freeMockExamsPerDay' | 'freeRandomQuestionsPerDay' | 'premiumDailyQuestionLimit'
  >,
): Entitlements {
  const premium = isPremiumActive(user);
  if (premium) {
    return {
      plan: 'premium',
      unlimitedQuestions: true,
      questionsPerExam: null,
      mockExamsPerDay: null,
      randomQuestionsPerDay: null,
      dailyQuestionLimit: settings.premiumDailyQuestionLimit,
    };
  }
  return {
    plan: 'free',
    unlimitedQuestions: false,
    questionsPerExam: settings.freeQuestionsPerExam,
    mockExamsPerDay: settings.freeMockExamsPerDay,
    randomQuestionsPerDay: settings.freeRandomQuestionsPerDay,
    dailyQuestionLimit: settings.premiumDailyQuestionLimit,
  };
}