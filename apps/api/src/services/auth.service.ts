import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import type { LoginInput, RegisterInput } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import {
  accessGrants,
  authTokens,
  loginAttempts,
  referrals,
  sessions,
  userStats,
  users,
  type User,
} from '../db/schema/index.js';
import { conflict, serviceUnavailable, tooManyRequests, unauthorized } from '../lib/errors.js';
import { signAccessToken } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { hashToken, randomReferralCode, randomToken } from '../lib/tokens.js';
import { mailConfigured } from './mail/mail.service.js';
import {
  notifyLoginAlert,
  notifyPasswordChanged,
  notifyPasswordReset,
  notifyVerification,
  notifyWelcome,
} from './mail/notify.service.js';
import { sendTransactionalMail } from './mail/mail.service.js';
import { getSettings } from './settings.service.js';
import { createNotification } from './notification.service.js';
import { recordAudit } from './audit.service.js';
import { recomputeUserPlan } from './subscription.service.js';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

const MAX_FAILED_ATTEMPTS = 10;
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const REFERRER_REWARD_DAYS = 7;
const REFEREE_REWARD_DAYS = 3;

async function issueSession(user: User, env: Env, meta: RequestMeta): Promise<AuthResult> {
  const db = getDb();
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent ?? '',
      ip: meta.ip ?? '',
      expiresAt,
      lastUsedAt: new Date(),
    })
    .returning();
  if (!session) throw new Error('Session insert failed');

  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role, plan: user.plan, sid: session.id },
    env.JWT_ACCESS_SECRET,
    env.ACCESS_TOKEN_TTL,
  );
  return { user, accessToken, refreshToken };
}

