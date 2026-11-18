import { describe, expect, it } from 'vitest';
import type { NormalizedQuestion } from '@examdump/shared';
import { buildHintMessages, curatedHint } from '../src/services/ai.service.js';

function question(overrides: Partial<NormalizedQuestion> = {}): NormalizedQuestion {
  return {
    id: 'q1',
    number: 1,
    title: 'MAC address aging',
    type: 'single',
    stem: [],
    stemText: 'Which switch mechanism removes dynamic MAC entries after a period of inactivity?',
    stemImages: [],
    choices: [
      { key: 'A', content: [], text: 'Aging', images: [] },
      { key: 'B', content: [], text: 'Flooding', images: [] },
      { key: 'C', content: [], text: 'Poisoning', images: [] },
    ],
    answer: 'A',
    answerRaw: 'A',
    answerText: 'Aging',
    explanation: 'Aging removes idle dynamic MAC entries.',
    votes: [],
    ...overrides,
  } as NormalizedQuestion;
}

describe('hint prompts', () => {
  it('grounds the hint in the specific question and level', () => {
    const messages = buildHintMessages(
      question(),
      { examTitle: 'CCNA', examCode: '200-301', providerTitle: 'Cisco' },
      2,
    );
    const prompt = messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('Which switch mechanism removes dynamic MAC entries');
    expect(prompt).toContain('Level 2 - Narrowing');
    expect(prompt).not.toContain('Level 1 - Orientation');
  });

  it('passes earlier hints so the next one cannot repeat them', () => {
    const messages = buildHintMessages(
      question(),
      {
        examTitle: 'CCNA',
        examCode: '200-301',
        providerTitle: 'Cisco',
        previousHints: ['Look at how the switch table is kept current.'],
      },
      3,
    );
    const prompt = messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('do not repeat or paraphrase');
    expect(prompt).toContain('Look at how the switch table is kept current.');
  });

  it('forbids leaking the private reference answer', () => {
    const prompt = buildHintMessages(
      question(),
      { examTitle: 'CCNA', examCode: '200-301', providerTitle: 'Cisco' },
      1,
    )
      .map((message) => message.content)
      .join('\n');
    expect(prompt).toContain('never disclose');
    expect(prompt).toContain('Aging');
  });
});

describe('curated hint fallback', () => {
  const base = question({ title: null });

  it('never leaks the answer key', () => {
    for (const level of [1, 2, 3] as const) {
      const hint = curatedHint(base, level);
      expect(hint).not.toMatch(/\banswer is\b/i);
      expect(hint).not.toMatch(/\bcorrect (?:answer|option|choice)\b/i);
    }
  });

  it('changes with the selected level', () => {
    const levelOne = curatedHint(base, 1);
    const levelTwo = curatedHint(base, 2);
    const levelThree = curatedHint(base, 3);
    expect(new Set([levelOne, levelTwo, levelThree]).size).toBe(3);
  });

  it('changes with the question instead of repeating a stock line', () => {
    const first = curatedHint(base, 2);
    const second = curatedHint(
      question({ title: null, stemText: 'Which protocol resolves an IPv4 address to a MAC address?' }),
      2,
    );
    expect(first).not.toBe(second);
    expect(first).toContain('switch mechanism removes dynamic MAC entries');
    expect(second).toContain('IPv4 address to a MAC address');
  });

  it('uses the title as the topic and warns about multi-answer items', () => {
    expect(curatedHint(question(), 1)).toContain('MAC address aging');
    expect(curatedHint(question({ answer: 'AC', answerText: 'Aging, Poisoning' }), 1).toLowerCase()).toContain(
      'more than one correct option',
    );
  });
});
