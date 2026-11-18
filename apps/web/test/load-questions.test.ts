import { describe, expect, it } from 'vitest';
import { loadAllQuestionPages } from '@/lib/load-questions';

const all = Array.from({ length: 606 }, (_, index) => ({ id: `Question #: ${index + 1}` }));

function fetcher(calls: Array<[number, number]>) {
  return async (offset: number, limit: number) => {
    calls.push([offset, limit]);
    return { questions: all.slice(offset, offset + limit), accessible: all.length };
  };
}

describe('loadAllQuestionPages', () => {
  it('loads every question beyond 200 without dropping or reordering', async () => {
    const calls: Array<[number, number]> = [];
    const result = await loadAllQuestionPages(fetcher(calls), 606, 200);

    expect(result).toHaveLength(606);
    expect(result[0]?.id).toBe('Question #: 1');
    expect(result[200]?.id).toBe('Question #: 201');
    expect(result[605]?.id).toBe('Question #: 606');
    expect(calls).toEqual([
      [0, 200],
      [200, 200],
      [400, 200],
      [600, 6],
    ]);
  });

  it('stops at the requested count', async () => {
    const calls: Array<[number, number]> = [];
    const result = await loadAllQuestionPages(fetcher(calls), 20, 200);
    expect(result).toHaveLength(20);
    expect(calls).toEqual([[0, 20]]);
  });

  it('honours a smaller accessible set, such as the free preview', async () => {
    const calls: Array<[number, number]> = [];
    const fetchPage = async (offset: number, limit: number) => {
      calls.push([offset, limit]);
      return { questions: all.slice(0, 5).slice(offset, offset + limit), accessible: 5 };
    };
    const result = await loadAllQuestionPages(fetchPage, 5, 200);
    expect(result).toHaveLength(5);
    expect(calls).toEqual([[0, 5]]);
  });
});