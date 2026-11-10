import mongoose, { Schema, type Model, type Types } from 'mongoose';
import { PLANS, ROLES, type Plan, type Role } from '@examdump/shared';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  emailNotifications: boolean;
  productUpdates: boolean;
  weeklyReport: boolean;
}

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash?: string | null;
  googleId?: string | null;
  role: Role;
  plan: Plan;
  emailVerified: boolean;
  avatarUrl?: string;
  bio?: string;
  timezone?: string;
  preferences: UserPreferences;
  referralCode: string;
  referredBy?: Types.ObjectId | null;
  suspended: boolean;
  premiumUntil?: Date | null;
  lastLoginAt?: Date | null;
  passwordChangedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, default: null, select: false },
    googleId: { type: String },
    role: { type: String, enum: ROLES, default: 'user', index: true },
    plan: { type: String, enum: PLANS, default: 'free', index: true },
    emailVerified: { type: Boolean, default: false, index: true },
    avatarUrl: { type: String, default: '' },
    bio: { type: String, default: '', maxlength: 500 },
    timezone: { type: String, default: 'UTC' },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      emailNotifications: { type: Boolean, default: true },
      productUpdates: { type: Boolean, default: false },
      weeklyReport: { type: Boolean, default: true },
    },
    referralCode: { type: String, required: true, unique: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    suspended: { type: Boolean, default: false, index: true },
    premiumUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
);
userSchema.index({ createdAt: -1 });

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model<UserDoc>('User', userSchema);