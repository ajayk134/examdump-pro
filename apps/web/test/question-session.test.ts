import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  elapsedLabel,
  pageBounds,
  pageCount,
  pageOfQuestion,
  pageSizeChoices,
  parsePageSize,
  perPage,
  rangeLabel,
  statusLabel,
  statusOf,
  toggleSelection,
} from '../lib/question-session';

describe('page size', () => {
  it('only accepts the supported sizes', () => {
    expect(parsePageSize('all')).toBe('all');
    expect(parsePageSize('5')).toBe(5);
    expect(parsePageSize(20)).toBe(20);
    expect(parsePageSize('7')).toBeNull();
    expect(parsePageSize('nonsense')).toBeNull();
    expect(DEFAULT_PAGE_SIZE).toBe(1);
  });

  it('offers sizes that fit the session', () => {
    expect(pageSizeChoices(40)).toEqual([1, 5, 10, 20, 'all']);
    expect(pageSizeChoices(12)).toEqual([1, 5, 10, 'all']);
    expect(pageSizeChoices(4)).toEqual([1, 'all']);
    expect(pageSizeChoices(0)).toEqual([1, 'all']);
  });

  it('treats "all" as one page and never divides by zero', () => {
    expect(perPage('all', 37)).toBe(37);
    expect(perPage(10, 37)).toBe(10);
    expect(perPage(20, 4)).toBe(4);
    expect(pageCount(37, 'all')).toBe(1);
    expect(pageCount(37, 10)).toBe(4);
    expect(pageCount(0, 10)).toBe(1);
  });
});

describe('paging', () => {
  it('slices pages and clamps out-of-range cursors', () => {
    expect(pageBounds(0, 12, 5)).toEqual({ page: 0, start: 0, end: 5 });
    expect(pageBounds(2, 12, 5)).toEqual({ page: 2, start: 10, end: 12 });
    expect(pageBounds(99, 12, 5)).toEqual({ page: 2, start: 10, end: 12 });
    expect(pageBounds(-3, 12, 5)).toEqual({ page: 0, start: 0, end: 5 });
    expect(clampPage(7, 12, 5)).toBe(2);
    expect(clampPage(Number.NaN, 12, 5)).toBe(0);
  });

  it('finds the page that holds a question', () => {
    expect(pageOfQuestion(0, 12, 5)).toBe(0);
    expect(pageOfQuestion(4, 12, 5)).toBe(0);
    expect(pageOfQuestion(5, 12, 5)).toBe(1);
    expect(pageOfQuestion(11, 12, 5)).toBe(2);
    expect(pageOfQuestion(999, 12, 5)).toBe(2);
    expect(pageOfQuestion(3, 12, 'all')).toBe(0);
  });

  it('labels the visible range', () => {
    expect(rangeLabel(0, 5, 40)).toBe('Questions 1–5 of 40');
    expect(rangeLabel(35, 40, 40)).toBe('Questions 36–40 of 40');
    expect(rangeLabel(0, 0, 0)).toBe('No questions');
  });
});

describe('selection', () => {
  it('replaces the pick for single-answer questions', () => {
    expect(toggleSelection([], 'A', { multi: false, limit: 1 })).toEqual(['A']);
    expect(toggleSelection(['A'], 'B', { multi: false, limit: 1 })).toEqual(['B']);
    expect(toggleSelection(['A'], 'A', { multi: false, limit: 1 })).toEqual([]);
  });

  it('accumulates up to the answer-key length, then replaces', () => {
    expect(toggleSelection([], 'A', { multi: true, limit: 2 })).toEqual(['A']);
    expect(toggleSelection(['A'], 'C', { multi: true, limit: 2 })).toEqual(['A', 'C']);
    expect(toggleSelection(['A', 'C'], 'D', { multi: true, limit: 2 })).toEqual(['D']);
    expect(toggleSelection(['A', 'C'], 'A', { multi: true, limit: 2 })).toEqual(['C']);
  });
});

describe('palette status', () => {
  it('combines answered and flagged state', () => {
    expect(statusOf({ answered: false, flagged: false })).toBe('unanswered');
    expect(statusOf({ answered: true, flagged: false })).toBe('answered');
    expect(statusOf({ answered: false, flagged: true })).toBe('flagged');
    expect(statusOf({ answered: true, flagged: true })).toBe('answered-flagged');
  });

  it('describes each status for screen readers', () => {
    expect(statusLabel('unanswered')).toBe('not answered');
    expect(statusLabel('answered')).toBe('answered');
    expect(statusLabel('flagged')).toContain('marked for review');
    expect(statusLabel('answered-flagged')).toContain('answered');
  });
});

describe('elapsed clock', () => {
  it('formats minutes and hours', () => {
    expect(elapsedLabel(0)).toBe('0:00');
    expect(elapsedLabel(65_000)).toBe('1:05');
    expect(elapsedLabel(59 * 60_000 + 59_000)).toBe('59:59');
    expect(elapsedLabel(3_600_000 + 61_000)).toBe('1:01:01');
    expect(elapsedLabel(-500)).toBe('0:00');
  });
});