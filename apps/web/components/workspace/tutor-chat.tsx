'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AiTutorMode } from '@examdump/shared';
import { ApiError, get, post, streamPost } from '@/lib/api';
import type { AiConversation, AiConversationDetail, ChatMessage } from '@/lib/types';
import { Markdown } from '../markdown';
import { IconArrowRight, IconCopy, IconPlus, IconRefresh, IconSend, IconSparkles, IconStop } from '../icons';
import { cn } from '@/lib/format';
import { getAiModePreference, setAiModePreference } from '@/lib/local-store';
import { useAuth, useToast } from '../providers';

const MODES: ReadonlyArray<{ id: AiTutorMode; label: string }> = [
  { id: 'step', label: 'Step by step' },
  { id: 'socratic', label: 'Socratic' },
  { id: 'simple', label: 'Plain English' },
  { id: 'example', label: 'Real world' },
  { id: 'quiz', label: 'Quiz me' },
];

const QUESTION_PROMPTS = [
  'Why are the other options wrong?',
  'Give me a memory hook for this',
  'Explain it with a real-world example',
];

function Avatar({ size = 26 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 via-accent-2 to-accent-3 text-white shadow-sm"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <IconSparkles width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />
    </span>
  );
}

function isMode(value: unknown): value is AiTutorMode {
  return typeof value === 'string' && MODES.some((mode) => mode.id === value);
}

/**
 * Compact tutor for the study companion.
 *
 * Threads are anchored to the current question and resumed automatically, so
 * the conversation survives page changes inside the workspace. Answers render
 * as open prose rather than cards; the composer and its follow-ups stay
 * together at the bottom.
 */
