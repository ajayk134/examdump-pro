import type { HydratedDocument, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { LoginInput, RegisterInput } from '@examdump/shared';
import type { Env } from '../config/env.js';
import {
  AuthToken,
  LoginAttempt,
  Referral,
  Session,
  User,
  UserStats,
  type UserDoc,
} from '../db/models/index.js';
import { conflict, serviceUnavailable, tooManyRequests, unauthorized } from '../lib/errors.js';
import { signAccessToken } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { hashToken, randomReferralCode, randomToken } from '../lib/tokens.js';
import { buildActionEmail, sendEmail } from '../lib/email.js';
import { isPremiumActive } from './entitlement.service.js';
import { getSettings } from './settings.service.js';
import { createNotification } from './notification.service.js';
import { recordAudit } from './audit.service.js';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthResult {
  user: UserDoc;
  accessToken: string;
  refreshToken: string;
}

const MAX_FAILED_ATTEMPTS = 10;
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const REFERRER_REWARD_DAYS = 7;
const REFEREE_REWARD_DAYS = 3;

function effectivePlan(user: UserDoc): 'free' | 'premium' {
  return isPremiumActive(user) ? 'premium' : 'free';
}

async function issueSession(user: UserDoc, env: Env, meta: RequestMeta): Promise<AuthResult> {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const session = await Session.create({
    userId: user._id,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: meta.userAgent ?? '',
    ip: meta.ip ?? '',
    expiresAt,
    lastUsedAt: new Date(),
  });
  const accessToken = await signAccessToken(
    { sub: user._id.toString(), role: user.role, plan: effectivePlan(user), sid: session._id.toString() },
    env.JWT_ACCESS_SECRET,
    env.ACCESS_TOKEN_TTL,
  );
  return { user, accessToken, refreshToken };
}

export async function register(
  env: Env,
  input: RegisterInput,
  meta: RequestMeta,
): Promise<{ user: UserDoc; devVerificationUrl?: string }> {
  const settings = await getSettings(env);
  if (!settings.registrationsOpen) {
    throw conflict('New registrations are temporarily closed.');
  }

  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw conflict('An account with this email already exists.');
  }

  let referredBy: Types.ObjectId | null = null;
  if (input.referralCode) {
    const referrer = await User.findOne({ referralCode: input.referralCode.toUpperCase() });
    if (referrer) referredBy = referrer._id;
  }

  const user = await User.create({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
    referralCode: randomReferralCode(),
    referredBy,
    emailVerified: false,
  });

  await UserStats.create({ userId: user._id });
  await createNotification({
    userId: user._id,
    type: 'system',
    title: 'Welcome to ExamDump Pro',
    body: 'Verify your email to unlock your personalised dashboard.',
    link: '/dashboard',
  });

  const token = randomToken(32);
  await AuthToken.create({
    userId: user._id,
    type: 'email_verify',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const verifyUrl = `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const email = buildActionEmail(env, {
    title: 'Verify your email',
    intro: `Hi ${user.name}, confirm your email address to activate your ExamDump Pro account.`,
    actionLabel: 'Verify email',
    actionUrl: verifyUrl,
  });
  const delivery = await sendEmail(
    env,
    { to: user.email, subject: 'Verify your ExamDump Pro email', ...email },
    undefined,
  );

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.register',
    targetType: 'user',
    targetId: user._id.toString(),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    user,
    devVerificationUrl: !delivery.delivered && env.NODE_ENV !== 'production' ? verifyUrl : undefined,
  };
}

async function assertNotLockedOut(email: string): Promise<void> {
  const since = new Date(Date.now() - FAILED_WINDOW_MS);
  const failures = await LoginAttempt.countDocuments({ email, success: false, createdAt: { $gte: since } });
  if (failures >= MAX_FAILED_ATTEMPTS) {
    throw tooManyRequests('Too many failed sign-in attempts. Please try again in 15 minutes.');
  }
}

export async function login(env: Env, input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  await assertNotLockedOut(input.email);

  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const passwordOk = user ? await verifyPassword(input.password, user.passwordHash, env.PASSWORD_PEPPER) : false;

  if (!user || !passwordOk || user.suspended || user.deletedAt) {
    await LoginAttempt.create({ email: input.email, ip: meta.ip ?? '', success: false });
    await recordAudit({
      actorEmail: input.email,
      action: 'user.login_failed',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw unauthorized('Invalid email or password.');
  }

  await LoginAttempt.create({ email: input.email, ip: meta.ip ?? '', success: true });
  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.login',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return issueSession(user, env, meta);
}

export async function refreshSession(
  env: Env,
  refreshToken: string,
  meta: RequestMeta,
): Promise<AuthResult> {
  const session = await Session.findOne({ refreshTokenHash: hashToken(refreshToken) });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const user = await User.findById(session.userId);
  if (!user || user.suspended || user.deletedAt) {
    throw unauthorized('This account is no longer available.');
  }

  // Rotate the opaque refresh token on every use.
  const newRefreshToken = randomToken(48);
  session.refreshTokenHash = hashToken(newRefreshToken);
  session.lastUsedAt = new Date();
  session.expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  session.userAgent = meta.userAgent ?? session.userAgent;
  session.ip = meta.ip ?? session.ip;
  await session.save();

  const accessToken = await signAccessToken(
    { sub: user._id.toString(), role: user.role, plan: effectivePlan(user), sid: session._id.toString() },
    env.JWT_ACCESS_SECRET,
    env.ACCESS_TOKEN_TTL,
  );

  return { user, accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
  if (refreshToken) {
    await Session.updateOne(
      { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  } else if (sessionId) {
    await Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function verifyEmail(env: Env, token: string, meta: RequestMeta): Promise<UserDoc> {
  const record = await AuthToken.findOne({
    tokenHash: hashToken(token),
    type: 'email_verify',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) throw unauthorized('This verification link is invalid or has expired.');

  const user = await User.findById(record.userId);
  if (!user) throw unauthorized('Account not found.');

  user.emailVerified = true;
  await user.save();
  record.usedAt = new Date();
  await record.save();

  // Complete referral rewards exactly once, on verified signup.
  if (user.referredBy) {
    const existing = await Referral.findOne({ refereeId: user._id });
    if (!existing) {
      const referrer = await User.findById(user.referredBy);
      if (referrer) {
        await Referral.create({
          referrerId: referrer._id,
          refereeId: user._id,
          code: referrer.referralCode,
          status: 'completed',
          rewardDays: REFERRER_REWARD_DAYS,
        });
        await grantPremiumDays(referrer, REFERRER_REWARD_DAYS);
        await grantPremiumDays(user, REFEREE_REWARD_DAYS);
        await createNotification({
          userId: referrer._id,
          type: 'achievement',
          title: 'Referral reward unlocked',
          body: `${user.name} joined with your code. You earned ${REFERRER_REWARD_DAYS} days of Premium.`,
        });
      }
    }
  }

  await createNotification({
    userId: user._id,
    type: 'system',
    title: 'Email verified',
    body: 'Your account is fully activated. Start practising now!',
    link: '/browse',
  });

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.email_verified',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return user;
}

export async function grantPremiumDays(user: HydratedDocument<UserDoc>, days: number): Promise<void> {
  const base =
    user.premiumUntil && user.premiumUntil.getTime() > Date.now() ? user.premiumUntil : new Date();
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  user.plan = 'premium';
  user.premiumUntil = next;
  await user.save();
}

export async function resendVerification(env: Env, email: string, meta: RequestMeta): Promise<{ devVerificationUrl?: string }> {
  const user = await User.findOne({ email });
  if (!user || user.emailVerified) {
    // Do not reveal whether an account exists.
    return {};
  }
  const token = randomToken(32);
  await AuthToken.create({
    userId: user._id,
    type: 'email_verify',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const verifyUrl = `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const emailBody = buildActionEmail(env, {
    title: 'Verify your email',
    intro: 'Here is a fresh verification link for your ExamDump Pro account.',
    actionLabel: 'Verify email',
    actionUrl: verifyUrl,
  });
  const delivery = await sendEmail(env, { to: user.email, subject: 'Verify your ExamDump Pro email', ...emailBody });
  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.verification_resent',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return !delivery.delivered && env.NODE_ENV !== 'production' ? { devVerificationUrl: verifyUrl } : {};
}

export async function forgotPassword(env: Env, email: string, meta: RequestMeta): Promise<{ devResetUrl?: string }> {
  const user = await User.findOne({ email });
  if (!user || user.deletedAt) return {};

  await AuthToken.deleteMany({ userId: user._id, type: 'password_reset', usedAt: null });
  const token = randomToken(32);
  await AuthToken.create({
    userId: user._id,
    type: 'password_reset',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const resetUrl = `${env.PUBLIC_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const emailBody = buildActionEmail(env, {
    title: 'Reset your password',
    intro: 'We received a request to reset your ExamDump Pro password. This link expires in 1 hour.',
    actionLabel: 'Reset password',
    actionUrl: resetUrl,
  });
  const delivery = await sendEmail(env, { to: user.email, subject: 'Reset your ExamDump Pro password', ...emailBody });

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.password_reset_requested',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return !delivery.delivered && env.NODE_ENV !== 'production' ? { devResetUrl: resetUrl } : {};
}

export async function resetPassword(env: Env, token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const record = await AuthToken.findOne({
    tokenHash: hashToken(token),
    type: 'password_reset',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) throw unauthorized('This reset link is invalid or has expired.');

  const user = await User.findById(record.userId);
  if (!user) throw unauthorized('Account not found.');

  user.passwordHash = await hashPassword(newPassword, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS);
  user.passwordChangedAt = new Date();
  await user.save();

  record.usedAt = new Date();
  await record.save();
  await revokeAllSessions(user._id.toString());

  await recordAudit({
    actorId: user._id,
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
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw unauthorized('Account not found.');
  const ok = await verifyPassword(currentPassword, user.passwordHash, env.PASSWORD_PEPPER);
  if (!ok) throw unauthorized('Your current password is incorrect.');

  user.passwordHash = await hashPassword(newPassword, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(userId);

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.password_reset',
    metadata: { kind: 'change_password' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

const googleClient = new OAuth2Client();

export async function googleLogin(
  env: Env,
  idToken: string,
  meta: RequestMeta,
): Promise<AuthResult> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw serviceUnavailable('Google sign-in is not configured on this server.');
  }

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

  let user = await User.findOne({ $or: [{ googleId }, { email }] });
  if (!user) {
    user = await User.create({
      email,
      name: payload.name || email.split('@')[0],
      googleId,
      emailVerified: true,
      avatarUrl: payload.picture ?? '',
      referralCode: randomReferralCode(),
    });
    await UserStats.create({ userId: user._id });
    await createNotification({
      userId: user._id,
      type: 'system',
      title: 'Welcome to ExamDump Pro',
      body: 'Your Google account is connected and ready.',
      link: '/dashboard',
    });
  } else {
    if (user.suspended) throw unauthorized('This account is suspended.');
    if (!user.googleId) user.googleId = googleId;
    if (!user.emailVerified) user.emailVerified = true;
    if (!user.avatarUrl && payload.picture) user.avatarUrl = payload.picture;
    user.lastLoginAt = new Date();
    await user.save();
  }

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'user.login',
    metadata: { provider: 'google' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return issueSession(user, env, meta);
}

export async function listSessions(userId: string, currentSessionId?: string) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  return sessions.map((s) => ({
    id: s._id.toString(),
    userAgent: s.userAgent ?? '',
    ip: s.ip ?? '',
    current: s._id.toString() === currentSessionId,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await Session.updateOne(
    { _id: sessionId, userId },
    { $set: { revokedAt: new Date() } },
  );
}

export function newCorrelationId(): string {
  return randomUUID();
}