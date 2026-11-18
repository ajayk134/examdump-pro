/**
 * Community votes and question discussions.
 *
 * Both features are keyed by provider/exam/question because question IDs are
 * only unique inside an exam. Votes are one-per-user and can be changed; the
 * database unique index is the real duplicate guard. Comments are soft-deleted
 * so replies stay attached to a tombstone.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import type { NormalizedQuestion } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { questionComments, questionVotes, users } from '../db/schema/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { type Paginated, parsePage, paginate } from '../lib/pagination.js';
import { getDatasetClient } from './dataset.service.js';

export interface CommunityQuestionContext {
  provider: string;
  exam: string;
  questionId: string;
}

export interface CommunityVoteSummary {
  total: number;
  counts: Record<string, number>;
  myVote: string | null;
}

export interface CommunityComment {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: boolean;
  user: {
    id: string;
    name: string;
    avatarUrl: string;
    role: string;
  };
  replyTo: { id: string; name: string } | null;
  replyCount: number;
  replies: CommunityComment[];
}

interface CommentRow {
  id: string;
  userId: string;
  body: string;
  parentId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userName: string | null;
  userAvatar: string | null;
  userRole: string | null;
}

const commentSelection = {
  id: questionComments.id,
  userId: questionComments.userId,
  body: questionComments.body,
  parentId: questionComments.parentId,
  deletedAt: questionComments.deletedAt,
  createdAt: questionComments.createdAt,
  updatedAt: questionComments.updatedAt,
  userName: users.name,
  userAvatar: users.avatarUrl,
  userRole: users.role,
};

function toComment(row: CommentRow, replyToName?: string): CommunityComment {
  const deleted = Boolean(row.deletedAt);
  return {
    id: row.id,
    body: deleted ? '' : row.body,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    edited: !deleted && row.updatedAt.getTime() - row.createdAt.getTime() > 1000,
    deleted,
    user: {
      id: row.userId,
      name: row.userName ?? 'Former learner',
      avatarUrl: row.userAvatar ?? '',
      role: row.userRole ?? 'user',
    },
    replyTo: row.parentId ? { id: row.parentId, name: replyToName ?? 'a learner' } : null,
    replyCount: 0,
    replies: [],
  };
}

/**
 * Build the full comment forest in one pass. Rows arrive oldest-first, so a
 * parent always exists before its child. The caller paginates the roots; every
 * reply for the returned roots is already attached.
 */
