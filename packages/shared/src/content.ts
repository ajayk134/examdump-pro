/**
 * Dataset parsing utilities.
 *
 * The upstream GitHub dataset (exam-data) uses a nested, loosely typed shape.
 * These helpers normalise a single raw question into a stable DTO that the API
 * and web client can rely on, while preserving *every* content item type
 * (text, break, image) so no question format is lost.
 */

export interface RawContentItem {
  type?: string;
  value?: string;
  src?: string;
}

export interface NormalizedContentItem {
  type: 'text' | 'break' | 'image';
  value?: string;
  src?: string;
}

export interface RawChoice {
  content?: RawContentItem[];
}

export interface RawQuestion {
  Title?: string;
  Question?: { content?: RawContentItem[] };
  Choices?: Record<string, RawChoice>;
  Answer?: { content?: RawContentItem[] };
  Explanation?: { content?: RawContentItem[] };
  Vote_count?: Array<{
    voted_answers?: string;
    vote_count?: number;
    is_most_voted?: boolean;
  }>;
}

export interface NormalizedChoice {
  key: string;
  content: NormalizedContentItem[];
  text: string;
  images: string[];
}

export interface NormalizedVote {
  answer: string;
  count: number;
  percentage: number;
  mostVoted: boolean;
}

export type QuestionType = 'single' | 'multiple' | 'dragdrop' | 'unknown';

export interface NormalizedQuestion {
  id: string;
  number: number | null;
  title: string | null;
  type: QuestionType;
  stem: NormalizedContentItem[];
  stemText: string;
  stemImages: string[];
  choices: NormalizedChoice[];
  answer: string;
  answerRaw: string;
  answerText: string;
  explanation: string;
  votes: NormalizedVote[];
}

const normalizeContent = (content: unknown): NormalizedContentItem[] => {
  if (!Array.isArray(content)) return [];
  const out: NormalizedContentItem[] = [];
  for (const raw of content as RawContentItem[]) {
    if (!raw || typeof raw !== 'object') continue;
    const type = raw.type;
    if (type === 'text') {
      out.push({ type: 'text', value: typeof raw.value === 'string' ? raw.value : '' });
    } else if (type === 'image') {
      if (typeof raw.src === 'string' && raw.src.length > 0) {
        out.push({ type: 'image', src: raw.src });
      }
    } else if (type === 'break') {
      out.push({ type: 'break' });
    } else if (typeof raw.value === 'string') {
      // Unknown type with text still preserved as text so nothing is lost.
      out.push({ type: 'text', value: raw.value });
    }
  }
  return out;
};

export const contentToText = (content: NormalizedContentItem[]): string =>
  content
    .map((item) => {
      if (item.type === 'text') return item.value ?? '';
      if (item.type === 'break') return '\n';
      if (item.type === 'image') return '';
      return '';
    })
    .join('')
    .trim();

export const contentImages = (content: NormalizedContentItem[]): string[] =>
  content.filter((i) => i.type === 'image' && i.src).map((i) => i.src as string);

/** Remove a leading option label such as "A.", "B)", "C:" from choice text. */
export const stripOptionPrefix = (text: string, key: string): string => {
  if (!text) return '';
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*${escaped}\\s*[\\.\\):\\-]\\s*`, 'i'), '').trim();
};

/**
 * Extract the canonical answer letters from an Answer block.
 * Handles "Suggested Answer: AB", "Correct Answer: A, C", "Answer: A C", etc.
 */
export const parseAnswerLetters = (answerText: string): string => {
  if (!answerText) return '';
  const labeled = answerText.match(/(?:suggested|correct|answer)\s*[:#-]\s*([A-Za-z](?:[\s,]*[A-Za-z])*)/i);
  const source = labeled?.[1] ?? answerText;
  // Keep only standalone single letters A-Z that look like options.
  const letters = source
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('');
  // De-duplicate while preserving order.
  return Array.from(new Set(letters)).join('');
};

export const questionNumberFromId = (id: string): number | null => {
  const match = id.match(/(\d+)\s*$/);
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
};

export const normalizeQuestion = (id: string, raw: RawQuestion): NormalizedQuestion => {
  const stem = normalizeContent(raw.Question?.content);
  const stemText = contentToText(stem);
  const stemImages = contentImages(stem);

  const choices: NormalizedChoice[] = Object.entries(raw.Choices ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, choice]) => {
      const content = normalizeContent(choice?.content);
      const rawText = contentToText(content);
      return {
        key,
        content,
        text: stripOptionPrefix(rawText, key) || rawText,
        images: contentImages(content),
      };
    });

  const answerRaw = contentToText(normalizeContent(raw.Answer?.content));
  const answer = parseAnswerLetters(answerRaw);
  const explanation = contentToText(normalizeContent(raw.Explanation?.content));

  const rawVotes = Array.isArray(raw.Vote_count) ? raw.Vote_count : [];
  const totalVotes = rawVotes.reduce((sum, v) => sum + (Number(v?.vote_count) || 0), 0);
  const votes: NormalizedVote[] = rawVotes
    .filter((v) => (Number(v?.vote_count) || 0) > 0)
    .map((v) => ({
      answer: (v.voted_answers ?? '').replace(/\s+/g, '').toUpperCase(),
      count: Number(v.vote_count) || 0,
      percentage: totalVotes > 0 ? Math.round(((Number(v.vote_count) || 0) / totalVotes) * 100) : 0,
      mostVoted: Boolean(v.is_most_voted),
    }))
    .sort((a, b) => b.count - a.count);

  const type: QuestionType =
    choices.length === 0
      ? 'dragdrop'
      : answer.length > 1
        ? 'multiple'
        : answer.length === 1
          ? 'single'
          : 'unknown';

  return {
    id,
    number: questionNumberFromId(id),
    title: typeof raw.Title === 'string' ? raw.Title : null,
    type,
    stem,
    stemText,
    stemImages,
    choices,
    answer,
    answerRaw,
    answerText: answerRaw.replace(/\p{Extended_Pictographic}/gu, '').trim(),
    explanation,
    votes,
  };
};

/** A lightweight question without the answer key, safe to send before grading. */
export const toClientQuestion = (q: NormalizedQuestion, includeAnswer = false) => {
  const base = {
    id: q.id,
    number: q.number,
    title: q.title,
    type: q.type,
    stem: q.stem,
    stemText: q.stemText,
    stemImages: q.stemImages,
    choices: q.choices.map((c) => ({ key: c.key, content: c.content, text: c.text, images: c.images })),
    explanation: q.explanation,
  };
  if (!includeAnswer) return { ...base, answer: null, votes: [] as NormalizedVote[] };
  return { ...base, answer: q.answer, answerText: q.answerText, votes: q.votes };
};