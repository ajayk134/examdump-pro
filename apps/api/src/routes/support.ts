/**
 * Support centre + public announcements.
 *
 * A ticket can be opened by signed-in users (linked to their account) or by
 * anyone via the contact form (email only). Replies are threaded and support
 * internal staff notes.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { supportTicketCreateSchema, supportTicketReplySchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { optionalAuth, requireAuth, requirePermission } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { announcements, supportTickets, ticketMessages } from '../db/schema/index.js';
import { notifySupportReceived } from '../services/mail/notify.service.js';
import { createNotification } from '../services/notification.service.js';
import { recordAudit } from '../services/audit.service.js';

function reference(): string {
  return `ED-${Date.now().toString(36).toUpperCase().slice(-5)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export async function supportRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /** Active announcements for the current audience. */
  app.get('/announcements', async (request, reply) => {
    const auth = await optionalAuth(request, env);
    const now = new Date();
    const audience = auth?.user.role === 'admin' ? ['all', 'users', 'admins'] : ['all', 'users'];
    const rows = await getDb()
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.active, true),
          lte(announcements.startsAt, now),
          or(isNull(announcements.expiresAt), gte(announcements.expiresAt, now)),
          or(
            eq(announcements.audience, audience[0]!),
            eq(announcements.audience, audience[1]!),
            ...(audience[2] ? [eq(announcements.audience, audience[2])] : []),
          ),
        ),
      )
      .orderBy(desc(announcements.startsAt))
      .limit(10);
    return reply.send({ announcements: rows });
  });

  app.post('/tickets', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const auth = await optionalAuth(request, env);
    const input = parseOrThrow(supportTicketCreateSchema, request.body);
    const email = auth?.user.email ?? input.email;
    if (!email) throw badRequest('Provide a contact email or sign in.');

    const db = getDb();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        reference: reference(),
        userId: auth?.user.id ?? null,
        email,
        subject: input.subject,
        category: input.category,
        priority: input.category === 'refund' || input.category === 'payments' ? 'high' : 'normal',
      })
      .returning();
    if (!ticket) throw new Error('Failed to create the ticket.');

    await db.insert(ticketMessages).values({
      ticketId: ticket.id,
      authorId: auth?.user.id ?? null,
      authorRole: auth?.user.role === 'admin' ? 'admin' : 'user',
      body: input.message,
    });

    if (auth) {
      await createNotification({
        userId: auth.user.id,
        type: 'system',
        title: `Support request ${ticket.reference} received`,
        body: 'Our team will reply within one business day.',
        link: '/support',
      });
    }

    // Acknowledgement email. Best-effort: the ticket already exists, so a mail
    // problem must not turn a successful submission into an error.
    await notifySupportReceived(env, {
      to: email,
      userId: auth?.user.id,
      name: auth?.user.name,
      reference: ticket.reference,
      subject: ticket.subject,
      message: input.message,
    }).catch(() => undefined);
    await recordAudit({
      actorId: auth?.user.id ?? null,
      actorEmail: email,
      action: 'ticket.created',
      targetType: 'ticket',
      targetId: ticket.id,
      metadata: { category: input.category },
    });

    return reply.code(201).send({ ticket });
  });

  app.get('/tickets', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const db = getDb();
    const tickets = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, user.id))
      .orderBy(desc(supportTickets.createdAt));
    return reply.send({ tickets });
  });

  app.get('/tickets/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const db = getDb();
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
    if (!ticket) throw notFound('Ticket not found.');
    if (ticket.userId !== user.id && user.role !== 'admin') throw forbidden('You cannot view this ticket.');
    const messages = await db
      .select()
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, id), user.role === 'admin' ? undefined : eq(ticketMessages.internal, false)))
      .orderBy(asc(ticketMessages.createdAt));
    return reply.send({ ticket, messages });
  });

  app.post('/tickets/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const input = parseOrThrow(supportTicketReplySchema, request.body);
    const db = getDb();
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
    if (!ticket) throw notFound('Ticket not found.');
    const isStaff = user.role === 'admin';
    if (ticket.userId !== user.id && !isStaff) throw forbidden('You cannot reply to this ticket.');
    if (input.internal && !isStaff) throw forbidden('Internal notes are staff only.');
    if (['closed'].includes(ticket.status) && !isStaff) throw badRequest('This ticket is closed. Open a new one.');

    const [message] = await db
      .insert(ticketMessages)
      .values({
        ticketId: id,
        authorId: user.id,
        authorRole: isStaff ? 'staff' : 'user',
        body: input.message,
        internal: input.internal,
      })
      .returning();

    await db
      .update(supportTickets)
      .set({
        status: isStaff ? 'pending' : 'open',
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, id));

    if (isStaff && ticket.userId && !input.internal) {
      await createNotification({
        userId: ticket.userId,
        type: 'system',
        title: `Support replied to ${ticket.reference}`,
        body: input.message.slice(0, 160),
        link: '/support',
      });
    }
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'ticket.replied',
      targetType: 'ticket',
      targetId: id,
      metadata: { internal: input.internal },
    });
    return reply.code(201).send({ message });
  });

  /** Staff: list every ticket (also exposed under /admin-ops). */
  app.get('/admin/tickets', async (request, reply) => {
    await requirePermission(request, env, 'users.read');
    const rows = await getDb().select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(200);
    return reply.send({ tickets: rows });
  });
}
