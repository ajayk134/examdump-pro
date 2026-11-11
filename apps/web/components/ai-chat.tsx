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

/** Avatar used for every assistant turn. */
function AssistantAvatar({ size = 30 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-sky-400 text-white shadow-sm shadow-accent/30"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <IconSparkles width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
    </span>
  );
}

/**
 * Collapsible summary of what the model considered. NVIDIA exposes this as
 * `reasoning_content`; it is a model-authored summary, so it is shown as-is and
 * kept visually separate from the final answer.
 */
function ReasoningPanel({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-expand while it is being written, then leave the user's choice alone.
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  useEffect(() => {
    if (open && streaming) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [text, open, streaming]);

  if (!text.trim()) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-surface-border bg-surface-overlay/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-overlay"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            streaming ? 'animate-pulse bg-accent' : 'bg-positive',
          )}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-content-secondary">
          {streaming ? 'Thinking it through…' : 'Reasoning summary'}
        </span>
        <IconChevronDown
          width={14}
          height={14}
          className={cn(
            'ml-auto shrink-0 text-content-muted transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className="max-h-44 overflow-y-auto border-t border-surface-border px-3 py-2"
        >
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-content-muted">{text}</p>
        </div>
      ) : null}
    </div>
  );
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
  // Only auto-follow the newest text while the reader is already at the bottom;
  // scrolling up to re-read must not be yanked away by incoming tokens.
  const stickToBottom = useRef(true);

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
  /* Scrolling                                                         */
  /* ---------------------------------------------------------------- */

  const onTranscriptScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 80;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    scrollToBottom();
    // Markdown reflows after fonts and tables settle, which can leave the last
    // line just below the fold. Re-pin once more on the next frame.
    const raf = requestAnimationFrame(() => {
      if (stickToBottom.current) scrollToBottom(false);
    });
    return () => cancelAnimationFrame(raf);
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
      stickToBottom.current = true;

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

      const patchAssistant = (patchFn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? patchFn(m) : m)));

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
            onDelta: (fragment) =>
              patchAssistant((m) => ({ ...m, content: m.content + fragment })),
            onReasoningStart: () =>
              patchAssistant((m) => ({ ...m, reasoningStreaming: true })),
            onReasoning: (fragment) =>
              patchAssistant((m) => ({
                ...m,
                reasoning: (m.reasoning ?? '') + fragment,
                reasoningStreaming: true,
              })),
            onReasoningEnd: () =>
              patchAssistant((m) => ({ ...m, reasoningStreaming: false })),
            onDone: () =>
              patchAssistant((m) => ({ ...m, pending: false, reasoningStreaming: false })),
            onError: (message) =>
              patchAssistant((m) => ({ ...m, pending: false, reasoningStreaming: false, error: message })),
          },
          controller.signal,
        );

        // Drop an empty assistant bubble if the provider failed immediately.
        setMessages((prev) =>
          prev.filter((m) => !(m.id === assistantId && !m.content && !m.error && !m.reasoning)),
        );
        void loadHistory();
      } catch (err) {
        // A user-initiated stop aborts the fetch. Everything streamed up to
        // that point is kept on screen — discarding it would throw away text
        // the reader has already seen.
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (aborted) {
          patchAssistant((m) => ({
            ...m,
            pending: false,
            reasoningStreaming: false,
            stopped: Boolean(m.content || m.reasoning),
          }));
          setMessages((prev) =>
            prev.filter((m) => !(m.id === assistantId && !m.content && !m.reasoning)),
          );
        } else {
          const message =
            err instanceof ApiError
              ? err.message
              : (err as Error).message || 'The AI tutor is unavailable.';
          patchAssistant((m) => ({ ...m, pending: false, reasoningStreaming: false, error: message }));
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
    // Only abort; the send() catch finalises the message so partial text is
    // preserved and a "Stopped" marker can be shown.
    abortRef.current?.abort();
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
    stickToBottom.current = true;
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

  useEffect(() => () => abortRef.current?.abort(), []);

  const hasMessages = messages.length > 0;
  const lastMessage = messages[messages.length - 1];
  const showSuggestions =
    suggestions.length > 0 && (!hasMessages || (!streaming && !lastMessage?.pending));

  const headerTitle = useMemo(() => {
    if (conversationId) {
      const found = conversations.find((c) => c.id === conversationId);
      if (found) return found.title;
    }
    return questionId ? 'Ask about this question' : examLabel ? `AI tutor · ${examLabel}` : 'AI tutor';
  }, [conversationId, conversations, questionId, examLabel]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-surface-border px-3 sm:px-4',
          embedded ? 'py-2' : 'py-2.5',
        )}
      >
        {!embedded ? <AssistantAvatar size={30} /> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content-primary">
            {embedded ? 'Conversation' : headerTitle}
          </p>
          <p className="truncate text-[0.6875rem] text-content-muted">
            {questionAnchored ? 'Grounded in this question' : 'Certification tutor'}
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="btn-ghost !min-h-9 !px-2 !py-1.5"
          aria-label="New conversation"
          title="New conversation"
        >
          <IconPlus width={18} height={18} />
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="btn-ghost !min-h-9 !px-2 !py-1.5"
          aria-label="Conversation history"
          aria-expanded={historyOpen}
          title="History"
        >
          <IconChevronDown
            width={18}
            height={18}
            className={cn('transition-transform duration-200', historyOpen && 'rotate-180')}
          />
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost !min-h-9 !px-2 !py-1.5"
            aria-label="Close"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* History */}
      {historyOpen ? (
        <div className="max-h-52 shrink-0 overflow-y-auto border-b border-surface-border bg-surface-overlay/50 px-2 py-2">
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
                      'min-h-9 min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-overlay',
                      c.id === conversationId
                        ? 'bg-accent/10 font-semibold text-accent'
                        : 'text-content-secondary',
                    )}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${c.title}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted transition-colors hover:bg-negative/10 hover:text-negative"
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
      <div
        ref={scrollRef}
        onScroll={onTranscriptScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5">
          {loading ? (
            <div className="flex flex-col gap-3">
              <div className="ml-auto h-10 w-2/5 animate-pulse rounded-2xl bg-surface-overlay" />
              <div className="h-24 w-full animate-pulse rounded-2xl bg-surface-overlay" />
            </div>
          ) : !hasMessages ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center sm:py-16">
              <AssistantAvatar size={48} />
              <div>
                <p className="heading-3">
                  Ask anything about this {questionAnchored ? 'question' : 'exam'}
                </p>
                <p className="body-text mx-auto mt-1 max-w-sm">
                  Step-by-step reasoning, why distractors are wrong, examples and memory tricks.
                </p>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              {messages.map((message) => (
                <li key={message.id}>
                  {message.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-white shadow-sm">
                        {message.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2.5">
                      <AssistantAvatar />
                      <div className="min-w-0 flex-1">
                        <ReasoningPanel
                          text={message.reasoning ?? ''}
                          streaming={message.reasoningStreaming}
                        />

                        {message.content ? (
                          <div className="answer-prose text-sm text-content-primary">
                            <Markdown content={message.content} />
                            {message.pending ? (
                              <span className="caret ml-0.5 align-middle" aria-hidden="true" />
                            ) : null}
                          </div>
                        ) : message.error ? null : message.reasoning ? null : (
                          <div className="inline-flex items-center gap-1.5 py-1 text-xs text-content-muted">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                            {message.reasoningStreaming ? 'Thinking…' : 'Writing…'}
                          </div>
                        )}

                        {message.error ? (
                          <div className="mt-1">
                            <Alert tone="error">{message.error}</Alert>
                          </div>
                        ) : null}

                        {!message.pending ? (
                          <div className="mt-1.5 flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => void copyMessage(message)}
                              className="grid h-8 w-8 place-items-center rounded-md text-content-muted transition-colors hover:bg-surface-overlay hover:text-content-primary"
                              aria-label="Copy answer"
                              title="Copy"
                            >
                              <IconCopy width={14} height={14} />
                            </button>
                            {message.id === lastMessage?.id && !streaming ? (
                              <button
                                type="button"
                                onClick={regenerate}
                                className="grid h-8 w-8 place-items-center rounded-md text-content-muted transition-colors hover:bg-surface-overlay hover:text-content-primary"
                                aria-label="Regenerate answer"
                                title="Regenerate"
                              >
                                <IconRefresh width={14} height={14} />
                              </button>
                            ) : null}
                            {copiedId === message.id ? (
                              <span className="text-[0.6875rem] font-medium text-positive">
                                Copied
                              </span>
                            ) : null}
                            {message.stopped ? (
                              <span className="text-[0.6875rem] text-content-muted">Stopped</span>
                            ) : null}
                            {message.degraded ? (
                              <span className="text-[0.6875rem] text-caution">
                                offline explanation
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
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
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-surface-border bg-surface-raised/80 px-3 py-2.5 backdrop-blur sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          {showSuggestions ? (
            <div className="mb-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {suggestions.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={streaming}
                  onClick={() => void send(s)}
                  className="chip shrink-0 text-xs"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={onSubmit}>
            <div className="flex items-end gap-1.5 rounded-2xl border border-surface-border-strong bg-surface-base p-1.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                maxLength={4000}
                placeholder="Ask a follow-up question…"
                aria-label="Message the AI tutor"
                className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-content-primary outline-none placeholder:text-content-muted sm:text-sm"
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
                  className="btn-secondary !min-h-10 !rounded-xl !px-3 !py-2"
                  aria-label="Stop generating"
                >
                  <IconStop width={16} height={16} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="btn-primary !min-h-10 !rounded-xl !px-3 !py-2"
                  aria-label="Send message"
                >
                  <IconSend width={16} height={16} />
                </button>
              )}
            </div>
          </form>
          <p className="mt-1.5 px-1 text-[0.6875rem] text-content-muted">
            {!anchored && !conversationId ? (
              <>
                Pick an exam to ground the tutor:{' '}
                <Link href="/exams" className="link">
                  browse exams
                </Link>
              </>
            ) : (
              'AI can make mistakes — verify against the official exam guide.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Rename helper exposed for the standalone page header. */
export async function renameConversation(id: string, title: string) {
  return patch<{ conversation: AiConversation }>(`/ai/chat/conversations/${id}`, { title });
}
