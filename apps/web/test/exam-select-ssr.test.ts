import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ExamSelect } from '../components/exam-select';

/**
 * The exam selector seeds itself with recently-viewed exams from `localStorage`.
 *
 * Reading that during render produced different HTML on the server (no
 * `window`) than on a returning visitor's first client render, which React
 * reports as a hydration mismatch. The value must only be read after mount.
 */
describe('ExamSelect server rendering', () => {
  const original = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = original;
    }
  });

  it('does not read localStorage while rendering on the server', () => {
    let reads = 0;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem() {
          reads += 1;
          return JSON.stringify([{ providerId: 'cisco', examKey: '200-301' }]);
        },
      },
    };

    const html = renderToString(createElement(ExamSelect, { value: null, onChange: () => undefined }));

    expect(html).toContain('Search the full catalogue');
    expect(reads).toBe(0);
  });
});
