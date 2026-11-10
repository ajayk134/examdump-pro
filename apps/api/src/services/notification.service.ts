import type { Types } from 'mongoose';
import type { NotificationType } from '@examdump/shared';
import { Notification } from '../db/models/index.js';

export interface CreateNotificationInput {
  userId: Types.ObjectId | string;
  type?: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await Notification.create({
    userId: input.userId,
    type: input.type ?? 'system',
    title: input.title,
    body: input.body ?? '',
    link: input.link ?? null,
  });
}

export async function listNotifications(userId: string, limit = 30, unreadOnly = false) {
  const query: Record<string, unknown> = { userId };
  if (unreadOnly) query.read = false;
  const [items, unread] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ userId, read: false }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const query: Record<string, unknown> = { userId, read: false };
  if (ids && ids.length > 0) query._id = { $in: ids };
  const result = await Notification.updateMany(query, { $set: { read: true, readAt: new Date() } });
  return result.modifiedCount;
}