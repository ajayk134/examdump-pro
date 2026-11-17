import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  elapsedLabel,
  fitPageSize,
  pageBounds,
  pageCount,
  pageOfQuestion,
  pageLinks,
  pageSizeChoices,
  parsePageSize,
  perPage,
  rangeLabel,
  selectionRulesFor,
  statusLabel,
  statusOf,
  toggleSelection,
} from '../lib/question-session';

describe('page size', () => {
  it('defaults to five per page and only accepts the supported sizes', () => {
    expect(parsePageSize('all')).toBe('all');
    expect(parsePageSize('5')).toBe(5);
    expect(parsePageSize(20)).toBe(20);
    expect(parsePageSize(50)).toBe(50);
    expect(parsePageSize('7')).toBeNull();
    expect(parsePageSize('nonsense')).toBeNull();
    // Version 1 stored one-per-page; it now folds into the new default.
    expect(parsePageSize(1)).toBe(5);
    expect(DEFAULT_PAGE_SIZE).toBe(5);
  });

  it('offers sizes that fit the session', () => {
    expect(pageSizeChoices(40)).toEqual([5, 10, 20, 'all']);
    expect(pageSizeChoices(60)).toEqual([5, 10, 20, 50, 'all']);
    expect(pageSizeChoices(12)).toEqual([5, 10, 'all']);
    expect(pageSizeChoices(5)).toEqual([5, 'all']);
    expect(pageSizeChoices(4)).toEqual(['all']);
    expect(pageSizeChoices(0)).toEqual(['all']);
  });

  it('folds a stored size the paper cannot fill into all', () => {
    expect(fitPageSize(50, 60)).toBe(50);
    expect(fitPageSize(50, 12)).toBe('all');
    expect(fitPageSize(5, 3)).toBe('all');
    expect(fitPageSize('all', 60)).toBe('all');
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

  it('builds a compact set of page links', () => {
    expect(pageLinks(0, 1)).toEqual([0]);
    expect(pageLinks(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageLinks(5, 12)).toEqual([0, 'gap', 4, 5, 6, 'gap', 11]);
    // First and last pages never hide the adjacent page.
    expect(pageLinks(0, 12)).toEqual([0, 1, 'gap', 11]);
    expect(pageLinks(11, 12)).toEqual([0, 'gap', 10, 11]);
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

describe('selection rules', () => {
  it('uses the answer key when it is present', () => {
    expect(selectionRulesFor({ answer: 'AC', type: 'multiple' })).toEqual({ multi: true, limit: 2 });
    expect(selectionRulesFor({ answer: 'B', type: 'single' })).toEqual({ multi: false, limit: 1 });
  });

  it('lets a multi-select question take more than one pick without a key', () => {
    expect(selectionRulesFor({ answer: null, type: 'multiple' })).toEqual({ multi: true, limit: 2 });
    expect(selectionRulesFor({ answer: '', type: 'unknown' })).toEqual({ multi: false, limit: 1 });
  });
});
