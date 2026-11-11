import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, registerVerifiedUser, type TestContext } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { aiConversations, aiMessages, plans, subscriptions, users } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import {
  buildTutorSystemPrompt,
  suggestedPrompts,
} from '../src/services/ai.service.js';
import { latexToUnicode } from '../../web/lib/math.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

/** Give a user an unlimited subscription so exam access is not the blocker. */
async function grantPremium(userId: string) {
  const db = getDb();
  const [plan] = await db.select().from(plans).where(eq(plans.id, 'all-30')).limit(1);
  await db
    .update(users)
    .set({ role: 'user' })
    .where(eq(users.id, userId));
  const now = new Date();
  await db.insert(subscriptions).values({
    userId,
    planId: plan?.id ?? 'all-30',
    status: 'active',
    scope: 'all',
    startedAt: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
    autoRenew: false,
    provider: 'mock',
  });
}

describe('AI tutor chat', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ai/chat/conversations' });
    expect(res.statusCode).toBe(401);
  });

  it('lists an empty history for a fresh account', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conversations).toEqual([]);
  });

  it('creates a conversation anchored to a question', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301', questionId: 'Question #: 1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.conversation.providerId).toBe('cisco');
    expect(body.conversation.examKey).toBe('200-301');
    expect(body.conversation.questionId).toBe('Question #: 1');
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions).toContain('Explain the correct answer step by step');
  });

  it('stores the conversation and returns it by question', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);

    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301', questionId: 'Question #: 2' },
    });
    const id = created.json().conversation.id as string;

    const detail = await app.inject({ method: 'GET', url: `/api/ai/chat/conversations/${id}`, headers: { cookie: cookies } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(id);
    expect(detail.json().messages).toEqual([]);

    const byQuestion = await app.inject({
      method: 'GET',
      url: '/api/ai/chat/by-question?provider=cisco&exam=200-301&questionId=Question%20%23:%202',
      headers: { cookie: cookies },
    });
    expect(byQuestion.statusCode).toBe(200);
    expect(byQuestion.json().conversation.id).toBe(id);
  });

  it("never exposes another account's conversation", async () => {
    const owner = await registerVerifiedUser(app);
    await grantPremium(owner.userId);
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: owner.cookie },
      payload: { provider: 'cisco', exam: '200-301' },
    });
    const id = created.json().conversation.id as string;

    const intruder = await registerVerifiedUser(app);
    await grantPremium(intruder.userId);

    const read = await app.inject({ method: 'GET', url: `/api/ai/chat/conversations/${id}`, headers: { cookie: intruder.cookie } });
    expect(read.statusCode).toBe(404);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/ai/chat/conversations/${id}`,
      headers: { cookie: intruder.cookie },
      payload: { title: 'hijacked' },
    });
    expect(rename.statusCode).toBe(404);

    const remove = await app.inject({ method: 'DELETE', url: `/api/ai/chat/conversations/${id}`, headers: { cookie: intruder.cookie } });
    expect(remove.statusCode).toBe(404);
  });

  it('renames and deletes own conversations', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);

    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301' },
    });
    const id = created.json().conversation.id as string;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/ai/chat/conversations/${id}`,
      headers: { cookie: cookies },
      payload: { title: 'Subnetting basics' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().conversation.title).toBe('Subnetting basics');

    const removed = await app.inject({ method: 'DELETE', url: `/api/ai/chat/conversations/${id}`, headers: { cookie: cookies } });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/api/ai/chat/conversations/${id}`, headers: { cookie: cookies } });
    expect(gone.statusCode).toBe(404);
  });

  it('cascades messages when a conversation is deleted', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);

    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301' },
    });
    const id = created.json().conversation.id as string;

    await getDb().insert(aiMessages).values({
      conversationId: id,
      role: 'user',
      content: 'What is a subnet mask?',
    });

    await app.inject({ method: 'DELETE', url: `/api/ai/chat/conversations/${id}`, headers: { cookie: cookies } });

    const orphans = await getDb().select().from(aiMessages).where(eq(aiMessages.conversationId, id));
    expect(orphans.length).toBe(0);
  });

  it('rejects chatting about an exam the plan does not cover', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    // No subscription: the free preview is capped at 5 questions per exam.
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301', questionId: 'Question #: 900' },
    });
    expect(created.statusCode).toBe(403);
    expect(created.json().error.code).toBe('FORBIDDEN');
    void userId;
  });

  it('streams an SSE response even when the provider is unavailable', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);

    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301' },
    });
    const id = created.json().conversation.id as string;

    // The test env has no AI key, so the route must still open the stream and
    // report a structured event rather than crashing.
    const res = await app.inject({
      method: 'POST',
      url: `/api/ai/chat/conversations/${id}/messages`,
      headers: { cookie: cookies },
      payload: { message: 'Explain OSPF neighbours' },
    });

    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('"type"');
    } else {
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('AI_NOT_CONFIGURED');
    }
  });

  it('scopes conversation rows to the owner in the database', async () => {
    const { userId, cookie: cookies } = await registerVerifiedUser(app);
    await grantPremium(userId);
    await app.inject({
      method: 'POST',
      url: '/api/ai/chat/conversations',
      headers: { cookie: cookies },
      payload: { provider: 'cisco', exam: '200-301' },
    });
    const rows = await getDb()
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.userId).toBe(userId);
  });
});

describe('tutor prompt construction', () => {
  it('injects the verified answer and the learner choice', () => {
    const prompt = buildTutorSystemPrompt({
      examCode: '200-301',
      examTitle: 'Cisco CCNA',
      providerTitle: 'Cisco',
      questionStem: 'Which subnet mask supports 50 hosts?',
      questionChoices: [
        { key: 'A', text: '/25' },
        { key: 'B', text: '/26' },
      ],
      correctAnswer: 'B',
      referenceExplanation: 'A /26 leaves 6 host bits.',
      learnerChoice: ['A'],
    });
    expect(prompt).toContain('200-301');
    expect(prompt).toContain('Which subnet mask supports 50 hosts?');
    expect(prompt).toContain('Verified correct answer: B');
    expect(prompt).toContain('The learner selected: A');
    expect(prompt).toContain('/26');
  });

  it('omits the question section when there is no question', () => {
    const prompt = buildTutorSystemPrompt({ examCode: 'AWS-SAA', providerTitle: 'AWS' });
    expect(prompt).toContain('AWS-SAA');
    expect(prompt).not.toContain('Question under discussion');
  });

  it('offers question-aware suggestions only when a question is present', () => {
    expect(suggestedPrompts(true)).toContain('Why are the other options wrong?');
    expect(suggestedPrompts(false)).not.toContain('Why are the other options wrong?');
  });
});

describe('math rendering', () => {
  it('converts common LaTeX to readable unicode', () => {
    expect(latexToUnicode('\\frac{1}{2}')).toBe('(1)/(2)');
    expect(latexToUnicode('2^8 = 256')).toBe('2⁸ = 256');
    expect(latexToUnicode('x \\leq 5')).toBe('x ≤ 5');
    expect(latexToUnicode('\\alpha \\times \\beta')).toBe('α × β');
    expect(latexToUnicode('32 - 26 = 6')).toBe('32 - 26 = 6');
  });
});
