import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { NotificationType } from '@examdump/shared';
import { getDb } from '../db/client.js';
import { notifications } from '../db/schema/index.js';

export interface CreateNotificationInput {
  userId: string;
  type?: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const db = getDb();
  await db.insert(notifications).values({
    userId: input.userId,
    type: input.type ?? 'system',
    title: input.title,
    body: input.body ?? '',
    link: input.link ?? null,
  });
}

export async function listNotifications(userId: string, limit = 30, unreadOnly = false) {
  const db = getDb();
  const items = await db
    .select()
    .from(notifications)
    .where(unreadOnly ? and(eq(notifications.userId, userId), eq(notifications.read, false)) : eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const unreadRows = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return { items, unread: Number(unreadRows[0]?.value ?? 0) };
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const db = getDb();
  const where =
    ids && ids.length > 0
      ? and(eq(notifications.userId, userId), eq(notifications.read, false), inArray(notifications.id, ids))
      : and(eq(notifications.userId, userId), eq(notifications.read, false));
  const updated = await db
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(where)
    .returning({ id: notifications.id });
  return updated.length;
}