export async function register(
  env: Env,
  input: RegisterInput,
  meta: RequestMeta,
): Promise<{ user: User; devVerificationUrl?: string; session: AuthResult }> {
  const db = getDb();
  const settings = await getSettings(env);
  if (!settings.registrationsOpen) throw conflict('New registrations are temporarily closed.');

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) throw conflict('An account with this email already exists.');

  let referredBy: string | null = null;
  if (input.referralCode) {
    const [referrer] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, input.referralCode.toUpperCase()))
      .limit(1);
    if (referrer) referredBy = referrer.id;
  }

  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
      referralCode: randomReferralCode(),
      referredBy,
      emailVerified: false,
    })
    .returning();
  if (!user) throw new Error('User insert failed');

  await db.insert(userStats).values({ userId: user.id }).onConflictDoNothing();
  await createNotification({
    userId: user.id,
    type: 'system',
    title: 'Welcome to ExamDump Pro',
    body: 'Verify your email to unlock your personalised dashboard.',
    link: '/dashboard',
  });

  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId: user.id,
    type: 'email_verify',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const verifyUrl = `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
  // Queued, not sent inline: the row survives a restart and retries on its own,
  // so a transient SMTP failure cannot silently lose a signup verification.
  const delivery = await notifyVerification(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    verifyUrl,
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.register',
    targetType: 'user',
    targetId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  // Registering establishes a session straight away. Without this the account
  // existed but the browser held no cookies, so every protected route bounced
  // the new user back to /login until they signed in by hand.
  const session = await issueSession(user, env, meta);

  return {
    user,
    session,
    // Dev convenience only: surface the link when SMTP is not configured, since
    // there is no other way to verify. Production never leaks the token.
    devVerificationUrl: !mailConfigured(env) && env.NODE_ENV !== 'production' ? verifyUrl : undefined,
  };
}

async function assertNotLockedOut(email: string): Promise<void> {
  const db = getDb();
  const since = new Date(Date.now() - FAILED_WINDOW_MS);
  const [row] = await db
    .select({ value: count() })
    .from(loginAttempts)
    .where(
      and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)),
    );
  if (Number(row?.value ?? 0) >= MAX_FAILED_ATTEMPTS) {
    throw tooManyRequests('Too many failed sign-in attempts. Please try again in 15 minutes.');
  }
}

export async function login(env: Env, input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  const db = getDb();
  await assertNotLockedOut(input.email);

  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  const passwordOk = user ? await verifyPassword(input.password, user.passwordHash, env.PASSWORD_PEPPER) : false;

  if (!user || !passwordOk || user.suspended || user.deletedAt) {
    await db.insert(loginAttempts).values({ email: input.email, ip: meta.ip ?? '', success: false });
    await recordAudit({
      actorEmail: input.email,
      action: 'user.login_failed',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw unauthorized('Invalid email or password.');
  }

  await db.insert(loginAttempts).values({ email: input.email, ip: meta.ip ?? '', success: true });
  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));

  // Security alert. Fire-and-forget: a mail problem must never block a login,
  // and it is deduped per hour so repeated logins do not flood the inbox.
  await notifyLoginAlert(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    when: new Date(),
    ip: meta.ip,
    device: meta.userAgent?.slice(0, 120),
  }).catch(() => undefined);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.login',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return issueSession(user, env, meta);
}

export async function refreshSession(env: Env, refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hashToken(refreshToken)))
    .limit(1);
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.suspended || user.deletedAt) {
    throw unauthorized('This account is no longer available.');
  }

  const newRefreshToken = randomToken(48);
  await db
    .update(sessions)
    .set({
      refreshTokenHash: hashToken(newRefreshToken),
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      userAgent: meta.userAgent ?? session.userAgent,
      ip: meta.ip ?? session.ip,
    })
    .where(eq(sessions.id, session.id));

  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role, plan: user.plan, sid: session.id },
    env.JWT_ACCESS_SECRET,
    env.ACCESS_TOKEN_TTL,
  );

  return { user, accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
  const db = getDb();
  if (refreshToken) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.refreshTokenHash, hashToken(refreshToken)), isNull(sessions.revokedAt)));
  } else if (sessionId) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function grantPremiumDays(userId: string, days: number, source: 'referral' | 'admin' | 'promo' = 'referral') {
  const db = getDb();
  await db.insert(accessGrants).values({
    userId,
    scope: 'all',
    source,
    note: `Granted ${days} days of full access`,
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  });
  await recomputeUserPlan(userId);
}

export async function verifyEmail(env: Env, token: string, meta: RequestMeta): Promise<User> {
  const db = getDb();
  const [record] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.type, 'email_verify'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!record) throw unauthorized('This verification link is invalid or has expired.');

  const [user] = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  if (!user) throw unauthorized('Account not found.');

  await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, user.id));
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, record.id));

  if (user.referredBy) {
    const [existingRef] = await db.select({ id: referrals.id }).from(referrals).where(eq(referrals.refereeId, user.id)).limit(1);
    if (!existingRef) {
      const [referrer] = await db.select().from(users).where(eq(users.id, user.referredBy)).limit(1);
      if (referrer) {
        await db.insert(referrals).values({
          referrerId: referrer.id,
          refereeId: user.id,
          code: referrer.referralCode,
          status: 'completed',
          rewardDays: REFERRER_REWARD_DAYS,
        });
        await grantPremiumDays(referrer.id, REFERRER_REWARD_DAYS, 'referral');
        await grantPremiumDays(user.id, REFEREE_REWARD_DAYS, 'referral');
        await createNotification({
          userId: referrer.id,
          type: 'achievement',
          title: 'Referral reward unlocked',
          body: `${user.name} joined with your code. You earned ${REFERRER_REWARD_DAYS} days of full access.`,
        });
      }
    }
  }

  await createNotification({
    userId: user.id,
    type: 'system',
    title: 'Email verified',
    body: 'Your account is fully activated. Start practising now!',
    link: '/browse',
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.email_verified',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  // Welcome mail is fire-and-forget: it must never fail verification, which has
  // already been committed above.
  await notifyWelcome(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    examsUrl: `${env.PUBLIC_WEB_URL}/exams`,
  }).catch(() => undefined);

  const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  return fresh!;
}

export async function resendVerification(env: Env, email: string, meta: RequestMeta): Promise<{ devVerificationUrl?: string }> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.emailVerified) return {};

  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId: user.id,
    type: 'email_verify',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const verifyUrl = `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
  // Queued, not sent inline: the row survives a restart and retries on its own,
  // so a transient SMTP failure cannot silently lose a signup verification.
  const delivery = await notifyVerification(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    verifyUrl,
  });
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.verification_resent',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  // Dev convenience only: surface the link when nothing could be queued
  // (no SMTP configured). Production never leaks the token.
  return !mailConfigured(env) && env.NODE_ENV !== 'production' ? { devVerificationUrl: verifyUrl } : {};
}

