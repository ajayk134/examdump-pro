/**
 * Question-session mechanics shared by practice and mock exams.
 *
 * Everything here is pure so the paging, selection and palette rules can be
 * unit tested without a browser. The runners own the state; this file only
 * decides how that state maps to pages and statuses.
 */

export const PAGE_SIZES = [5, 10, 20, 50, 'all'] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** One graded practice answer, queued for `POST /api/analytics/practice`. */
export interface AnsweredResult {
  questionId: string;
  selected: string[];
  correct: boolean;
  timeSpentMs: number;
}

/**
 * Five complete cards per page is the default: enough to work in context
 * without turning the session into an endless scroll. One-per-page remains
 * unnecessary now that the palette and pager both jump by question.
 */
export const DEFAULT_PAGE_SIZE: PageSize = 5;

/** Sanitise a value restored from storage or a query string. */
export function parsePageSize(value: unknown): PageSize | null {
  if (value === 'all') return 'all';
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null;
  // Version 1 defaulted to one-per-page; treat it as the new default rather
  // than leaving a restored session stuck in the old layout.
  if (numeric === 1) return DEFAULT_PAGE_SIZE;
  const match = PAGE_SIZES.find((size) => size !== 'all' && size === numeric);
  return match ?? null;
}

/**
 * Page sizes that make sense for a session. A size larger than the paper is
 * noise, so those collapse into "All"; the smallest size is only offered when
 * the session can actually fill it.
 */
export function pageSizeChoices(total: number): PageSize[] {
  const safeTotal = Math.max(0, Math.floor(total));
  if (safeTotal <= 0) return ['all'];
  const sizes = PAGE_SIZES.filter(
    (size): size is Exclude<PageSize, 'all'> => size !== 'all' && size <= safeTotal,
  );
  return sizes.length > 0 ? [...sizes, 'all'] : ['all'];
}

/** The nearest size the session can honour, used to validate stored state. */
export function fitPageSize(size: PageSize, total: number): PageSize {
  const choices = pageSizeChoices(total);
  return choices.includes(size) ? size : 'all';
}

/** Questions rendered on one page. "All" is a single page. */
export function perPage(size: PageSize, total: number): number {
  const safeTotal = Math.max(1, total);
  return size === 'all' ? safeTotal : Math.min(size, safeTotal);
}

export function pageCount(total: number, size: PageSize): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / perPage(size, total)));
}

/** Clamp a page index into range so stale storage cannot blank the screen. */
export function clampPage(page: number, total: number, size: PageSize): number {
  const last = pageCount(total, size) - 1;
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.floor(page)), last);
}

export interface PageBounds {
  page: number;
  /** Inclusive question index. */
  start: number;
  /** Exclusive question index. */
  end: number;
}

/** Resolve a page index to the slice of questions it shows. */
export function pageBounds(page: number, total: number, size: PageSize): PageBounds {
  const resolved = clampPage(page, total, size);
  const start = resolved * perPage(size, total);
  return { page: resolved, start, end: Math.min(total, start + perPage(size, total)) };
}

/** Which page a question lives on, used when jumping from the palette. */
export function pageOfQuestion(index: number, total: number, size: PageSize): number {
  if (total <= 0) return 0;
  const safeIndex = Math.min(Math.max(0, Math.floor(index)), total - 1);
  return Math.min(pageCount(total, size) - 1, Math.floor(safeIndex / perPage(size, total)));
}

export interface SelectionRules {
  /** True when the question accepts more than one answer. */
  multi: boolean;
  /** How many options the answer key expects. */
  limit: number;
}

/**
 * Selection toggle used by both runners.
 *
 * A full multi-select replaces the oldest pick when the answer key only allows
 * a fixed number of options, which is what the previous card did and what
 * learners expect from a "choose two" item.
 */
export function toggleSelection(selected: string[], key: string, rules: SelectionRules): string[] {
  if (selected.includes(key)) return selected.filter((value) => value !== key);
  if (!rules.multi) return [key];
  if (rules.limit > 0 && selected.length >= rules.limit) return [key];
  return [...selected, key];
}

export type QuestionStatus = 'answered' | 'answered-flagged' | 'flagged' | 'unanswered';

/** Palette status, independent of which question is currently focused. */
export function statusOf(input: { answered: boolean; flagged: boolean }): QuestionStatus {
  if (input.answered && input.flagged) return 'answered-flagged';
  if (input.answered) return 'answered';
  if (input.flagged) return 'flagged';
  return 'unanswered';
}

/** Human label for the palette cell's accessible name. */
export function statusLabel(status: QuestionStatus): string {
  switch (status) {
    case 'answered':
      return 'answered';
    case 'answered-flagged':
      return 'answered, marked for review';
    case 'flagged':
      return 'not answered, marked for review';
    default:
      return 'not answered';
  }
}

/** Compact clock: m:ss under an hour, h:mm:ss above. */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "Questions 6–10 of 40" for the pager. */
export function rangeLabel(start: number, end: number, total: number): string {
  if (total <= 0) return 'No questions';
  return `Questions ${start + 1}–${Math.max(start + 1, end)} of ${total}`;
}

/**
 * Page buttons for the pager: first, last and the pages around the cursor,
 * with `gap` entries where the numbering skips.
 */
export function pageLinks(page: number, pages: number, window = 1): Array<number | 'gap'> {
  if (pages <= 0) return [0];
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index);
  const wanted = new Set<number>([0, pages - 1]);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = page + offset;
    if (candidate > 0 && candidate < pages - 1) wanted.add(candidate);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    if (index > 0 && value - sorted[index - 1]! > 1) out.push('gap');
    out.push(value);
  }
  return out;
}
