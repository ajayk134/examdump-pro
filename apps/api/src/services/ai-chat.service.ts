/**
 * AI tutor conversations.
 *
 * Conversations are persisted per user so the learner can return to a doubt
 * later, and so the transcript survives a page reload. The question context is
 * rebuilt from the private dataset on every turn rather than being trusted from
 * the client — a caller can never inject a fake "correct answer".
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { aiConversations, aiMessages, users } from '../db/schema/index.js';
import type { Env } from '../config/env.js';
import type { User } from '../db/schema/index.js';
import { notFound } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';
import { assertWithinQuota, incrementUsage } from '../services/usage.service.js';
import {
  buildTutorSystemPrompt,
  suggestedPrompts,
  streamChat,
  type AiMessage,
  type StreamChunk,
  type TutorContext,
} from '../services/ai.service.js';

/** How many prior turns are replayed to the model. */
const HISTORY_TURNS = 12;
/** Hard cap on stored transcript length per conversation. */
const MAX_STORED_MESSAGES = 200;

export interface ConversationSummary {
  id: string;
  title: string;
  providerId: string | null;
  examKey: string | null;
  examTitle: string | null;
  questionId: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    model: string | null;
    degraded: boolean;
    createdAt: Date;
  }>;
  suggestions: string[];
}

function toSummary(row: typeof aiConversations.$inferSelect): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    providerId: row.providerId,
    examKey: row.examKey,
    examTitle: row.examTitle,
    questionId: row.questionId,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Load the grounded context for a conversation's anchored question. */
async function loadTutorContext(
  env: Env,
  input: { providerId: string; examKey: string; questionId?: string | null },
): Promise<TutorContext> {
  const { provider, exam } = await getDatasetClient(env).getExamQuestions(
    input.providerId,
    input.examKey,
  );
  const context: TutorContext = {
    examCode: exam.code,
    examTitle: exam.title,
    providerTitle: provider.title,
  };

  if (!input.questionId) return context;

  const { question } = await getDatasetClient(env).getQuestion(
    input.providerId,
    input.examKey,
    input.questionId,
  );
  context.questionStem = question.stemText;
  context.questionChoices = question.choices.map((c) => ({ key: c.key, text: c.text }));
  context.correctAnswer = question.answerText || question.answer || null;
  context.referenceExplanation = question.explanation || null;
  return context;
}

export async function createConversation(
  env: Env,
  user: User,
  input: { provider: string; exam: string; questionId?: string },
): Promise<{ conversation: ConversationSummary; suggestions: string[] }> {
  // The tutor is open to every signed-in account. Exam access no longer gates
  // doubt clearing; only per-account fair-use limits apply.
  const context = await loadTutorContext(env, {
    providerId: input.provider,
    examKey: input.exam,
    questionId: input.questionId,
  });

  const title = input.questionId
    ? `Question help · ${context.examCode ?? input.exam}`
    : `Study chat · ${context.examCode ?? input.exam}`;

  const [row] = await getDb()
    .insert(aiConversations)
    .values({
      userId: user.id,
      title,
      providerId: input.provider,
      examKey: input.exam,
      examTitle: context.examCode ?? null,
      questionId: input.questionId ?? null,
    })
    .returning();

  return {
    conversation: toSummary(row!),
    suggestions: suggestedPrompts(Boolean(input.questionId)),
  };
}

export async function listConversations(userId: string, limit = 30): Promise<ConversationSummary[]> {
  const rows = await getDb()
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
  return rows.map(toSummary);
}

