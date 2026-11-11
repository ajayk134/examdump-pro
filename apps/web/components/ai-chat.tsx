'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { del, get, patch, post, streamPost, ApiError } from '@/lib/api';
import type { AiConversation, AiConversationDetail, ChatMessage } from '@/lib/types';
import { Markdown } from './markdown';
import { Alert, Spinner } from './ui';
import {
  IconChevronDown,
  IconCopy,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconStop,
  IconTrash,
} from './icons';
import { cn } from '@/lib/format';

const STARTER_PROMPTS = [
  'Explain this concept from the basics',
  'Make me a 5-question quiz on this exam',
  'What topics should I study first?',
  'Give me a memory trick for the hardest topic',
];

interface ChatPanelProps {
  /** Existing conversation to open. */
  conversationId?: string;
  /** Exam anchor for a brand-new conversation. */
  providerId?: string;
  examKey?: string;
  questionId?: string;
  examLabel?: string;
  /** Compact layout used inside the question drawer. */
  embedded?: boolean;
  onConversationCreated?: (id: string) => void;
  onClose?: () => void;
}

export function AiChat({
  conversationId: initialConversationId,
  providerId,
  examKey,
  questionId,
  examLabel,
  embedded = false,
  onConversationCreated,
  onClose,
}: ChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialConversationId));
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const anchored = Boolean(providerId && examKey);
  const questionAnchored = Boolean(questionId);

  /* ---------------------------------------------------------------- */
  /* Data loading                                                      */
  /* ---------------------------------------------------------------- */

  const loadConversation = useCallback(async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await get<AiConversationDetail>(`/ai/chat/conversations/${id}`);
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model ?? null,
          degraded: m.degraded,
          createdAt: m.createdAt,
        })),
      );
      setSuggestions(data.suggestions ?? []);
      setConversationId(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this conversation.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await get<{ conversations: AiConversation[] }>('/ai/chat/conversations');
      setConversations(data.conversations ?? []);
    } catch {
      /* history is non-critical */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (initialConversationId) void loadConversation(initialConversationId);
  }, [initialConversationId, loadConversation]);

  useEffect(() => {
    if (!anchored) return;
    setSuggestions(
      questionAnchored
        ? [
            'Explain the correct answer step by step',
            'Why are the other options wrong?',
            'Give me a real-world example',
            'Memory trick to remember this',
          ]
        : STARTER_PROMPTS,
    );
  }, [anchored, questionAnchored]);

  /* ---------------------------------------------------------------- */
  /* Auto-scroll                                                       */
  /* ---------------------------------------------------------------- */

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /* ---------------------------------------------------------------- */
  /* Send                                                              */
  /* ---------------------------------------------------------------- */

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streaming) return;

      setError('');
      setInput('');

      // Optimistic learner turn + empty assistant turn that fills as we stream.
      const userMessage: ChatMessage = {
        id: `local-u-${Date.now()}`,
        role: 'user',
        content: text,
      };
      const assistantId = `local-a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: 'assistant', content: '', pending: true },
      ]);
      setStreaming(true);

      const appendDelta = (fragment: string) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + fragment } : m)),
        );

      try {
        let target = conversationId;
        if (!target) {
          if (!providerId || !examKey) throw new Error('Choose an exam before asking the AI tutor.');
          const created = await post<{ conversation: AiConversation; suggestions: string[] }>(
            '/ai/chat/conversations',
            { provider: providerId, exam: examKey, questionId },
          );
          target = created.conversation.id;
          setConversationId(target);
          setSuggestions(created.suggestions ?? []);
          onConversationCreated?.(target);
        }

        const controller = new AbortController();
        abortRef.current = controller;

        await streamPost(
          `/ai/chat/conversations/${target}/messages`,
          { message: text },
          {
            onDelta: appendDelta,
            onDone: () =>
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
              ),
            onError: (message) =>
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, pending: false, error: message, content: m.content }
                    : m,
                ),
              ),
          },
          controller.signal,
        );

        // Drop an empty assistant bubble if the provider failed immediately.
        setMessages((prev) =>
          prev.filter((m) => !(m.id === assistantId && !m.content && !m.error)),
        );
        void loadHistory();
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error && err.name === 'AbortError'
              ? ''
              : (err as Error).message || 'The AI tutor is unavailable.';
        if (message) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, pending: false, error: message } : m,
            ),
          );
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [conversationId, streaming, providerId, examKey, questionId, onConversationCreated, loadHistory],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
  }, []);

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

  const startNew = useCallback(() => {
    stop();
    setConversationId(undefined);
    setMessages([]);
    setError('');
    setHistoryOpen(false);
    setSuggestions(anchored ? STARTER_PROMPTS : []);
    inputRef.current?.focus();
  }, [anchored, stop]);

  const copyMessage = useCallback(async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((c) => (c === message.id ? null : c)), 1600);
    } catch {
      /* clipboard blocked; ignore */
    }
  }, []);

  const regenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((prev) => {
      const lastAssistant = [...prev].reverse().find((m) => m.role === 'assistant');
      return lastAssistant ? prev.filter((m) => m.id !== lastAssistant.id) : prev;
    });
    void send(lastUser.content);
  }, [messages, send]);

  // Stop the stream when the panel unmounts so we never write to a dead tree.
  useEffect(() => () => abortRef.current?.abort(), []);

  const hasMessages = messages.length > 0;
  const lastMessage = messages[messages.length - 1];
  const showSuggestions = suggestions.length > 0 && (!hasMessages || (!streaming && !lastMessage?.pending));

  const headerTitle = useMemo(() => {
    if (conversationId) {
      const found = conversations.find((c) => c.id === conversationId);
      if (found) return found.title;
    }
    return questionId ? 'Ask about this question' : examLabel ? `AI tutor · ${examLabel}` : 'AI tutor';
  }, [conversationId, conversations, questionId, examLabel]);

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col',
        embedded ? 'h-full' : 'h-[calc(100dvh-9rem)] min-h-[520px]',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-sky-400 text-white shadow-sm">
          <IconSparkles width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content-primary">{headerTitle}</p>
          <p className="truncate text-xs text-content-muted">
            {questionAnchored ? 'Grounded in this question' : 'Certification tutor'}
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="btn-ghost !px-2 !py-1.5"
          aria-label="New conversation"
          title="New conversation"
        >
          <IconPlus width={18} height={18} />
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="btn-ghost !px-2 !py-1.5"
          aria-label="Conversation history"
          aria-expanded={historyOpen}
          title="History"
        >
          <IconChevronDown width={18} height={18} />
        </button>
        {onClose ? (
          <button type="button" onClick={onClose} className="btn-ghost !px-2 !py-1.5" aria-label="Close">
            ✕
          </button>
        ) : null}
      </div>

      {/* History drawer */}
      {historyOpen ? (
        <div className="max-h-56 overflow-y-auto border-b border-surface-border bg-surface-overlay/50 px-2 py-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-content-muted">No conversations yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => (
                <li key={c.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      void loadConversation(c.id);
                    }}
                    className={cn(
                      'min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-overlay',
                      c.id === conversationId
                        ? 'bg-brand-500/10 font-semibold text-brand-700 dark:text-brand-200'
                        : 'text-content-secondary',
                    )}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${c.title}`}
                    className="rounded-lg p-1.5 text-content-muted transition hover:bg-rose-500/10 hover:text-rose-500"
                    onClick={async () => {
                      await del(`/ai/chat/conversations/${c.id}`).catch(() => undefined);
                      setConversations((prev) => prev.filter((x) => x.id !== c.id));
                      if (c.id === conversationId) startNew();
                    }}
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <Spinner label="Loading conversation…" />
        ) : !hasMessages ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-sky-400 text-white shadow-lg shadow-brand-500/25">
              <IconSparkles width={22} height={22} />
            </span>
            <div>
              <p className="text-base font-semibold text-content-primary">
                Ask anything about this {questionAnchored ? 'question' : 'exam'}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-content-muted">
                Step-by-step reasoning, why distractors are wrong, examples and memory tricks.
              </p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn('flex gap-2.5', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {message.role === 'assistant' ? (
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-sky-400 text-white">
                    <IconSparkles width={14} height={14} />
                  </span>
                ) : null}
                <div className={cn('min-w-0 max-w-[92%]', message.role === 'user' && 'max-w-[85%]')}>
                  {message.role === 'user' ? (
                    <div className="rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm">
                      {message.content}
                    </div>
                  ) : (
                    <div className="rounded-2xl rounded-bl-md border border-surface-border bg-surface-raised px-3.5 py-2.5 shadow-sm">
                      {message.content ? (
                        <Markdown content={message.content} className="text-sm" />
                      ) : message.error ? null : (
                        <span className="inline-flex items-center gap-1.5 py-1 text-xs text-content-muted">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
                          Thinking…
                        </span>
                      )}
                      {message.pending && message.content ? (
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-brand-400 align-middle" />
                      ) : null}
                      {message.error ? (
                        <p className="mt-1 rounded-lg bg-rose-500/10 px-2 py-1.5 text-xs text-rose-600 dark:text-rose-300">
                          {message.error}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {message.role === 'assistant' && !message.pending ? (
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void copyMessage(message)}
                        className="rounded-md p-1.5 text-content-muted transition hover:bg-surface-overlay hover:text-content-primary"
                        aria-label="Copy answer"
                        title="Copy"
                      >
                        <IconCopy width={14} height={14} />
                      </button>
                      {message.id === lastMessage?.id ? (
                        <button
                          type="button"
                          onClick={regenerate}
                          className="rounded-md p-1.5 text-content-muted transition hover:bg-surface-overlay hover:text-content-primary"
                          aria-label="Regenerate answer"
                          title="Regenerate"
                        >
                          <IconRefresh width={14} height={14} />
                        </button>
                      ) : null}
                      {copiedId === message.id ? (
                        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          Copied
                        </span>
                      ) : null}
                      {message.degraded ? (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          offline explanation
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        {error ? (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
      </div>

      {/* Suggestions */}
      {showSuggestions ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              disabled={streaming}
              onClick={() => void send(s)}
              className="rounded-full border border-surface-border bg-surface-overlay px-3 py-1.5 text-xs font-medium text-content-secondary transition hover:border-brand-400/60 hover:text-content-primary disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {/* Composer */}
      <form onSubmit={onSubmit} className="border-t border-surface-border p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-surface-border bg-surface-base/80 p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-400/25">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            placeholder="Ask a follow-up question…"
            aria-label="Message the AI tutor"
            className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-content-primary outline-none placeholder:text-content-muted"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="btn-secondary !rounded-xl !px-3 !py-2"
              aria-label="Stop generating"
            >
              <IconStop width={16} height={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="btn-primary !rounded-xl !px-3 !py-2"
              aria-label="Send message"
            >
              <IconSend width={16} height={16} />
            </button>
          )}
        </div>
        {!anchored && !conversationId ? (
          <p className="mt-1.5 px-1 text-[11px] text-content-muted">
            Pick an exam to ground the tutor:{' '}
            <Link href="/browse" className="link">
              browse exams
            </Link>
          </p>
        ) : (
          <p className="mt-1.5 px-1 text-[11px] text-content-muted">
            AI can make mistakes — verify against the official exam guide.
          </p>
        )}
      </form>
    </div>
  );
}

/** Rename helper exposed for the standalone page header. */
export async function renameConversation(id: string, title: string) {
  return patch<{ conversation: AiConversation }>(`/ai/chat/conversations/${id}`, { title });
}
