import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { AccessScope, Plan } from '@examdump/shared';
import { getDb } from '../db/client.js';
import {
  accessGrants,
  subscriptions,
  type Settings,
  type User,
} from '../db/schema/index.js';

export type EntitlementPlan = Plan;

export interface EntitlementSource {
  type: 'subscription' | 'grant' | 'admin';
  id: string;
  scope: AccessScope;
  examKey: string | null;
  providerId: string | null;
  earlyAccess: boolean;
  expiresAt: Date | null;
}

export interface Entitlements {
  plan: EntitlementPlan;
  scope: AccessScope | 'none';
  unlimitedQuestions: boolean;
  allAccess: boolean;
  examKeys: string[];
  providerIds: string[];
  earlyAccess: boolean;
  expiresAt: Date | null;
  questionsPerExam: number | null;
  mockExamsPerDay: number | null;
  randomQuestionsPerDay: number | null;
  dailyQuestionLimit: number;
  sources: EntitlementSource[];
}

export function isPremiumActive(
  user: Pick<User, 'plan' | 'premiumUntil'> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.plan !== 'premium') return false;
  if (!user.premiumUntil) return true;
  return user.premiumUntil.getTime() > Date.now();
}

export type SettingsLimits = Pick<
  Settings,
  'freeQuestionsPerExam' | 'freeMockExamsPerDay' | 'freeRandomQuestionsPerDay' | 'premiumDailyQuestionLimit'
>;

function freeEntitlements(settings: SettingsLimits): Entitlements {
  return {
    plan: 'free',
    scope: 'none',
    unlimitedQuestions: false,
    allAccess: false,
    examKeys: [],
    providerIds: [],
    earlyAccess: false,
    expiresAt: null,
    questionsPerExam: settings.freeQuestionsPerExam,
    mockExamsPerDay: settings.freeMockExamsPerDay,
    randomQuestionsPerDay: settings.freeRandomQuestionsPerDay,
    dailyQuestionLimit: settings.premiumDailyQuestionLimit,
    sources: [],
  };
}

/**
 * Resolve the authoritative entitlement set for a user.
 *
 * Access is derived only from active subscriptions and access grants (plus the
 * admin role), never from client input. The denormalised `users.plan` column is
 * only used for listing/sorting elsewhere.
 */
export async function resolveEntitlements(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  settings: SettingsLimits,
): Promise<Entitlements> {
  if (!user) return freeEntitlements(settings);

  if (user.role === 'admin') {
    return {
      plan: 'premium',
      scope: 'all',
      unlimitedQuestions: true,
      allAccess: true,
      examKeys: [],
      providerIds: [],
      earlyAccess: true,
      expiresAt: null,
      questionsPerExam: null,
      mockExamsPerDay: null,
      randomQuestionsPerDay: null,
      dailyQuestionLimit: 0,
      sources: [{ type: 'admin', id: user.id, scope: 'all', examKey: null, providerId: null, earlyAccess: true, expiresAt: null }],
    };
  }

  const db = getDb();
  const now = new Date();

  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, user.id),
        or(
          inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
          and(eq(subscriptions.status, 'canceled'), gt(subscriptions.currentPeriodEnd, now)),
        ),
        gt(subscriptions.currentPeriodEnd, now),
      ),
    );

  const grants = await db
    .select()
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.userId, user.id),
        isNull(accessGrants.revokedAt),
        or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
      ),
    );

  const sources: EntitlementSource[] = [
    ...activeSubs.map((s) => ({
      type: 'subscription' as const,
      id: s.id,
      scope: s.scope,
      examKey: s.examKey,
      providerId: s.providerId,
      earlyAccess: s.earlyAccess,
      expiresAt: s.currentPeriodEnd,
    })),
    ...grants.map((g) => ({
      type: 'grant' as const,
      id: g.id,
      scope: g.scope,
      examKey: g.examKey,
      providerId: g.providerId,
      earlyAccess: false,
      expiresAt: g.expiresAt,
    })),
  ];

  const allAccess = sources.some((s) => s.scope === 'all');
  const examKeys = [...new Set(sources.filter((s) => s.scope === 'single' && s.examKey).map((s) => s.examKey!))];
  const providerIds = [
    ...new Set(sources.filter((s) => s.scope === 'single' && s.providerId).map((s) => s.providerId!)),
  ];
  const earlyAccess = sources.some((s) => s.earlyAccess);
  const scopedAccess = examKeys.length > 0 || providerIds.length > 0;

  const expiresAt = sources.reduce<Date | null>((latest, s) => {
    if (s.scope === 'all' && s.expiresAt && (!latest || s.expiresAt > latest)) return s.expiresAt;
    return latest;
  }, null);

  if (!allAccess && !scopedAccess) return freeEntitlements(settings);

  return {
    plan: 'premium',
    scope: allAccess ? 'all' : 'single',
    unlimitedQuestions: true,
    allAccess,
    examKeys,
    providerIds,
    earlyAccess,
    expiresAt,
    // Free limits stay available so exams outside a scoped plan still behave
    // like a free account rather than blocking entirely.
    questionsPerExam: settings.freeQuestionsPerExam,
    mockExamsPerDay: settings.freeMockExamsPerDay,
    randomQuestionsPerDay: settings.freeRandomQuestionsPerDay,
    dailyQuestionLimit: settings.premiumDailyQuestionLimit,
    sources,
  };
}

/**
 * True when the entitlement grants full access to the given exam. Matching is
 * strictly by exam key: a single-exam plan unlocks exactly one exam, never the
 * whole provider.
 */
export function canAccessExam(
  entitlements: Pick<Entitlements, 'allAccess' | 'examKeys'>,
  examKey: string | undefined,
  _providerId?: string,
): boolean {
  if (entitlements.allAccess) return true;
  if (examKey && entitlements.examKeys.includes(examKey)) return true;
  return false;
}
