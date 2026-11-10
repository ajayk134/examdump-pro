import type { Types } from 'mongoose';
import { AuditLog } from '../db/models/index.js';

export interface AuditInput {
  actorId?: Types.ObjectId | string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      ip: input.ip ?? '',
      userAgent: input.userAgent ?? '',
      metadata: input.metadata ?? {},
    });
  } catch {
    // Audit failures must never break the primary request path.
  }
}