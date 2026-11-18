import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Question } from '@/lib/types';

vi.mock('@/components/providers', () => ({
  useAuth: () => ({ user: { id: 'test-user' } }),
  useToast: () => ({ toast: vi.fn() }),
}));

import { ExplainPanel } from '@/components/workspace/explain-panel';
import { HintPanel } from '@/components/workspace/hint-panel';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'Question #: 1',
    number: 1,
    title: null,
    type: 'single',
    stem: [],
    stemText: 'Which switch mechanism removes idle dynamic MAC entries?',
    stemImages: [],
    choices: [
      { key: 'A', content: [{ type: 'text', value: 'Aging' }], text: 'Aging', images: [] },
      { key: 'B', content: [{ type: 'text', value: 'Flooding' }], text: 'Flooding', images: [] },
    ],
    explanation: 'Aging removes idle entries.',
    answer: 'A',
    answerText: 'Aging',
    votes: [],
    ...overrides,
  };
}

function renderHint(q: Question): string {
  return renderToStaticMarkup(
    <HintPanel
      question={q}
      mode="practice"
      providerId="cisco"
      examKey="200-301"
      aiEnabled
      onConsumed={() => undefined}
      onOpenExplain={() => undefined}
      onOpenChat={() => undefined}
    />,
  );
}

describe('hint panel', () => {
  it('derives a different reading focus for each question', () => {
    const first = renderHint(question());
    const second = renderHint(question({ stemText: 'Which protocol resolves IPv4 addresses to MAC addresses?' }));
    expect(first).toContain('Which switch mechanism removes idle dynamic MAC entries?');
    expect(second).toContain('Which protocol resolves IPv4 addresses to MAC addresses?');
    expect(first).not.toBe(second);
  });

  it('does not repeat the old stock orientation copy', () => {
    const html = renderHint(question());
    expect(html).not.toContain('Find the single constraint or keyword that changes the outcome.');
    expect(html).not.toContain('Name what the question is testing before comparing the options.');
  });
});

describe('explain panel scrolling', () => {
  it('puts the walkthrough content in an independently scrollable area', () => {
    const html = renderToStaticMarkup(
      <ExplainPanel
        question={question()}
        mode="practice"
        selected={['B']}
        revealed
        correct={false}
        providerId="cisco"
        examKey="200-301"
        aiEnabled
        onConsumed={() => undefined}
        onOpenChat={() => undefined}
      />,
    );
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('overscroll-contain');
    expect(html).toContain('min-h-0');
    // The option breakdown must live inside the scroll region, not beside it.
    expect(html.indexOf('Option by option')).toBeGreaterThan(html.indexOf('overflow-y-auto'));
  });
});
