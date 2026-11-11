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

/**
 * Models verified against NVIDIA NIM's hosted endpoint (benchmarked on Cisco
 * and CompTIA practice questions: first-token latency, streamed frame count,
 * answer accuracy and usable output length).
 *
 * The primary model is `nemotron-3-nano-omni-...-reasoning`: it is the only
 * fast model that streams a separate `reasoning_content` channel, so the UI can
 * show a reasoning summary without ever exposing raw chain-of-thought.
 *
 * Excluded after measurement: `deepseek-ai/deepseek-v4.1-flash` and
 * `z-ai/glm-5.3-flash` are listed by GET /v1/models but hang with no response.
 * `nemotron-3-ultra-550b-a55b` and `minimax-m3.1-flash` intermittently stop
 * responding entirely (75s+ with no bytes), so they cannot be the default.
 * `nemotron-3.5-lightning` returns reasoning tokens but streams no visible
 * answer, which looks like a broken reply to a user.
 */
const NVIDIA_FALLBACK_MODELS = [
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'meta/llama-3.2-90b-vision-instruct',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'minimaxai/minimax-m3.1-flash',
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

/* ------------------------------------------------------------------ */
/* Streaming chat                                                      */
/* ------------------------------------------------------------------ */

export interface StreamChunk {
  /**
   * `reasoning_start` / `reasoning_end` bracket the model-authored reasoning
   * summary so a client can render it in a separate, collapsible panel. Raw
   * chain-of-thought is never forwarded; only what the provider publishes as
   * `reasoning_content` is passed through.
   */
  type: 'delta' | 'done' | 'error' | 'reasoning_start' | 'reasoning_end';
  /**
   * `delta` carries the user-visible answer. `reasoning` carries a short,
   * model-authored summary stream that the UI shows in a separate, collapsed
   * panel. It is never mixed into the answer text.
   */
  channel?: 'answer' | 'reasoning';
  text?: string;
  model?: string;
  degraded?: boolean;
  message?: string;
  /** Why the provider stopped: `stop`, `length` (token cap) or `content_filter`. */
  finishReason?: string;
}

/**
 * Stream a completion as server-sent-event friendly chunks.
 *
 * Only the first model that responds with a 2xx is used; if it fails before
 * any token is emitted we fall back to the next candidate. Once tokens have
 * been yielded a failure is surfaced as an error chunk instead of silently
 * restarting, so the client never sees duplicated text.
 */
export async function* streamChat(
  env: Env,
  options: ChatOptions,
): AsyncGenerator<StreamChunk> {
  if (!aiConfigured(env)) {
    yield { type: 'error', message: 'AI assistance is not configured on this server.' };
    return;
  }

  let lastError: unknown;
  for (const model of aiModelCandidates(env)) {
    let emitted = false;
    // A provider "busy" (429) or gateway blip (503) is often gone a second
    // later, so give the same model one more chance after a short backoff
    // before dropping to the next candidate. Only retried while nothing has
    // been emitted, so the client never receives duplicated text.
    for (let attempt = 1; ; attempt += 1) {
    try {
      for await (const chunk of streamModel(env, model, options)) {
        emitted = true;
        yield chunk;
      }
      return;
    } catch (err) {
      lastError = err;
      if (emitted) {
        yield {
          type: 'error',
          message: 'The response was interrupted. Please try again.',
        };
        return;
      }
      const e = err as { retryable?: boolean; status?: number };
      if (e.status && e.status < 500 && e.status !== 404 && e.status !== 410 && e.status !== 429) break;
      if (emitted || attempt >= 2) break;
      const retryableStatus = e.status === 429 || e.status === 503 || e.status === 504 || !e.status;
      if (!retryableStatus) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
    }
  }

  const e = lastError as { status?: number };
  yield {
    type: 'error',
    message:
      e?.status === 429
        ? 'The AI tutor is busy right now. Please retry in a moment.'
        : 'The AI tutor is temporarily unavailable. Please try again.',
  };
}

async function* streamModel(
  env: Env,
  model: string,
  options: ChatOptions,
): AsyncGenerator<StreamChunk> {
  const started = Date.now();
  const controller = new AbortController();
  // This bounds time-to-first-token only. Reasoning models can legitimately
  // think for tens of seconds, so the timer is cleared as soon as the response
  // headers arrive rather than aborting a healthy long stream.
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;

  try {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.35,
        top_p: 0.9,
        max_tokens: options.maxTokens ?? env.AI_MAX_TOKENS,
        stream: true,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw Object.assign(new Error(`AI provider responded ${response.status}`), {
        status: response.status,
        retryable: [404, 410, 429, 503, 504].includes(response.status),
      });
    }

    clearTimeout(timeout);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; keep the trailing partial.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  /** Only some NVIDIA models expose this; it is a model-authored
                   *  summary, not the raw internal chain of thought. */
                  reasoning_content?: string | null;
                };
                finish_reason?: string | null;
              }>;
            };
            const choice = parsed.choices?.[0];
            const reasoning = choice?.delta?.reasoning_content;
            if (reasoning) yield { type: 'delta', channel: 'reasoning', text: reasoning };
            const text = choice?.delta?.content;
            if (text) yield { type: 'delta', channel: 'answer', text };
            if (choice?.finish_reason) {
              // `length` means the provider hit the max-token ceiling; the
              // answer is complete as far as it will get.
              finishReason = choice.finish_reason;
            }
          } catch {
            // Ignore malformed keepalive frames.
          }
        }
      }
    }

    yield { type: 'done', model, degraded: false, finishReason: finishReason ?? 'stop' };
    void started;
  } catch (err) {
    const error = err as Error & { status?: number };
    if (error.name === 'AbortError') {
      // The provider hit our time budget after already emitting tokens. Treat
      // this as a finished (possibly partial) answer rather than an error so
      // the learner keeps what was streamed instead of losing the turn.
      yield { type: 'done', model, degraded: true, finishReason: 'timeout' };
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* Tutor prompts                                                       */
/* ------------------------------------------------------------------ */

const TUTOR_SYSTEM_PROMPT = [
  'You are ExamDump\'s certification tutor: a patient, precise subject-matter expert.',
  'Rules:',
  '- Answer in clear Markdown. Use short paragraphs, bullet lists and bold key terms.',
  '- When maths, formulas or subnetting arithmetic appears, wrap it in $...$ (inline) or $$...$$ (block) LaTeX.',
  '- If the learner asks why an option is wrong, address each distractor they mention.',
  '- Prefer step-by-step reasoning: state the principle, apply it to the scenario, then conclude.',
  '- Offer a short memory trick or mnemonic when it genuinely helps.',
  '- Never invent exam facts, version numbers or product behaviour you are unsure about.',
  '- Keep answers focused; do not pad with flattery or filler.',
].join('\n');

export interface TutorContext {
  examCode?: string | null;
  examTitle?: string | null;
  providerTitle?: string | null;
  questionStem?: string | null;
  questionChoices?: Array<{ key: string; text: string }> | null;
  correctAnswer?: string | null;
  referenceExplanation?: string | null;
  learnerChoice?: string[] | null;
}

/** Build the system message describing the question under discussion. */
export function buildTutorSystemPrompt(context: TutorContext): string {
  const lines = [TUTOR_SYSTEM_PROMPT];
  const header: string[] = [];
  if (context.examCode) {
    header.push(`Exam: ${context.examCode}${context.examTitle ? ` - ${context.examTitle}` : ''}`);
  }
  if (context.providerTitle) header.push(`Vendor: ${context.providerTitle}`);

  if (header.length) lines.push('', 'Current exam context:', ...header);

  if (context.questionStem) {
    lines.push('', 'Question under discussion:', context.questionStem);
    if (context.questionChoices?.length) {
      lines.push(
        'Answer choices:',
        ...context.questionChoices.map((c) => `${c.key}. ${c.text || '[image option]'}`),
      );
    }
    if (context.correctAnswer) lines.push(`Verified correct answer: ${context.correctAnswer}`);
    if (context.referenceExplanation) {
      lines.push(`Reference explanation from the source: ${context.referenceExplanation}`);
    }
    if (context.learnerChoice?.length) {
      lines.push(`The learner selected: ${context.learnerChoice.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** Suggested follow-ups surfaced in the chat UI. */
export function suggestedPrompts(hasQuestion: boolean): string[] {
  if (hasQuestion) {
    return [
      'Explain the correct answer step by step',
      'Why are the other options wrong?',
      'Give me a real-world example',
      'Memory trick to remember this',
    ];
  }
  return [
    'Explain a concept I am struggling with',
    'Make me a 5-question quiz on this exam',
    'What topics should I study first?',
    'Summarise the hardest subnetting rules',
  ];
}
