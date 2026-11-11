/**
 * NVIDIA NIM powered explanations and tutoring.
 *
 * The API key is read from the environment (injected by Doppler at run time)
 * and never leaves the server. Requests are:
 *   - authenticated + quota limited per user (see routes/ai.ts)
 *   - bounded by a timeout and a max token budget
 *   - retried across a small list of known-good models when a model reports
 *     that it was retired upstream (HTTP 404/410/429)
 *   - degraded gracefully: a deterministic, offline explanation is returned
 *     when the provider is unreachable so the study flow never breaks.
 */
import type { NormalizedQuestion } from '@examdump/shared';
import type { Env } from '../config/env.js';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  text: string;
  model: string;
  provider: 'nvidia' | 'openai' | 'fallback';
  degraded: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  latencyMs: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'AI_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Models known to be served by NVIDIA NIM's hosted endpoint. */
const NVIDIA_FALLBACK_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'meta/llama-3.2-90b-vision-instruct',
];

export function aiConfigured(env: Env): boolean {
  return Boolean(env.AI_API_KEY && env.AI_API_KEY.trim().length > 0);
}

export function aiModelCandidates(env: Env): string[] {
  const list = [env.AI_MODEL, ...NVIDIA_FALLBACK_MODELS];
  return [...new Set(list.filter((m) => typeof m === 'string' && m.trim().length > 0))];
}

interface ChatOptions {
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

async function callChat(env: Env, model: string, options: ChatOptions): Promise<AiResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;

  try {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.3,
        top_p: 0.9,
        max_tokens: options.maxTokens ?? env.AI_MAX_TOKENS,
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const retryable = [404, 410, 429, 503, 504].includes(response.status);
      throw Object.assign(new Error(`AI provider responded ${response.status}`), {
        status: response.status,
        retryable,
        bodyText: bodyText.slice(0, 500),
      });
    }

    const data = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw Object.assign(new Error('AI provider returned an empty completion'), { retryable: true });

    return {
      text,
      model: data.model ?? model,
      provider: env.AI_PROVIDER === 'openai' ? 'openai' : 'nvidia',
      degraded: false,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const error = err as Error & { status?: number; retryable?: boolean };
    if (error.name === 'AbortError') {
      throw new AiError('The AI request timed out. Please try again.', 504, 'AI_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a chat completion, walking the model fallback list. Throws AiError when
 * every model fails.
 */
export async function chat(env: Env, options: ChatOptions): Promise<AiResult> {
  if (!aiConfigured(env)) {
    throw new AiError('AI assistance is not configured on this server.', 503, 'AI_NOT_CONFIGURED');
  }

  let lastError: unknown;
  for (const model of aiModelCandidates(env)) {
    try {
      return await callChat(env, model, options);
    } catch (err) {
      lastError = err;
      const e = err as { retryable?: boolean; status?: number };
      if (e.retryable === false && e.status && e.status < 500 && e.status !== 404 && e.status !== 410) {
        break;
      }
    }
  }
  const e = lastError as Error & { status?: number };
  if (e instanceof AiError) throw e;
  throw new AiError(
    e?.status === 429
      ? 'The AI assistant is busy right now. Please retry in a moment.'
      : 'The AI assistant is temporarily unavailable.',
    502,
    'AI_UNAVAILABLE',
  );
}

/* ------------------------------------------------------------------ */
/* Prompt construction                                                 */
/* ------------------------------------------------------------------ */

export function buildExplanationMessages(
  question: NormalizedQuestion,
  context: { examTitle: string; examCode: string; providerTitle: string; learnerChoice?: string[] },
): AiMessage[] {
  const choices = question.choices
    .map((c) => `${c.key}. ${c.text || (c.images.length ? '[image option]' : '(blank)')}`)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You are a certified exam tutor for IT, cloud and security certifications. ' +
        'Explain answers precisely and accurately. Use plain conversational English. ' +
        'Never invent facts about the exam. Keep answers focused and under 250 words.',
    },
    {
      role: 'user',
      content: [
        `Exam: ${context.examCode} (${context.examTitle})`,
        `Provider: ${context.providerTitle}`,
        question.title ? `Scenario: ${question.title}` : '',
        `Question: ${question.stemText}`,
        choices ? `Choices:\n${choices}` : 'This item has no listed choices.',
        `Correct answer: ${question.answerText || question.answer || 'not provided'}`,
        question.explanation ? `Reference explanation: ${question.explanation}` : '',
        context.learnerChoice?.length
          ? `The learner picked: ${context.learnerChoice.join(', ')}. Address that choice directly.`
          : '',
        '',
        'Write the explanation in exactly three short paragraphs:',
        '1. Why the correct answer is right.',
        '2. Why the most tempting wrong answers are wrong (when applicable).',
        '3. A one-line memory hook or real-world example.',
        'Return plain text only, no markdown headings or bullet symbols.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export function buildHintMessages(
  question: NormalizedQuestion,
  context: { examTitle: string; examCode: string; providerTitle: string },
): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are an exam coach. Give a nudge without revealing the answer. ' +
        'Maximum 60 words, plain text only.',
    },
    {
      role: 'user',
      content: [
        `Exam: ${context.examCode} (${context.examTitle}) - ${context.providerTitle}`,
        `Question: ${question.stemText}`,
        question.choices.length
          ? `Choices:\n${question.choices.map((c) => `${c.key}. ${c.text}`).join('\n')}`
          : 'No choice list for this item.',
        '',
        'Give one hint that points to the concepts to consider. Do not name the correct option.',
      ].join('\n'),
    },
  ];
}

/**
 * Deterministic fallback explanation used when the AI provider is unavailable.
 * It is derived purely from the dataset (answer + stored explanation) so the
 * learner still gets useful, truthful guidance.
 */
export function offlineExplanation(
  question: NormalizedQuestion,
  exam: { code: string; title: string },
): string {
  const answerText = question.answerText || question.answer || 'see reference';
  const parts = [
    `The correct answer for this ${exam.code} item is ${answerText}.`,
    question.explanation
      ? `Reference explanation: ${question.explanation}`
      : 'The dataset does not include a written explanation for this item yet.',
    'AI assistance is temporarily unavailable, so this is the verified dataset explanation. Try again shortly for a detailed AI walkthrough.',
  ];
  return parts.join('\n\n');
}
