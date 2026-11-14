import { describe, expect, it } from 'vitest';
import {
  contentToText,
  normalizeQuestion,
  parseAnswerLetters,
  stripAnswerLabel,
  stripOptionLabelFromContent,
  stripOptionPrefix,
  toClientQuestion,
} from './content.js';

describe('parseAnswerLetters', () => {
  it('parses a labeled single answer', () => {
    expect(parseAnswerLetters('Suggested Answer: A 🗳️')).toBe('A');
  });
  it('parses multiple answers with separators', () => {
    expect(parseAnswerLetters('Suggested Answer: A, C')).toBe('AC');
  });
  it('normalises lowercase and duplicates', () => {
    expect(parseAnswerLetters('Correct Answer: b a b')).toBe('BA');
  });
  it('returns empty for no answer', () => {
    expect(parseAnswerLetters('')).toBe('');
  });
});

describe('stripOptionPrefix', () => {
  it('removes the option label', () => {
    expect(stripOptionPrefix('A. Cisco Meeting Server', 'A')).toBe('Cisco Meeting Server');
    expect(stripOptionPrefix('B) IM and Presence', 'B')).toBe('IM and Presence');
    expect(stripOptionPrefix('C: Software Clients', 'C')).toBe('Software Clients');
  });
  it('leaves text without a prefix intact', () => {
    expect(stripOptionPrefix('Nothing here', 'A')).toBe('Nothing here');
  });
});

describe('stripOptionLabelFromContent', () => {
  it('removes the label from the first text item only', () => {
    const items = [
      { type: 'text' as const, value: 'A. default route' },
      { type: 'break' as const },
      { type: 'text' as const, value: 'keep A. here' },
    ];
    expect(stripOptionLabelFromContent(items, 'A')).toEqual([
      { type: 'text', value: 'default route' },
      { type: 'break' },
      { type: 'text', value: 'keep A. here' },
    ]);
  });

  it('is idempotent and leaves content without a label untouched', () => {
    const once = stripOptionLabelFromContent([{ type: 'text' as const, value: 'A. First' }], 'A');
    expect(stripOptionLabelFromContent(once, 'A')).toEqual(once);
    const plain = [{ type: 'text' as const, value: 'First' }];
    expect(stripOptionLabelFromContent(plain, 'A')).toBe(plain);
  });

  it('ignores a label that belongs to another key', () => {
    const items = [{ type: 'text' as const, value: 'B. Second' }];
    expect(stripOptionLabelFromContent(items, 'A')).toBe(items);
  });
});

describe('stripAnswerLabel', () => {
  it('removes the answer label so the UI does not repeat it', () => {
    expect(stripAnswerLabel('Suggested Answer: B')).toBe('B');
    expect(stripAnswerLabel('Correct Answer: A, C')).toBe('A, C');
    expect(stripAnswerLabel('Answer - D')).toBe('D');
    expect(stripAnswerLabel('answer: A')).toBe('A');
  });
  it('leaves an unlabelled answer intact and is idempotent', () => {
    expect(stripAnswerLabel('B')).toBe('B');
    expect(stripAnswerLabel(stripAnswerLabel('Suggested Answer: B'))).toBe('B');
  });
});

describe('normalizeQuestion', () => {
  const raw = {
    Title: 'Exam topic 1 question 1',
    Question: {
      content: [
        { type: 'text', value: 'Which two are correct?' },
        { type: 'break' },
        { type: 'image', src: 'https://img.example.com/q.png' },
      ],
    },
    Choices: {
      A: { content: [{ type: 'text', value: 'A. First' }] },
      B: { content: [{ type: 'text', value: 'B. Second' }] },
      C: { content: [{ type: 'text', value: 'C. Third' }] },
    },
    Answer: { content: [{ type: 'text', value: 'Suggested Answer: AC' }] },
    Explanation: { content: [{ type: 'text', value: 'Because.' }] },
    Vote_count: [
      { voted_answers: 'AC', vote_count: 10, is_most_voted: true },
      { voted_answers: 'B', vote_count: 5, is_most_voted: false },
      { voted_answers: 'A', vote_count: 0, is_most_voted: false },
    ],
  };

  it('normalises the full question while preserving content', () => {
    const q = normalizeQuestion('Question #: 7', raw);
    expect(q.number).toBe(7);
    expect(q.type).toBe('multiple');
    expect(q.answer).toBe('AC');
    expect(q.choices).toHaveLength(3);
    expect(q.choices[0]?.text).toBe('First');
    expect(q.stem).toEqual([
      { type: 'text', value: 'Which two are correct?' },
      { type: 'break' },
      { type: 'image', src: 'https://img.example.com/q.png' },
    ]);
    expect(q.stemImages).toEqual(['https://img.example.com/q.png']);
    expect(q.votes).toHaveLength(2);
    expect(q.votes[0]).toMatchObject({ answer: 'AC', count: 10, percentage: 67, mostVoted: true });
  });

  it('strips the option label from the rendered content too', () => {
    // The renderer draws the choice key in its own badge, so the label must not
    // survive inside the content or every option reads "A  A. First".
    const q = normalizeQuestion('Question #: 7', raw);
    expect(q.choices[0]?.content).toEqual([{ type: 'text', value: 'First' }]);
    expect(contentToText(q.choices[0]?.content ?? [])).toBe('First');
  });

  it('detects drag-drop questions with no choices', () => {
    const q = normalizeQuestion('Question #: 1', {
      Question: { content: [{ type: 'text', value: 'Drag and drop.' }] },
      Answer: { content: [{ type: 'text', value: 'Suggested Answer: A' }] },
    });
    expect(q.type).toBe('dragdrop');
    expect(q.choices).toHaveLength(0);
  });

  it('hides answers from client payload unless requested', () => {
    const q = normalizeQuestion('Question #: 2', raw);
    expect(toClientQuestion(q).answer).toBeNull();
    expect(toClientQuestion(q, true).answer).toBe('AC');
  });
});

describe('contentToText', () => {
  it('renders text and breaks but not images', () => {
    expect(
      contentToText([
        { type: 'text', value: 'Hello' },
        { type: 'break' },
        { type: 'text', value: 'World' },
        { type: 'image', src: 'x' },
      ]),
    ).toBe('Hello\nWorld');
  });
});