export function TutorChat({
  providerId,
  examKey,
  questionId,
  examLabel,
  learnerChoice,
  aiEnabled,
  remaining,
  onConsumed,
  onOpenHint,
  onOpenExplain,
}: {
  providerId: string;
  examKey: string;
  questionId?: string;
  examLabel?: string;
  learnerChoice?: string[];
  aiEnabled: boolean;
  remaining: number | null;
  onConsumed: () => void;
  onOpenHint: () => void;
  onOpenExplain: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(QUESTION_PROMPTS);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limitReached, setLimitReached] = useState(false);
  const [mode, setMode] = useState<AiTutorMode>('step');
  const [resumed, setResumed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const stick = useRef(true);

  useEffect(() => {
    const stored = getAiModePreference();
    if (isMode(stored)) setMode(stored);
  }, []);

  useEffect(() => {
    if (remaining !== null && remaining <= 0) setLimitReached(true);
  }, [remaining]);

  const scrollToBottom = useCallback((smooth = true) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stick.current = true;
  }, []);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  };

  useEffect(() => {
    if (!stick.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(frame);
  }, [messages, scrollToBottom]);

  const loadConversation = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await get<AiConversationDetail>(`/ai/chat/conversations/${id}`);
      setMessages(
        data.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          model: message.model ?? null,
          degraded: message.degraded,
          createdAt: message.createdAt,
        })),
      );
      if (data.suggestions?.length) setSuggestions(data.suggestions);
      setConversationId(id);
    } catch {
      /* an unreadable thread can still be replaced by a new one */
    } finally {
      setLoading(false);
      stick.current = true;
    }
  }, []);

  // Resume the thread for this question, or start clean when the cursor moves.
  useEffect(() => {
    abort.current?.abort();
    setConversationId(undefined);
    setMessages([]);
    setError('');
    setResumed(false);
    setSuggestions(QUESTION_PROMPTS);
    if (!questionId || !user) return;
    let cancelled = false;
    const params = new URLSearchParams({ provider: providerId, exam: examKey, questionId });
    setLoading(true);
    get<{ conversation: AiConversation | null }>(`/ai/chat/by-question?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        if (data.conversation) {
          setResumed(true);
          void loadConversation(data.conversation.id);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, questionId, user, loadConversation]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streaming || limitReached || !user) return;
      setError('');
      setInput('');
      stick.current = true;

      const userMessage: ChatMessage = { id: `local-u-${Date.now()}`, role: 'user', content: text };
      const assistantId = `local-a-${Date.now()}`;
      setMessages((previous) => [
        ...previous,
        userMessage,
        { id: assistantId, role: 'assistant', content: '', pending: true },
      ]);
      setStreaming(true);

      const patch = (update: (message: ChatMessage) => ChatMessage) =>
        setMessages((previous) =>
          previous.map((message) => (message.id === assistantId ? update(message) : message)),
        );

      try {
        let target = conversationId;
        if (!target) {
          const created = await post<{ conversation: AiConversation; suggestions: string[] }>(
            '/ai/chat/conversations',
            { provider: providerId, exam: examKey, questionId },
          );
          target = created.conversation.id;
          setConversationId(target);
          if (created.suggestions?.length) setSuggestions(created.suggestions);
        }

        const controller = new AbortController();
        abort.current = controller;
        await streamPost(
          `/ai/chat/conversations/${target}/messages`,
          {
            message: text,
            mode,
            ...(learnerChoice && learnerChoice.length > 0 ? { learnerChoice } : {}),
          },
          {
            onDelta: (fragment) => patch((message) => ({ ...message, content: message.content + fragment })),
            onReasoningStart: () => patch((message) => ({ ...message, reasoningStreaming: true })),
            onReasoning: (fragment) =>
              patch((message) => ({
                ...message,
                reasoning: (message.reasoning ?? '') + fragment,
                reasoningStreaming: true,
              })),
            onReasoningEnd: () => patch((message) => ({ ...message, reasoningStreaming: false })),
            onDone: () => {
              patch((message) => ({ ...message, pending: false, reasoningStreaming: false }));
              onConsumed();
            },
            onError: (message) => {
              if (/limit|quota/i.test(message)) setLimitReached(true);
              patch((assistant) => ({
                ...assistant,
                pending: false,
                reasoningStreaming: false,
                error: message,
              }));
            },
          },
          controller.signal,
        );
      } catch (err) {
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (aborted) {
          patch((message) => ({ ...message, pending: false, reasoningStreaming: false, stopped: true }));
        } else {
          const message =
            err instanceof ApiError ? err.message : (err as Error).message || 'The tutor is unavailable.';
          if (err instanceof ApiError && err.status === 403) setLimitReached(true);
          patch((assistant) => ({
            ...assistant,
            pending: false,
            reasoningStreaming: false,
            error: message,
          }));
        }
      } finally {
        setStreaming(false);
        abort.current = null;
        inputRef.current?.focus();
      }
    },
    [conversationId, streaming, limitReached, user, providerId, examKey, questionId, mode, learnerChoice, onConsumed],
  );

  const startNew = () => {
    abort.current?.abort();
    setConversationId(undefined);
    setMessages([]);
    setError('');
    setResumed(false);
    setSuggestions(QUESTION_PROMPTS);
    inputRef.current?.focus();
  };

  const copy = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  };

  const hasMessages = messages.length > 0;
  const last = messages[messages.length - 1];
  const showSuggestions = suggestions.length > 0 && !streaming && !loading && !limitReached && !last?.pending;
  const remainingLabel = typeof remaining === 'number' ? `${remaining} left today` : null;

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <Avatar size={40} />
        <p className="mt-3 text-sm font-semibold text-content-primary">Sign in to talk it through</p>
        <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-content-muted">
          Hints are open to preview. The full tutor keeps the question in context and remembers your thread.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/practice/session?provider=${providerId}&exam=${examKey}`)}`}
          className="btn-primary btn-sm mt-4"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-border/60 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold text-content-primary">
            {resumed ? 'Continuing this question’s thread' : 'Tutor for this question'}
          </p>
          <p className="truncate text-[0.625rem] text-content-muted">
            {examLabel ?? examKey}
            {remainingLabel ? ` · ${remainingLabel}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="grid h-8 w-8 place-items-center rounded-full text-content-muted hover:bg-surface-overlay hover:text-content-primary"
          aria-label="Start a new conversation"
          title="New conversation"
        >
          <IconPlus width={15} height={15} />
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 py-4">
          {loading && !hasMessages ? (
            <div className="space-y-3" role="status" aria-label="Loading conversation">
              <div className="ml-auto h-8 w-2/5 skeleton rounded-2xl" />
              <div className="h-20 w-full skeleton rounded-xl" />
            </div>
          ) : !hasMessages ? (
            <div className="flex flex-col items-center py-5 text-center">
              <Avatar size={40} />
              <p className="mt-3 text-sm font-semibold text-content-primary">Stuck on this one?</p>
              <p className="mt-1 max-w-[17rem] text-xs leading-relaxed text-content-muted">
                Ask for a nudge, compare the options, or make the concept stick — the question and your
                selection stay in context.
              </p>
              <div className="mt-4 grid w-full gap-1.5">
                <button
                  type="button"
                  onClick={onOpenHint}
                  className="flex min-h-10 items-center justify-between rounded-xl bg-accent/[0.06] px-3 text-left text-xs font-semibold text-content-secondary transition-colors hover:bg-accent/[0.1] hover:text-content-primary"
                >
                  <span className="inline-flex items-center gap-2">
                    <IconSparkles width={14} height={14} className="text-accent" /> Start with a hint
                  </span>
                  <IconArrowRight width={13} height={13} className="text-accent" />
                </button>
                <button
                  type="button"
                  onClick={onOpenExplain}
                  className="flex min-h-10 items-center justify-between rounded-xl bg-surface-overlay/55 px-3 text-left text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary"
                >
                  <span>Unpack after you answer</span>
                  <IconArrowRight width={13} height={13} />
                </button>
                <button
                  type="button"
                  onClick={() => void send('Quiz me on the concept behind this question, one short question at a time.')}
                  className="flex min-h-10 items-center justify-between rounded-xl bg-surface-overlay/55 px-3 text-left text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary"
                >
                  <span>Quiz me instead</span>
                  <IconArrowRight width={13} height={13} />
                </button>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-4" aria-label="Conversation">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <li key={message.id} className="flex justify-end">
                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[0.8125rem] leading-relaxed text-[rgb(var(--accent-contrast))]">
                      {message.content}
                    </div>
                  </li>
                ) : (
                  <li key={message.id} className="flex gap-2.5">
                    <Avatar />
                    <div className="min-w-0 flex-1">
                      <div className="answer-prose text-[0.8125rem]">
                        {message.content ? (
                          <>
                            <Markdown content={message.content} />
                            {message.pending ? <span className="caret" aria-hidden="true" /> : null}
                          </>
                        ) : message.error ? null : (
                          <span className="inline-flex items-center gap-1.5 py-0.5 text-[0.6875rem] text-content-muted">
                            <span className="dot-pulse text-accent" aria-hidden="true" />
                            Working it through...
                          </span>
                        )}
                        {message.error ? (
                          <p className="mt-1 rounded-lg bg-negative/[0.07] px-2.5 py-1.5 text-[0.6875rem] text-negative">
                            {message.error}
                          </p>
                        ) : null}
                      </div>
                      {!message.pending ? (
                        <div className="mt-1 flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => void copy(message)}
                            className="grid h-7 w-7 place-items-center rounded-md text-content-muted hover:bg-surface-overlay hover:text-content-primary"
                            aria-label="Copy answer"
                            title="Copy"
                          >
                            <IconCopy width={13} height={13} />
                          </button>
                          {message.id === last?.id && !streaming ? (
                            <button
                              type="button"
                              onClick={() => {
                                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                                if (!lastUser) return;
                                setMessages((previous) =>
                                  previous.filter((m) => m.id !== message.id),
                                );
                                void send(lastUser.content);
                              }}
                              className="grid h-7 w-7 place-items-center rounded-md text-content-muted hover:bg-surface-overlay hover:text-content-primary"
                              aria-label="Regenerate answer"
                              title="Regenerate"
                            >
                              <IconRefresh width={13} height={13} />
                            </button>
                          ) : null}
                          {copiedId === message.id ? (
                            <span className="ml-1 text-[0.625rem] font-semibold text-positive" role="status">
                              Copied
                            </span>
                          ) : null}
                          {message.stopped ? (
                            <span className="ml-1 text-[0.625rem] text-content-muted">Stopped</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ),
              )}
            </ol>
          )}

          {error ? (
            <p className="mt-3 rounded-xl bg-negative/[0.07] px-3 py-2 text-xs text-negative" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {limitReached ? (
        <div className="mx-3 mb-1 rounded-xl bg-caution/[0.08] px-3 py-2 text-[0.6875rem] text-content-secondary">
          Daily AI messages used.{' '}
          <Link href="/pricing" className="font-semibold text-accent hover:underline">
            See plans
          </Link>
        </div>
      ) : showSuggestions ? (
        <div className="shrink-0 px-3 pb-1 pt-2">
          <div className="flex flex-wrap gap-1">
            {suggestions.slice(0, 3).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="max-w-full rounded-full border border-surface-border bg-surface-raised px-2.5 py-1 text-left text-[0.6875rem] font-medium leading-snug text-content-secondary transition-colors hover:border-accent/40 hover:text-content-primary"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="shrink-0 px-3 pb-3 pt-1.5" aria-label="Message the tutor">
        <div className="rounded-2xl border border-surface-border-strong bg-surface-base p-1.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            disabled={limitReached || !aiEnabled}
            placeholder={limitReached ? 'Daily AI limit reached' : 'Ask a follow-up...'}
            aria-label="Message the tutor"
            className="max-h-28 min-h-9 w-full resize-none bg-transparent px-1.5 py-1.5 text-[0.875rem] leading-relaxed text-content-primary outline-none placeholder:text-content-muted disabled:cursor-not-allowed disabled:opacity-60"
            onInput={(event) => {
              const element = event.currentTarget;
              element.style.height = 'auto';
              element.style.height = `${Math.min(element.scrollHeight, 112)}px`;
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <label className="sr-only" htmlFor={`tutor-mode-${questionId ?? 'general'}`}>
              Teaching style
            </label>
            <select
              id={`tutor-mode-${questionId ?? 'general'}`}
              value={mode}
              onChange={(event) => {
                const next = event.target.value;
                if (!isMode(next)) return;
                setMode(next);
                setAiModePreference(next);
              }}
              disabled={streaming || limitReached}
              className="max-w-[8.5rem] cursor-pointer truncate rounded-full bg-surface-overlay/70 px-2.5 py-1 text-[0.6875rem] font-semibold text-content-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {MODES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>

            {streaming ? (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface-overlay px-3 text-[0.6875rem] font-semibold text-content-secondary hover:text-content-primary"
              >
                <IconStop width={13} height={13} /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || limitReached || !aiEnabled}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[rgb(var(--accent-contrast))] disabled:opacity-40"
                aria-label="Send message"
              >
                <IconSend width={15} height={15} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 px-1 text-center text-[0.5625rem] text-content-muted">
          AI can make mistakes — verify with the official exam guide.
        </p>
      </form>
    </div>
  );
}