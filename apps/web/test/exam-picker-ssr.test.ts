import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ExamPicker } from '../components/exam-picker';

/**
 * `ExamPicker` renders a "recent exams" tip from `localStorage`.
 *
 * It used to read that value during render. Server HTML therefore never had the
 * tip (no `window`) while a returning visitor's browser rendered it immediately,
 * so React threw "Hydration failed because the server rendered HTML didn't
 * match the client" and re-rendered the picker. The value must only be read
 * after mount.
 */
describe('ExamPicker server rendering', () => {
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
          return JSON.stringify(['cisco:200-301']);
        },
      },
    };

    const html = renderToString(createElement(ExamPicker, { mode: 'practice' }));

    // The tip must not be in the server payload, or it reappears before
    // hydration on a returning visitor's first paint.
    expect(html).not.toContain('recent exams appear first');
    expect(reads).toBe(0);
  });
});