/** Find the most recent conversation anchored to a question, if any. */
export async function findQuestionConversation(
  userId: string,
  providerId: string,
  examKey: string,
  questionId: string,
): Promise<ConversationSummary | null> {
  const [row] = await getDb()
    .select()
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.userId, userId),
        eq(aiConversations.providerId, providerId),
        eq(aiConversations.examKey, examKey),
        eq(aiConversations.questionId, questionId),
      ),
    )
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);
  return row ? toSummary(row) : null;
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Conversation not found.');

  const messages = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.createdAt))
    .limit(MAX_STORED_MESSAGES);

  return {
    ...toSummary(row),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      degraded: m.degraded,
      createdAt: m.createdAt,
    })),
    suggestions: suggestedPrompts(Boolean(row.questionId)),
  };
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string,
): Promise<ConversationSummary> {
  const [row] = await getDb()
    .update(aiConversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
    .returning();
  if (!row) throw notFound('Conversation not found.');
  return toSummary(row);
}

export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  const rows = await getDb()
    .delete(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
    .returning({ id: aiConversations.id });
  if (rows.length === 0) throw notFound('Conversation not found.');
}

/**
 * Send a learner message and stream the tutor's reply.
 *
 * The assistant message is persisted once streaming finishes so a dropped
 * connection never leaves half a turn in the transcript.
 */
export async function* sendMessage(
  env: Env,
  user: User,
  conversationId: string,
  input: { message: string; learnerChoice?: string[] },
): AsyncGenerator<StreamChunk> {
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, user.id)))
    .limit(1);
  if (!conversation) {
    yield { type: 'error', message: 'Conversation not found.' };
    return;
  }

  const settings = await getSettings(env);
  const [freshUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const entitlements = await resolveEntitlements(freshUser ?? user, settings);
  const limit = entitlements.plan === 'free' ? env.AI_DAILY_LIMIT_FREE : env.AI_DAILY_LIMIT_PREMIUM;
  try {
    await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI tutor message' }]);
  } catch (err) {
    yield { type: 'error', message: (err as Error).message };
    return;
  }

  // Persist the learner turn first so it survives an upstream failure.
  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'user',
    content: input.message,
  });

  const previous = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversation.id))
    .orderBy(asc(aiMessages.createdAt))
    .limit(MAX_STORED_MESSAGES);

  let context: TutorContext = {};
  try {
    context = conversation.providerId && conversation.examKey
      ? await loadTutorContext(env, {
          providerId: conversation.providerId,
          examKey: conversation.examKey,
          questionId: conversation.questionId,
        })
      : {};
  } catch (err) {
    // Dataset unavailable: continue without grounding rather than failing.
    console.error('[ai-chat] tutor context failed:', (err as Error).message);
  }

  const history: AiMessage[] = previous
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: buildTutorSystemPrompt({
        ...context,
        learnerChoice: input.learnerChoice ?? null,
      }),
    },
    ...history,
  ];

  const started = Date.now();
  let answer = '';
  let model: string | null = null;
  let degraded = false;
  let failed = false;
  // Reasoning is model-authored summary only, streamed on its own channel so
  // the answer text stays pure and the UI can collapse it separately.
  let reasoningSeen = false;

  for await (const chunk of streamChat(env, {
    messages,
    maxTokens: env.AI_MAX_TOKENS,
    temperature: 0.35,
  })) {
    if (chunk.type === 'delta' && chunk.text) {
      if (chunk.channel === 'reasoning') {
        if (!reasoningSeen) {
          reasoningSeen = true;
          yield { type: 'reasoning_start' };
        }
        yield { type: 'delta', channel: 'reasoning', text: chunk.text };
        continue;
      }
      // Close the reasoning panel the first time answer text arrives.
      if (reasoningSeen) {
        reasoningSeen = false;
        yield { type: 'reasoning_end' };
      }
      answer += chunk.text;
      yield { type: 'delta', channel: 'answer', text: chunk.text };
    } else if (chunk.type === 'done') {
      model = chunk.model ?? null;
      degraded = Boolean(chunk.degraded);
    } else if (chunk.type === 'error') {
      failed = true;
      console.error('[ai-chat] provider error:', chunk.message);
      yield chunk;
    }
  }

  if (answer.trim()) {
    await db.insert(aiMessages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: answer,
      model,
      degraded,
      latencyMs: Date.now() - started,
    });
    await incrementUsage(user.id, 'aiExplanations', 1);
    await db
      .update(aiConversations)
      .set({
        updatedAt: new Date(),
        messageCount: sql`${aiConversations.messageCount} + 2`,
        // First learner message becomes the conversation title.
        title:
          previous.filter((m) => m.role === 'user').length <= 1
            ? input.message.slice(0, 80)
            : conversation.title,
      })
      .where(eq(aiConversations.id, conversation.id));
  } else if (failed) {
    // Remove the orphaned learner turn so the transcript stays consistent.
    await db
      .delete(aiMessages)
      .where(
        and(
          eq(aiMessages.conversationId, conversation.id),
          eq(aiMessages.role, 'user'),
          eq(aiMessages.content, input.message),
        ),
      );
  }
}
