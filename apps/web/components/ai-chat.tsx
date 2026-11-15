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
  IconX,
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
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-sky-400 text-white shadow-sm shadow-brand-500/30 ring-1 ring-inset ring-white/25"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <IconSparkles width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
    </span>
  );
}

/** Three-dot "working" indicator built on the shared .dot-pulse animation. */
function DotPulse({ className }: { className?: string }) {
  return (
    <span className={cn('dot-pulse', className)} aria-hidden="true">
      <span />
    </span>
  );
}

/**
 * Collapsible summary of what the model considered. NVIDIA exposes this as
 * `reasoning_content`; it is a model-authored summary, so it is shown as-is and
 * kept visually separate from the final answer.
 */
function ReasoningPanel({ text, streaming }: { text: string; streaming?: boolean }) {
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
    <div className="mb-2.5 overflow-hidden rounded-xl border border-surface-border bg-surface-overlay/60">
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
        <span className="text-xs font-semibold text-content-secondary">
          {streaming ? 'Thinking it through...' : 'Reasoning summary'}
        </span>
        {streaming ? <DotPulse className="ml-auto text-accent" /> : null}
        <IconChevronDown
          width={14}
          height={14}
          className={cn(
            'shrink-0 text-content-muted transition-transform duration-200',
            !streaming && 'ml-auto',
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

  const [showJump, setShowJump] = useState(false);
  /**
   * Set while we scroll the transcript ourselves.
   *
   * Our own scroll fires the same `scroll` event a user gesture does, which
   * would look like "the reader scrolled away" and switch auto-follow off
   * mid-answer. Tracking it lets the handler ignore those echoes.
   */
  const programmaticScroll = useRef(false);

  const onTranscriptScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (programmaticScroll.current) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    // A little slack: layout can settle a few pixels after we scroll.
    const nearBottom = distance < 120;
    stickToBottom.current = nearBottom;
    // Only worth offering once the reader is meaningfully far from the end.
    setShowJump(distance > 240);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticScroll.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickToBottom.current = true;
    setShowJump(false);
    // Release once the (possibly animated) scroll has finished.
    window.setTimeout(() => {
      programmaticScroll.current = false;
    }, smooth ? 450 : 60);
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const stillStreaming = messages.some((m) => m.pending || m.reasoningStreaming);
    // Never smooth-scroll mid-stream: each token would restart the animation
    // before it completed and the view would drift far from the newest text.
    scrollToBottom(!stillStreaming);
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

  // Announced to assistive tech without narrating every streamed token.
  const liveStatus = streaming
    ? 'Generating a response'
    : lastMessage?.role === 'assistant' && lastMessage?.content
      ? 'Response complete'
      : '';

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      {/* Header */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-surface-border bg-surface-raised/85 px-3 backdrop-blur sm:px-4',
          embedded ? 'py-2' : 'py-2.5',
          '[@media(max-height:480px)]:py-1',
        )}
      >
        {!embedded ? (
          <span className="[@media(max-height:480px)]:hidden">
            <AssistantAvatar size={32} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content-primary">
            {embedded ? 'Conversation' : headerTitle}
          </p>
          <p className="truncate text-[0.6875rem] text-content-muted [@media(max-height:480px)]:hidden">
            {questionAnchored ? 'Grounded in this question' : 'Certification tutor'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={startNew}
            className="icon-btn !h-9 !w-9 touch:!h-11 touch:!w-11"
            aria-label="New conversation"
            title="New conversation"
          >
            <IconPlus width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="icon-btn !h-9 !w-9 touch:!h-11 touch:!w-11"
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
              className="icon-btn !h-9 !w-9 touch:!h-11 touch:!w-11"
              aria-label="Close"
            >
              <IconX width={18} height={18} />
            </button>
          ) : null}
        </div>
      </div>

      {/* History */}
      {historyOpen ? (
        <div className="max-h-56 shrink-0 overflow-y-auto border-b border-surface-border bg-surface-overlay/50 px-2 py-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-content-muted">No conversations yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => {
                const current = c.id === conversationId;
                return (
                  <li key={c.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        setHistoryOpen(false);
                        void loadConversation(c.id);
                      }}
                      className={cn(
                        'min-h-9 min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors touch:min-h-11',
                        current
                          ? 'bg-accent/10 font-semibold text-accent'
                          : 'text-content-secondary hover:bg-surface-overlay',
                      )}
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${c.title}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted transition-colors hover:bg-negative/10 hover:text-negative touch:h-11 touch:w-11"
                      onClick={async () => {
                        await del(`/ai/chat/conversations/${c.id}`).catch(() => undefined);
                        setConversations((prev) => prev.filter((x) => x.id !== c.id));
                        if (c.id === conversationId) startNew();
                      }}
                    >
                      <IconTrash width={14} height={14} />
                    </button>
                  </li>
                );
              })}
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
        <div className="mx-auto w-full max-w-3xl px-3.5 py-3.5 sm:px-5 sm:py-5">
          {loading ? (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading conversation">
              <div className="ml-auto h-10 w-2/5 skeleton" />
              <div className="h-24 w-full skeleton" />
            </div>
          ) : !hasMessages ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center sm:py-16">
              <AssistantAvatar size={52} />
              <div>
                <p className="heading-3">Ask anything about this {questionAnchored ? 'question' : 'exam'}</p>
                <p className="body-text mx-auto mt-1 max-w-sm">
                  Step-by-step reasoning, why distractors are wrong, examples and memory tricks.
                </p>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-5" aria-label="Conversation">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <li key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--accent-contrast))] shadow-sm sm:max-w-[75%]">
                      {message.content}
                    </div>
                  </li>
                ) : (
                  <li key={message.id} className="flex gap-2.5 sm:gap-3">
                    <AssistantAvatar />
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-content-muted">
                        AI tutor
                      </p>

                      <ReasoningPanel text={message.reasoning ?? ''} streaming={message.reasoningStreaming} />

                      {message.content ? (
                        <div className="answer-prose">
                          <Markdown content={message.content} />
                          {message.pending ? (
                            <span className="caret ml-0.5 align-middle" aria-hidden="true" />
                          ) : null}
                        </div>
                      ) : message.error ? null : message.reasoning ? null : (
                        <div
                          className="inline-flex items-center gap-2 py-1 text-xs font-medium text-content-muted"
                          role="status"
                          aria-live="polite"
                        >
                          <DotPulse className="text-accent" />
                          {message.reasoningStreaming ? 'Thinking it through...' : 'Writing the answer...'}
                        </div>
                      )}

                      {message.error ? (
                        <div className="mt-1.5">
                          <Alert tone="error">{message.error}</Alert>
                        </div>
                      ) : null}

                      {!message.pending ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void copyMessage(message)}
                            className="icon-btn !h-9 !w-9 touch:!h-10 touch:!w-10"
                            aria-label="Copy answer"
                            title="Copy"
                          >
                            <IconCopy width={15} height={15} />
                          </button>
                          {message.id === lastMessage?.id && !streaming ? (
                            <button
                              type="button"
                              onClick={regenerate}
                              className="icon-btn !h-9 !w-9 touch:!h-10 touch:!w-10"
                              aria-label="Regenerate answer"
                              title="Regenerate"
                            >
                              <IconRefresh width={15} height={15} />
                            </button>
                          ) : null}
                          {copiedId === message.id ? (
                            <span className="ml-0.5 text-[0.6875rem] font-semibold text-positive" role="status">
                              Copied
                            </span>
                          ) : null}
                          {message.stopped ? (
                            <span className="ml-0.5 text-[0.6875rem] text-content-muted">Stopped</span>
                          ) : null}
                          {message.degraded ? (
                            <span className="ml-0.5 text-[0.6875rem] font-medium text-caution">
                              offline explanation
                            </span>
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
            <div className="mt-3">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}
        </div>
      </div>

      {/* Screen-reader status for async streaming without narrating each token. */}
      <span className="sr-only" role="status" aria-live="polite">
        {liveStatus}
      </span>

      {/* Jump to latest: floats above the composer while the reader is
          scrolled away from the newest message. */}
      {showJump ? (
        <div className="pointer-events-none relative z-10 -mb-px flex justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-surface-border-strong bg-surface-raised/95 px-3.5 py-1.5 text-xs font-semibold text-content-primary shadow-lg backdrop-blur transition-colors hover:border-accent/50 touch:min-h-11"
            aria-label="Jump to latest message"
          >
            <IconChevronDown width={14} height={14} />
            Latest
          </button>
        </div>
      ) : null}

      {/* Composer */}
      <div className="shrink-0 border-t border-surface-border bg-surface-raised/85 px-2.5 py-2 backdrop-blur sm:px-4 sm:py-3 [@media(max-height:480px)]:py-1.5">
        <div className="mx-auto w-full max-w-3xl">
          {showSuggestions ? (
            <div className="mb-2 -mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar [@media(max-height:480px)]:mb-1">
              {suggestions.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={streaming}
                  onClick={() => void send(s)}
                  className="chip max-w-[15rem] shrink-0 snap-start !items-start text-left text-xs leading-snug whitespace-normal"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={onSubmit} aria-label="Ask the AI tutor">
            <div className="flex items-end gap-1.5 rounded-2xl border border-surface-border-strong bg-surface-base p-1.5 shadow-xs transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                maxLength={4000}
                placeholder="Ask a follow-up question..."
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

          <div className="mt-1.5 flex items-center justify-between gap-2 px-1 [@media(max-height:480px)]:hidden">
            <p className="text-[0.6875rem] text-content-muted">
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
            <p className="hidden shrink-0 text-[0.6875rem] text-content-muted sm:block">
              <span className="kbd">Enter</span> to send ·{' '}
              <span className="kbd">Shift</span> + <span className="kbd">Enter</span> for a new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rename helper exposed for the standalone page header. */
export async function renameConversation(id: string, title: string) {
  return patch<{ conversation: AiConversation }>(`/ai/chat/conversations/${id}`, { title });
}
