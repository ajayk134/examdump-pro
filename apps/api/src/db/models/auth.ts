import mongoose, { Schema, type Model, type Types } from 'mongoose';

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  refreshTokenHash: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  lastUsedAt: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL: automatically remove expired sessions.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1, revokedAt: 1 });

export const Session: Model<SessionDoc> =
  (mongoose.models.Session as Model<SessionDoc>) ?? mongoose.model<SessionDoc>('Session', sessionSchema);

export type AuthTokenType = 'email_verify' | 'password_reset';

export interface AuthTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

const authTokenSchema = new Schema<AuthTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['email_verify', 'password_reset'], required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken: Model<AuthTokenDoc> =
  (mongoose.models.AuthToken as Model<AuthTokenDoc>) ??
  mongoose.model<AuthTokenDoc>('AuthToken', authTokenSchema);

export interface LoginAttemptDoc {
  _id: Types.ObjectId;
  email: string;
  ip: string;
  success: boolean;
  createdAt: Date;
}

const loginAttemptSchema = new Schema<LoginAttemptDoc>(
  {
    email: { type: String, required: true, index: true },
    ip: { type: String, default: '', index: true },
    success: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

loginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const LoginAttempt: Model<LoginAttemptDoc> =
  (mongoose.models.LoginAttempt as Model<LoginAttemptDoc>) ??
  mongoose.model<LoginAttemptDoc>('LoginAttempt', loginAttemptSchema);