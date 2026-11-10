import type { UserDoc } from '../db/models/index.js';
import { isPremiumActive } from '../services/entitlement.service.js';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  premiumActive: boolean;
  premiumUntil: string | null;
  emailVerified: boolean;
  avatarUrl: string;
  bio: string;
  timezone: string;
  preferences: UserDoc['preferences'];
  referralCode: string;
  suspended: boolean;
  createdAt: string;
}

export function serializeUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    plan: user.plan,
    premiumActive: isPremiumActive(user),
    premiumUntil: user.premiumUntil ? user.premiumUntil.toISOString() : null,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl ?? '',
    bio: user.bio ?? '',
    timezone: user.timezone ?? 'UTC',
    preferences: user.preferences,
    referralCode: user.referralCode,
    suspended: user.suspended,
    createdAt: user.createdAt.toISOString(),
  };
}