export async function forgotPassword(env: Env, email: string, meta: RequestMeta): Promise<{ devResetUrl?: string }> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.deletedAt) return {};

  await db
    .delete(authTokens)
    .where(and(eq(authTokens.userId, user.id), eq(authTokens.type, 'password_reset'), isNull(authTokens.usedAt)));
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId: user.id,
    type: 'password_reset',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const resetUrl = `${env.PUBLIC_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const delivery = await notifyPasswordReset(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    resetUrl,
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.password_reset_requested',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return !mailConfigured(env) && env.NODE_ENV !== 'production' ? { devResetUrl: resetUrl } : {};
}

export async function resetPassword(env: Env, token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const [record] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.type, 'password_reset'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!record) throw unauthorized('This reset link is invalid or has expired.');

  const [user] = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  if (!user) throw unauthorized('Account not found.');

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, record.id));
  await revokeAllSessions(user.id);

  await notifyPasswordChanged(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    when: new Date(),
  }).catch(() => undefined);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.password_reset',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function changePassword(
  env: Env,
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw unauthorized('Account not found.');
  const ok = await verifyPassword(currentPassword, user.passwordHash, env.PASSWORD_PEPPER);
  if (!ok) throw unauthorized('Your current password is incorrect.');

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId);

  await notifyPasswordChanged(env, {
    to: user.email,
    userId: user.id,
    name: user.name,
    when: new Date(),
  }).catch(() => undefined);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.password_reset',
    metadata: { kind: 'change_password' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

const googleClient = new OAuth2Client();

export async function googleLogin(env: Env, idToken: string, meta: RequestMeta): Promise<AuthResult> {
  if (!env.GOOGLE_CLIENT_ID) throw serviceUnavailable('Google sign-in is not configured on this server.');
  const db = getDb();

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized('Google sign-in could not be verified.');
  }

  const email = payload?.email?.toLowerCase();
  const googleId = payload?.sub;
  if (!email || !googleId || !payload?.email_verified) {
    throw unauthorized('Your Google account email is not verified.');
  }

  let [user] = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  if (!user) [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: payload.name || email.split('@')[0]!,
        googleId,
        emailVerified: true,
        avatarUrl: payload.picture ?? '',
        referralCode: randomReferralCode(),
      })
      .returning();
    user = created!;
    await db.insert(userStats).values({ userId: user.id }).onConflictDoNothing();
    await createNotification({
      userId: user.id,
      type: 'system',
      title: 'Welcome to ExamDump Pro',
      body: 'Your Google account is connected and ready.',
      link: '/dashboard',
    });
  } else {
    if (user.suspended) throw unauthorized('This account is suspended.');
    await db
      .update(users)
      .set({
        googleId: user.googleId ?? googleId,
        emailVerified: true,
        avatarUrl: user.avatarUrl || payload.picture || '',
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    user = fresh!;
  }

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.login',
    metadata: { provider: 'google' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return issueSession(user, env, meta);
}

export async function listSessions(userId: string, currentSessionId?: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));
  return rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent ?? '',
    ip: s.ip ?? '',
    current: s.id === currentSessionId,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export function newCorrelationId(): string {
  return randomUUID();
}
