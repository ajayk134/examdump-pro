import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * One community vote per user per question. The unique index makes a duplicate
 * impossible; changing an answer updates the existing row instead of adding
 * another vote.
 */
export const questionVotes = pgTable(
  'question_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    examKey: text('exam_key').notNull(),
    questionId: text('question_id').notNull(),
    choiceKey: text('choice_key').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('question_votes_user_question_unique').on(
      t.userId,
      t.providerId,
      t.examKey,
      t.questionId,
    ),
    index('question_votes_question_idx').on(t.providerId, t.examKey, t.questionId),
  ],
);

/**
 * Threaded question discussions. Replies point at another comment in the same
 * question. Deletes are soft so a reply never disappears from underneath its
 * parent; the API returns the tombstone and clears the body.
 */
export const questionComments = pgTable(
  'question_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    examKey: text('exam_key').notNull(),
    questionId: text('question_id').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => questionComments.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('question_comments_question_idx').on(
      t.providerId,
      t.examKey,
      t.questionId,
      t.createdAt,
    ),
    index('question_comments_parent_idx').on(t.parentId, t.createdAt),
    index('question_comments_user_idx').on(t.userId, t.createdAt),
  ],
);