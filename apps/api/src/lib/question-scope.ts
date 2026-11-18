import { and, eq } from 'drizzle-orm';
import type { NormalizedQuestion, PracticeFocus, QuestionKind } from '@examdump/shared';
import { getDb } from '../db/client.js';
import { bookmarks, questionResults } from '../db/schema/index.js';

/**
 * Derive the practice topic for a question.
 *
 * The upstream dataset encodes the topic in the question title
 * ("Exam CISA topic 1 question 4 discussion"). Most exams are a single topic
 * today, and this function is the single place that assumption lives: if the
 * dataset ever grows a real taxonomy, only this mapping changes.
 */
export function topicForQuestion(question: Pick<NormalizedQuestion, 'title'>, examCode: string): string {
  if (question.title) {
    const match = question.title.match(/topic\s+(\d+)/i);
    if (match?.[1]) return `Topic ${match[1]}`;
  }
  return examCode ? `${examCode} General` : 'General';
}

/**
 * The answer shape of a question.
 *
 * `unknown` questions still have choices but no parseable key; they are treated
 * as single-choice so they stay reachable instead of disappearing from every
 * filtered view.
 */
export function kindOfQuestion(question: Pick<NormalizedQuestion, 'type'>): QuestionKind {
  if (question.type === 'multiple' || question.type === 'dragdrop') return question.type;
  return 'single';
}

export interface QuestionSets {
  /** Question ids the learner has answered at least once. */
  seen: Set<string>;
  /** Last answer was wrong. */
  missed: Set<string>;
  /** Last answer was right. */
  mastered: Set<string>;
  bookmarked: Set<string>;
}

export const EMPTY_SETS: QuestionSets = {
  seen: new Set(),
  missed: new Set(),
  mastered: new Set(),
  bookmarked: new Set(),
};

/** Load the learner's per-question history for one exam, in two queries. */
export async function loadQuestionSets(userId: string, examKey: string): Promise<QuestionSets> {
  const db = getDb();
  const [results, saved] = await Promise.all([
    db
      .select({
        questionId: questionResults.questionId,
        lastCorrect: questionResults.lastCorrect,
      })
      .from(questionResults)
      .where(and(eq(questionResults.userId, userId), eq(questionResults.examKey, examKey))),
    db
      .select({ questionId: bookmarks.questionId })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.examKey, examKey))),
  ]);

  const seen = new Set<string>();
  const missed = new Set<string>();
  const mastered = new Set<string>();
  for (const row of results) {
    seen.add(row.questionId);
    if (row.lastCorrect) mastered.add(row.questionId);
    else missed.add(row.questionId);
  }
  return { seen, missed, mastered, bookmarked: new Set(saved.map((row) => row.questionId)) };
}

export interface QuestionFilter {
  focus?: PracticeFocus;
}

/**
 * Filter a question list by the learner's own history. Topic and question-type
 * filters are deliberately not supported: every question is part of one
 * unified session. Slicing by entitlement happens before this is applied.
 */
export function filterQuestions<T extends Pick<NormalizedQuestion, 'id'>>(
  questions: T[],
  filter: QuestionFilter,
  sets: QuestionSets = EMPTY_SETS,
): T[] {
  const focus = filter.focus && filter.focus !== 'all' ? filter.focus : null;
  if (!focus) return questions;

  return questions.filter((question) => {
    if (focus === 'unseen' && sets.seen.has(question.id)) return false;
    if (focus === 'missed' && !sets.missed.has(question.id)) return false;
    if (focus === 'mastered' && !sets.mastered.has(question.id)) return false;
    if (focus === 'bookmarked' && !sets.bookmarked.has(question.id)) return false;
    return true;
  });
}

export interface QuestionFacets {
  focus: Array<{ id: PracticeFocus; count: number }>;
}

/**
 * Counts for the practice configurator. Computed over the questions the
 * learner can actually reach, so a free user is never shown a count they
 * cannot open.
 */
export function buildFacets(
  questions: Array<Pick<NormalizedQuestion, 'id'>>,
  sets: QuestionSets = EMPTY_SETS,
): QuestionFacets {
  let unseen = 0;
  let missed = 0;
  let mastered = 0;
  let saved = 0;

  for (const question of questions) {
    if (sets.missed.has(question.id)) missed += 1;
    else if (sets.mastered.has(question.id)) mastered += 1;
    else unseen += 1;
    if (sets.bookmarked.has(question.id)) saved += 1;
  }

  return {
    focus: [
      { id: 'all' as const, count: questions.length },
      { id: 'unseen' as const, count: unseen },
      { id: 'missed' as const, count: missed },
      { id: 'mastered' as const, count: mastered },
      { id: 'bookmarked' as const, count: saved },
    ],
  };
}