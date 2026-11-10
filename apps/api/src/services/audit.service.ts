import { getDb } from '../db/client.js';
import { auditLogs } from '../db/schema/index.js';

export interface AuditInput {
  actorId?: string | null;
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
    const db = getDb();
    await db.insert(auditLogs).values({
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