export function buildCommentTree(rows: CommentRow[]): {
  roots: CommunityComment[];
  total: number;
} {
  const byId = new Map<string, CommunityComment>();
  for (const row of rows) {
    const parentName = row.parentId ? byId.get(row.parentId)?.user.name : undefined;
    byId.set(row.id, toComment(row, parentName));
  }

  const roots: CommunityComment[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    if (row.parentId) {
      const parent = byId.get(row.parentId);
      if (parent) parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  const countReplies = (node: CommunityComment): number => {
    node.replyCount = node.replies.reduce((total, reply) => total + 1 + countReplies(reply), 0);
    return node.replyCount;
  };
  roots.forEach(countReplies);

  return { roots, total: byId.size };
}

async function loadQuestion(env: Env, context: CommunityQuestionContext) {
  const { question } = await getDatasetClient(env).getQuestion(
    context.provider,
    context.exam,
    context.questionId,
  );
  return question;
}

export function isMultiAnswerQuestion(
  question: Pick<NormalizedQuestion, 'type' | 'answer'>,
): boolean {
  return question.type === 'multiple' || question.answer.length > 1;
}

/**
 * Parse the submitted choice field. Single-answer questions accept one option
 * key; multi-answer questions accept a comma-separated selection. The stored
 * value and `myVote` use the same comma-separated form.
 */
export function parseVoteKeys(
  question: Pick<NormalizedQuestion, 'type' | 'answer' | 'choices'>,
  raw: string,
): string[] {
  const allowed = new Set(question.choices.map((choice) => choice.key));
  const keys = [
    ...new Set(
      raw
        .trim()
        .toUpperCase()
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ].sort();

  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    throw badRequest('Choose one of the listed answer options.');
  }
  if (!isMultiAnswerQuestion(question) && keys.length > 1) {
    throw badRequest('This question accepts one answer option.');
  }
  return keys;
}

function storedVoteKeys(
  question: Pick<NormalizedQuestion, 'choices'>,
  stored: string,
): string[] {
  const allowed = new Set(question.choices.map((choice) => choice.key));
  const parts = stored
    .toUpperCase()
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  // Older/simple single votes are stored as one key. Accept a compact letter
  // string too, so a multi vote written before the comma format still counts.
  const candidates =
    parts.length === 1 && !allowed.has(parts[0]!) && /^[A-Z]+$/.test(parts[0]!)
      ? [...parts[0]!]
      : parts;
  return [...new Set(candidates)].filter((key) => allowed.has(key));
}

export async function getVoteSummary(
  env: Env,
  userId: string,
  context: CommunityQuestionContext,
): Promise<CommunityVoteSummary> {
  const question = await loadQuestion(env, context);
  const db = getDb();
  const rows = await db
    .select({ choiceKey: questionVotes.choiceKey, value: count() })
    .from(questionVotes)
    .where(
      and(
        eq(questionVotes.providerId, context.provider),
        eq(questionVotes.examKey, context.exam),
        eq(questionVotes.questionId, context.questionId),
      ),
    )
    .groupBy(questionVotes.choiceKey);
  const [mine] = await db
    .select({ choiceKey: questionVotes.choiceKey })
    .from(questionVotes)
    .where(
      and(
        eq(questionVotes.userId, userId),
        eq(questionVotes.providerId, context.provider),
        eq(questionVotes.examKey, context.exam),
        eq(questionVotes.questionId, context.questionId),
      ),
    )
    .limit(1);

  const counts: Record<string, number> = {};
  for (const choice of question.choices) counts[choice.key] = 0;
  for (const row of rows) {
    for (const key of storedVoteKeys(question, row.choiceKey)) {
      counts[key] = (counts[key] ?? 0) + Number(row.value);
    }
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const mineKeys = mine ? storedVoteKeys(question, mine.choiceKey) : [];

  return {
    total,
    counts,
    myVote: mineKeys.length > 0 ? mineKeys.join(',') : null,
  };
}

export async function castVote(
  env: Env,
  userId: string,
  context: CommunityQuestionContext,
  choice: string,
): Promise<CommunityVoteSummary> {
  const question = await loadQuestion(env, context);
  const keys = parseVoteKeys(question, choice);
  const stored = keys.join(',');

  await getDb()
    .insert(questionVotes)
    .values({
      userId,
      providerId: context.provider,
      examKey: context.exam,
      questionId: context.questionId,
      choiceKey: stored,
    })
    .onConflictDoUpdate({
      target: [
        questionVotes.userId,
        questionVotes.providerId,
        questionVotes.examKey,
        questionVotes.questionId,
      ],
      set: { choiceKey: stored, updatedAt: new Date() },
    });

  return getVoteSummary(env, userId, context);
}

export async function listComments(
  env: Env,
  context: CommunityQuestionContext,
  options: { sort: 'newest' | 'oldest'; page: number; pageSize: number },
): Promise<{
  comments: CommunityComment[];
  pagination: Paginated<CommunityComment>['pagination'];
  totalComments: number;
}> {
  await loadQuestion(env, context);
  const rows = await getDb()
    .select(commentSelection)
    .from(questionComments)
    .leftJoin(users, eq(users.id, questionComments.userId))
    .where(
      and(
        eq(questionComments.providerId, context.provider),
        eq(questionComments.examKey, context.exam),
        eq(questionComments.questionId, context.questionId),
      ),
    )
    .orderBy(asc(questionComments.createdAt));

  const { roots, total } = buildCommentTree(rows);
  if (options.sort === 'newest') roots.reverse();

  const page = parsePage(options.page, options.pageSize);
  const pageRoots = roots.slice(page.skip, page.skip + page.limit);
  const paged = paginate(pageRoots, roots.length, page);

  return {
    comments: paged.items,
    pagination: paged.pagination,
    totalComments: total,
  };
}

export async function createComment(
  env: Env,
  userId: string,
  context: CommunityQuestionContext,
  input: { body: string; parentId?: string },
): Promise<CommunityComment> {
  await loadQuestion(env, context);
  let parentName: string | undefined;
  if (input.parentId) {
    const [parent] = await getDb()
      .select({
        id: questionComments.id,
        providerId: questionComments.providerId,
        examKey: questionComments.examKey,
        questionId: questionComments.questionId,
        name: users.name,
      })
      .from(questionComments)
      .leftJoin(users, eq(users.id, questionComments.userId))
      .where(eq(questionComments.id, input.parentId))
      .limit(1);
    if (
      !parent ||
      parent.providerId !== context.provider ||
      parent.examKey !== context.exam ||
      parent.questionId !== context.questionId
    ) {
      throw badRequest('The comment you are replying to was not found on this question.');
    }
    parentName = parent.name ?? 'a learner';
  }

  const [comment] = await getDb()
    .insert(questionComments)
    .values({
      userId,
      providerId: context.provider,
      examKey: context.exam,
      questionId: context.questionId,
      parentId: input.parentId,
      body: input.body,
    })
    .returning();

  if (!comment) throw new Error('Comment insert failed');

  const [author] = await getDb()
    .select({ name: users.name, avatarUrl: users.avatarUrl, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    ...toComment({
      ...comment,
      userName: author?.name ?? null,
      userAvatar: author?.avatarUrl ?? null,
      userRole: author?.role ?? null,
    }),
    replyTo: input.parentId ? { id: input.parentId, name: parentName ?? 'a learner' } : null,
  };
}

async function findComment(id: string): Promise<CommentRow | null> {
  const [row] = await getDb()
    .select(commentSelection)
    .from(questionComments)
    .leftJoin(users, eq(users.id, questionComments.userId))
    .where(eq(questionComments.id, id))
    .limit(1);
  return row ?? null;
}

function assertCanManage(row: CommentRow, userId: string, role: string): void {
  if (row.userId !== userId && role !== 'admin') {
    throw forbidden('You can only edit or delete your own comments.');
  }
  if (row.deletedAt) throw notFound('Comment not found.');
}

export async function updateComment(
  id: string,
  userId: string,
  role: string,
  body: string,
): Promise<CommunityComment> {
  const row = await findComment(id);
  if (!row) throw notFound('Comment not found.');
  assertCanManage(row, userId, role);

  const [updated] = await getDb()
    .update(questionComments)
    .set({ body, updatedAt: new Date() })
    .where(eq(questionComments.id, id))
    .returning();
  if (!updated) throw notFound('Comment not found.');

  return toComment({
    ...updated,
    userName: row.userName,
    userAvatar: row.userAvatar,
    userRole: row.userRole,
  });
}

export async function deleteComment(id: string, userId: string, role: string): Promise<void> {
  const row = await findComment(id);
  if (!row) throw notFound('Comment not found.');
  assertCanManage(row, userId, role);

  await getDb()
    .update(questionComments)
    .set({ body: '', deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(questionComments.id, id));
}