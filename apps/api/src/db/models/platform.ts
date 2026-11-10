import mongoose, { Schema, type Model, type Types } from 'mongoose';
import { AUDIT_ACTIONS, NOTIFICATION_TYPES, type AuditAction, type NotificationType } from '@examdump/shared';

export interface NotificationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  readAt?: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'system' },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: null },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const Notification: Model<NotificationDoc> =
  (mongoose.models.Notification as Model<NotificationDoc>) ??
  mongoose.model<NotificationDoc>('Notification', notificationSchema);

export interface AuditLogDoc {
  _id: Types.ObjectId;
  actorId?: Types.ObjectId | null;
  actorEmail?: string | null;
  action: AuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorEmail: { type: String, default: null },
    action: { type: String, required: true, index: true, enum: [...AUDIT_ACTIONS] },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog: Model<AuditLogDoc> =
  (mongoose.models.AuditLog as Model<AuditLogDoc>) ??
  mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);

export interface SettingsDoc {
  _id: Types.ObjectId;
  key: string;
  freeQuestionsPerExam: number;
  freeMockExamsPerDay: number;
  freeRandomQuestionsPerDay: number;
  premiumDailyQuestionLimit: number;
  maintenanceMode: boolean;
  registrationsOpen: boolean;
  announcement: string;
  updatedAt: Date;
}

const settingsSchema = new Schema<SettingsDoc>(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    freeQuestionsPerExam: { type: Number, default: 5 },
    freeMockExamsPerDay: { type: Number, default: 1 },
    freeRandomQuestionsPerDay: { type: Number, default: 20 },
    premiumDailyQuestionLimit: { type: Number, default: 0 },
    maintenanceMode: { type: Boolean, default: false },
    registrationsOpen: { type: Boolean, default: true },
    announcement: { type: String, default: '' },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ??
  mongoose.model<SettingsDoc>('Settings', settingsSchema);

export interface CatalogProviderDoc {
  _id: Types.ObjectId;
  providerId: string;
  file: string;
  title: string;
  slug: string;
  examCount: number;
  totalQuestions: number;
  syncedAt: Date;
}

const catalogProviderSchema = new Schema<CatalogProviderDoc>(
  {
    providerId: { type: String, required: true, unique: true, index: true },
    file: { type: String, required: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, index: true },
    examCount: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    syncedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

catalogProviderSchema.index({ title: 'text' });

export const CatalogProvider: Model<CatalogProviderDoc> =
  (mongoose.models.CatalogProvider as Model<CatalogProviderDoc>) ??
  mongoose.model<CatalogProviderDoc>('CatalogProvider', catalogProviderSchema);

export interface CatalogExamDoc {
  _id: Types.ObjectId;
  providerId: string;
  providerTitle: string;
  providerSlug: string;
  key: string;
  code: string;
  title: string;
  slug: string;
  questionCount: number;
  syncedAt: Date;
}

const catalogExamSchema = new Schema<CatalogExamDoc>(
  {
    providerId: { type: String, required: true, index: true },
    providerTitle: { type: String, required: true },
    providerSlug: { type: String, required: true, index: true },
    key: { type: String, required: true },
    code: { type: String, required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, index: true },
    questionCount: { type: Number, default: 0, index: true },
    syncedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

catalogExamSchema.index({ providerId: 1, key: 1 }, { unique: true });
catalogExamSchema.index({ title: 'text', code: 'text', providerTitle: 'text' });

export const CatalogExam: Model<CatalogExamDoc> =
  (mongoose.models.CatalogExam as Model<CatalogExamDoc>) ??
  mongoose.model<CatalogExamDoc>('CatalogExam', catalogExamSchema);