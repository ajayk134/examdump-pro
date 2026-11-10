import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Searchable provider/exam metadata synced from the GitHub dataset.
 * Question bodies are intentionally never stored here.
 */
export const catalogProviders = pgTable(
  'catalog_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: text('provider_id').notNull(),
    file: text('file').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    examCount: integer('exam_count').notNull().default(0),
    totalQuestions: integer('total_questions').notNull().default(0),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('catalog_providers_provider_unique').on(t.providerId),
    index('catalog_providers_slug_idx').on(t.slug),
    index('catalog_providers_title_idx').on(t.title),
  ],
);

export const catalogExams = pgTable(
  'catalog_exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: text('provider_id').notNull(),
    providerTitle: text('provider_title').notNull(),
    providerSlug: text('provider_slug').notNull(),
    key: text('key').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    questionCount: integer('question_count').notNull().default(0),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('catalog_exams_provider_key_unique').on(t.providerId, t.key),
    index('catalog_exams_provider_idx').on(t.providerId),
    index('catalog_exams_code_idx').on(t.code),
    index('catalog_exams_slug_idx').on(t.slug),
    index('catalog_exams_question_count_idx').on(t.questionCount),
    index('catalog_exams_search_idx').on(t.title, t.code, t.providerTitle),
  ],
);

export type CatalogProvider = typeof catalogProviders.$inferSelect;
export type CatalogExam = typeof catalogExams.$inferSelect;
