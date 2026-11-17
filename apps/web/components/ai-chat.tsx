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
import type { AiTutorMode } from '@examdump/shared';
import { ApiError, del, get, post, streamPost } from '@/lib/api';
import type { AiConversation, AiConversationDetail, ChatMessage } from '@/lib/types';
import { Markdown } from './markdown';
import { Alert } from './ui';
import {
  IconChevronDown,
  IconCopy,
  IconHistory,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSparkles,
  IconStop,
  IconTrash,
  IconX,
} from './icons';
import { cn, relativeTime } from '@/lib/format';
import { getAiModePreference, setAiModePreference } from '@/lib/local-store';

/**
 * Teaching modes. The id is sent to the API, which adds the matching
 * instruction to the tutor's system prompt; label and hint are UI copy only.
 */
export const TUTOR_MODES: ReadonlyArray<{
  id: AiTutorMode;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    id: 'step',
    label: 'Step by step',
    hint: 'Walk through the reasoning one step at a time',
    placeholder: 'Ask for a worked explanation...',
  },
  {
    id: 'socratic',
    label: 'Socratic',
    hint: 'Guide me with questions instead of giving the answer',
    placeholder: 'Tell the tutor what you already understand...',
  },
  {
    id: 'simple',
    label: 'Plain English',
    hint: 'Explain without jargon, as if this is new to me',
    placeholder: 'Ask for a simpler explanation...',
  },
  {
    id: 'example',
    label: 'Real world',
    hint: 'Ground the concept in a concrete scenario',
    placeholder: 'Ask for an example that makes it click...',
  },
  {
    id: 'quiz',
    label: 'Quiz me',
    hint: 'Check my understanding with short questions',
    placeholder: 'Say when you are ready to be quizzed...',
  },
];

const STARTER_PROMPTS = [
  'Explain a concept I am struggling with',
  'Make me a 5-question quiz on this exam',
  'What topics should I study first?',
  'Summarise the hardest subnetting rules',
];

const QUESTION_PROMPTS = [
  'Explain the correct answer step by step',
  'Why are the other options wrong?',
  'Give me a real-world example',
  'Memory trick to remember this',
];

function isTutorMode(value: unknown): value is AiTutorMode {
  return typeof value === 'string' && TUTOR_MODES.some((mode) => mode.id === value);
}

/** Avatar used for every assistant turn. */
function AssistantAvatar({ size = 30 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 via-accent-2 to-accent-3 text-white shadow-glow-sm ring-1 ring-inset ring-white/25"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <IconSparkles width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
    </span>
  );
}

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

  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  useEffect(() => {
    if (open && streaming) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [text, open, streaming]);

  if (!text.trim()) return null;

  return (
    <div className="mb-2.5 overflow-hidden rounded-[1.1rem] border border-surface-border bg-surface-overlay/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-overlay"
      >
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', streaming ? 'animate-pulse bg-accent' : 'bg-positive')}
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
        <div ref={bodyRef} className="scroll-thin max-h-44 overflow-y-auto border-t border-surface-border px-3 py-2">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-content-muted">{text}</p>
        </div>
      ) : null}
    </div>
  );
}
/** Conversation list shared by the workspace rail and the in-panel history. */
function HistoryList({
  conversations,
  currentId,
  query,
  onQuery,
  onSelect,
  onDelete,
  className,
}: {
  conversations: AiConversation[];
  currentId?: string;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle));
  }, [conversations, query]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="relative shrink-0 px-2 pb-2">
        <IconSearch
          width={15}
          height={15}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-content-muted"
        />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="input min-h-9 py-1.5 pl-8 text-xs"
        />
      </div>

      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 ? (
          <li className="px-2.5 py-3 text-xs text-content-muted">
            {conversations.length === 0 ? 'No conversations yet.' : 'Nothing matched that search.'}
          </li>
        ) : (
          filtered.map((conversation) => {
            const current = conversation.id === currentId;
            return (
              <li key={conversation.id} className="group flex items-center gap-0.5">
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onSelect(conversation.id)}
                  className={cn(
                    'min-h-10 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                    current
                      ? 'bg-accent/10 text-content-primary'
                      : 'text-content-secondary hover:bg-surface-overlay',
                  )}
                >
                  <span className="block truncate text-xs font-semibold">{conversation.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[0.625rem] text-content-muted">
                    {conversation.examTitle ?? conversation.examKey ?? 'General'}
                    <span aria-hidden="true">·</span>
                    {relativeTime(conversation.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${conversation.title}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted opacity-0 transition-all hover:bg-negative/10 hover:text-negative focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-60"
                  onClick={() => onDelete(conversation.id)}
                >
                  <IconTrash width={14} height={14} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/** Teaching-mode chips. */
function ModeSelector({
  mode,
  onChange,
  disabled,
  className,
}: {
  mode: AiTutorMode;
  onChange: (mode: AiTutorMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Teaching mode"
      className={cn('no-scrollbar flex items-center gap-1 overflow-x-auto', className)}
    >
      {TUTOR_MODES.map((option) => {
        const active = option.id === mode;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            disabled={disabled}
            aria-pressed={active}
            title={option.hint}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors',
              active
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-surface-border bg-surface-raised text-content-muted hover:text-content-secondary',
              disabled && 'opacity-60',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ChatPanelProps {
  /** Existing conversation to open. */
  conversationId?: string;
  /** Exam anchor for a brand-new conversation. */
  providerId?: string;
  examKey?: string;
  questionId?: string;
  examLabel?: string;
  /** Options the learner has selected on the anchored question. */
  learnerChoice?: string[];
  /**
   * `panel` fills a dock beside a question, `workspace` adds the history rail
   * on wide screens for the standalone tutor page.
   */
  variant?: 'panel' | 'workspace';
  onConversationCreated?: (id: string) => void;
  onClose?: () => void;
}

interface AiStatus {
  enabled: boolean;
  dailyLimit?: number;
  usedToday?: number;
  remaining?: number | null;
}

export function AiChat({
  conversationId: initialConversationId,
  providerId,
  examKey,
  questionId,
  examLabel,
  learnerChoice,
  variant = 'panel',
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
  const [limitReached, setLimitReached] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [resumed, setResumed] = useState(false);
  // Start from the neutral mode so the server and client render the same chips,
  // then adopt the stored preference after mount.
  const [mode, setMode] = useState<AiTutorMode>('step');

  useEffect(() => {
    const stored = getAiModePreference();
    if (isTutorMode(stored)) setMode(stored);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Only auto-follow the newest text while the reader is already at the bottom;
  // scrolling up to re-read must not be yanked away by incoming tokens.
  const stickToBottom = useRef(true);

  const anchored = Boolean(providerId && examKey);
  const questionAnchored = Boolean(questionId);
  const workspace = variant === 'workspace';

  /* ---------------------------------------------------------------- */
  /* Data loading                                                      */
  /* ---------------------------------------------------------------- */

  const loadConversation = useCallback(async (id: string) => {
    setLoading(true);
    setError('');
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
      setSuggestions(data.suggestions ?? []);
      setConversationId(id);
      setHistoryOpen(false);
      stickToBottom.current = true;
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

  const loadStatus = useCallback(async () => {
    try {
      const data = await get<AiStatus>('/ai/status');
      setStatus(data);
      if (typeof data.remaining === 'number' && data.remaining <= 0) setLimitReached(true);
    } catch {
      /* the composer still works without a quota readout */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    void loadStatus();
  }, [loadHistory, loadStatus]);

  useEffect(() => {
    if (initialConversationId) void loadConversation(initialConversationId);
  }, [initialConversationId, loadConversation]);

  // Resume the most recent conversation about this question so context is not
  // lost when the learner closes and reopens the tutor.
  useEffect(() => {
    if (initialConversationId || conversationId || !providerId || !examKey || !questionId) return;
    let cancelled = false;
    const params = new URLSearchParams({ provider: providerId, exam: examKey, questionId });
    get<{ conversation: AiConversation | null }>(`/ai/chat/by-question?${params.toString()}`)
      .then((data) => {
        if (cancelled || !data.conversation) return;
        setResumed(true);
        void loadConversation(data.conversation.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Run once per anchored question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, providerId, examKey, questionId, loadConversation]);

  useEffect(() => {
    setSuggestions(questionAnchored ? QUESTION_PROMPTS : anchored ? STARTER_PROMPTS : []);
  }, [anchored, questionAnchored]);

  /* ---------------------------------------------------------------- */
  /* Scrolling                                                         */
  /* ---------------------------------------------------------------- */

  const [showJump, setShowJump] = useState(false);
  /**
   * Set while we scroll the transcript ourselves. Our own scroll fires the same
   * `scroll` event a gesture does, which would look like "the reader scrolled
   * away" and switch auto-follow off mid-answer.
   */
  const programmaticScroll = useRef(false);

  const onTranscriptScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (programmaticScroll.current) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < 120;
    setShowJump(distance > 240);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const element = scrollRef.current;
    if (!element) return;
    programmaticScroll.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickToBottom.current = true;
    setShowJump(false);
    window.setTimeout(
      () => {
        programmaticScroll.current = false;
      },
      smooth ? 450 : 60,
    );
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const stillStreaming = messages.some((message) => message.pending || message.reasoningStreaming);
    scrollToBottom(!stillStreaming);
    const frame = requestAnimationFrame(() => {
      if (stickToBottom.current) scrollToBottom(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, scrollToBottom]);

  /* ---------------------------------------------------------------- */
  /* Mode                                                              */
  /* ---------------------------------------------------------------- */

  const changeMode = useCallback((next: AiTutorMode) => {
    setMode(next);
    setAiModePreference(next);
    inputRef.current?.focus();
  }, []);

  /* ---------------------------------------------------------------- */
  /* Send                                                              */
  /* ---------------------------------------------------------------- */

  const send = useCallback(
    async (raw: string, options: { silentUser?: boolean } = {}) => {
      const text = raw.trim();
      if (!text || streaming || limitReached) return;

      setError('');
      setInput('');
      stickToBottom.current = true;

      const userMessage: ChatMessage = {
        id: `local-u-${Date.now()}`,
        role: 'user',
        content: text,
      };
      const assistantId = `local-a-${Date.now()}`;
      setMessages((previous) => [
        ...previous,
        ...(options.silentUser ? [] : [userMessage]),
        { id: assistantId, role: 'assistant', content: '', pending: true },
      ]);
      setStreaming(true);

      const patchAssistant = (update: (message: ChatMessage) => ChatMessage) =>
        setMessages((previous) => previous.map((message) => (message.id === assistantId ? update(message) : message)));

      const markQuota = (message: string) => {
        if (/limit|quota/i.test(message)) setLimitReached(true);
      };

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
          {
            message: text,
            mode,
            ...(questionAnchored && learnerChoice && learnerChoice.length > 0
              ? { learnerChoice }
              : {}),
          },
          {
            onDelta: (fragment) => patchAssistant((message) => ({ ...message, content: message.content + fragment })),
            onReasoningStart: () => patchAssistant((message) => ({ ...message, reasoningStreaming: true })),
            onReasoning: (fragment) =>
              patchAssistant((message) => ({
                ...message,
                reasoning: (message.reasoning ?? '') + fragment,
                reasoningStreaming: true,
              })),
            onReasoningEnd: () => patchAssistant((message) => ({ ...message, reasoningStreaming: false })),
            onDone: () => {
              patchAssistant((message) => ({ ...message, pending: false, reasoningStreaming: false }));
              setStatus((current) =>
                current && typeof current.remaining === 'number'
                  ? { ...current, remaining: Math.max(0, current.remaining - 1) }
                  : current,
              );
            },
            onError: (message) => {
              markQuota(message);
              patchAssistant((assistant) => ({
                ...assistant,
                pending: false,
                reasoningStreaming: false,
                error: message,
              }));
            },
          },
          controller.signal,
        );

        setMessages((previous) =>
          previous.filter(
            (message) => !(message.id === assistantId && !message.content && !message.error && !message.reasoning),
          ),
        );
        void loadHistory();
      } catch (err) {
        // A user-initiated stop aborts the fetch. Everything streamed up to that
        // point stays on screen — discarding it would lose text already read.
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (aborted) {
          patchAssistant((message) => ({
            ...message,
            pending: false,
            reasoningStreaming: false,
            stopped: Boolean(message.content || message.reasoning),
          }));
          setMessages((previous) =>
            previous.filter(
              (message) => !(message.id === assistantId && !message.content && !message.reasoning),
            ),
          );
        } else {
          const message =
            err instanceof ApiError ? err.message : (err as Error).message || 'The AI tutor is unavailable.';
          markQuota(message);
          if (err instanceof ApiError && err.status === 403 && err.code === 'QUOTA_EXCEEDED') setLimitReached(true);
          patchAssistant((assistant) => ({
            ...assistant,
            pending: false,
            reasoningStreaming: false,
            error: message,
          }));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [
      conversationId,
      streaming,
      limitReached,
      providerId,
      examKey,
      questionId,
      questionAnchored,
      learnerChoice,
      mode,
      onConversationCreated,
      loadHistory,
    ],
  );

  const stop = useCallback(() => {
    // Only abort; send() finalises the message so partial text is preserved.
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
    setResumed(false);
    setHistoryOpen(false);
    setLimitReached(typeof status?.remaining === 'number' ? status.remaining <= 0 : false);
    setSuggestions(questionAnchored ? QUESTION_PROMPTS : anchored ? STARTER_PROMPTS : []);
    stickToBottom.current = true;
    inputRef.current?.focus();
  }, [anchored, questionAnchored, status?.remaining, stop]);

  const removeConversation = useCallback(
    async (id: string) => {
      await del(`/ai/chat/conversations/${id}`).catch(() => undefined);
      setConversations((previous) => previous.filter((conversation) => conversation.id !== id));
      if (id === conversationId) startNew();
    },
    [conversationId, startNew],
  );

  const copyMessage = useCallback(async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1600);
    } catch {
      /* clipboard blocked; ignore */
    }
  }, []);

  /**
   * Ask again without repeating the learner's bubble. The server still records
   * the follow-up turn, but the transcript shows one question and one answer.
   */
  const regenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    setMessages((previous) => {
      const lastAssistant = [...previous].reverse().find((message) => message.role === 'assistant');
      return lastAssistant ? previous.filter((message) => message.id !== lastAssistant.id) : previous;
    });
    void send(lastUser.content, { silentUser: true });
  }, [messages, send]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const hasMessages = messages.length > 0;
  const lastMessage = messages[messages.length - 1];
  const showSuggestions = suggestions.length > 0 && (!hasMessages || (!streaming && !lastMessage?.pending));
  const activeMode = TUTOR_MODES.find((option) => option.id === mode) ?? TUTOR_MODES[0]!;
  const remaining = typeof status?.remaining === 'number' ? status.remaining : null;

  const contextLabel = useMemo(() => {
    if (conversationId) {
      const found = conversations.find((conversation) => conversation.id === conversationId);
      if (found) {
        return found.examTitle ?? found.examKey ?? 'General';
      }
    }
    return examLabel ?? examKey ?? null;
  }, [conversationId, conversations, examLabel, examKey]);

  const headerTitle = useMemo(() => {
    if (conversationId) {
      const found = conversations.find((conversation) => conversation.id === conversationId);
      if (found) return found.title;
    }
    return questionId ? 'Ask about this question' : anchored ? 'Tutor for this exam' : 'AI tutor';
  }, [conversationId, conversations, questionId, anchored]);

  // Announced to assistive tech without narrating every streamed token.
  const liveStatus = streaming
    ? 'Generating a response'
    : lastMessage?.role === 'assistant' && lastMessage?.content
      ? 'Response complete'
      : '';

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-base">
      {/* Workspace rail: history beside the conversation on wide screens. */}
      {workspace ? (
        <aside className="hidden w-60 shrink-0 flex-col border-r border-surface-border bg-surface-overlay lg:flex">
          <div className="flex items-center justify-between gap-2 px-3 py-3">
            <p className="eyebrow">Conversations</p>
            <button
              type="button"
              onClick={startNew}
              className="icon-btn !h-8 !w-8"
              aria-label="New conversation"
              title="New conversation"
            >
              <IconPlus width={16} height={16} />
            </button>
          </div>
          <HistoryList
            conversations={conversations}
            currentId={conversationId}
            query={historyQuery}
            onQuery={setHistoryQuery}
            onSelect={(id) => void loadConversation(id)}
            onDelete={(id) => void removeConversation(id)}
            className="min-h-0 flex-1"
          />
          <div className="border-t border-surface-border p-3">
            <Link href="/ask" className="btn-secondary btn-sm btn-block">
              Ask about another exam
            </Link>
          </div>
        </aside>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="relative z-10 flex shrink-0 items-center gap-2.5 border-b border-surface-border bg-surface-raised/85 px-3 py-2 backdrop-blur-md sm:px-4">
          <AssistantAvatar size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-content-primary">{headerTitle}</p>
            <p className="truncate text-[0.6875rem] text-content-muted">
              {questionAnchored
                ? 'Grounded in this question'
                : contextLabel
                  ? `Grounded in ${contextLabel}`
                  : 'Certification tutor'}
              {remaining !== null ? (
                <>
                  {' · '}
                  <span className="numeric">{remaining}</span> left today
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              className="icon-btn !h-9 !w-9"
              aria-label="Conversation history"
              aria-expanded={historyOpen}
              title="History"
            >
              <IconHistory width={17} height={17} />
            </button>
            <button
              type="button"
              onClick={startNew}
              className="icon-btn !h-9 !w-9"
              aria-label="New conversation"
              title="New conversation"
            >
              <IconPlus width={17} height={17} />
            </button>
            {onClose ? (
              <button type="button" onClick={onClose} className="icon-btn !h-9 !w-9" aria-label="Close AI tutor">
                <IconX width={17} height={17} />
              </button>
            ) : null}
          </div>
        </div>

        {resumed ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-accent/20 bg-accent/[0.06] px-3 py-1.5 text-[0.6875rem] text-content-secondary sm:px-4">
            <span>Resumed your earlier conversation about this question.</span>
            <button type="button" onClick={startNew} className="link font-semibold">
              Start fresh
            </button>
          </div>
        ) : null}

        {historyOpen ? (
          <div className="max-h-64 shrink-0 overflow-hidden border-b border-surface-border bg-surface-overlay/40 py-2">
            <HistoryList
              conversations={conversations}
              currentId={conversationId}
              query={historyQuery}
              onQuery={setHistoryQuery}
              onSelect={(id) => void loadConversation(id)}
              onDelete={(id) => void removeConversation(id)}
              className="max-h-56"
            />
          </div>
        ) : null}

        {/* Transcript */}
        <div ref={scrollRef} onScroll={onTranscriptScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-3xl px-3.5 py-4 sm:px-5">
            {loading ? (
              <div className="flex flex-col gap-3" role="status" aria-label="Loading conversation">
                <div className="ml-auto h-10 w-2/5 skeleton" />
                <div className="h-24 w-full skeleton" />
              </div>
            ) : !hasMessages ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center sm:py-12">
                <div className="relative inline-grid place-items-center">
                  <span aria-hidden="true" className="orb -inset-4 bg-accent-2/25" />
                  <AssistantAvatar size={56} />
                </div>
                <div className="max-w-sm">
                  <p className="heading-2">
                    {questionAnchored
                      ? 'Ask anything about this question'
                      : anchored
                        ? 'Ask anything about this exam'
                        : 'Ask the AI tutor'}
                  </p>
                  <p className="body-text mx-auto mt-1.5">
                    {activeMode.hint}. Ask a follow-up at any time — the conversation keeps its context.
                  </p>
                </div>
                {showSuggestions ? (
                  <div className="mt-1 grid w-full max-w-lg gap-2 sm:grid-cols-2">
                    {suggestions.slice(0, 4).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={streaming}
                        onClick={() => void send(suggestion)}
                        className="tile tile-interactive min-h-11 px-3 py-2.5 text-left text-xs font-medium leading-snug text-content-secondary"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <ol className="flex flex-col gap-5 sm:gap-6" aria-label="Conversation">
                {messages.map((message) =>
                  message.role === 'user' ? (
                    <li key={message.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[1.35rem] rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed text-[rgb(var(--accent-contrast))] shadow-md shadow-accent/20 sm:max-w-[75%]">
                        {message.content}
                      </div>
                    </li>
                  ) : (
                    <li key={message.id} className="flex gap-2.5 sm:gap-3">
                      <AssistantAvatar />
                      <div className="min-w-0 flex-1">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-content-muted">
                          <IconSparkles width={12} height={12} className="text-accent" aria-hidden="true" />
                          AI tutor
                        </p>

                        <div className="rounded-[1.25rem] rounded-tl-md border border-surface-border bg-surface-raised p-3.5 shadow-xs sm:p-4">
                          <ReasoningPanel text={message.reasoning ?? ''} streaming={message.reasoningStreaming} />

                          {message.content ? (
                            <div className="answer-prose">
                              <Markdown content={message.content} />
                              {message.pending ? <span className="caret ml-0.5 align-middle" aria-hidden="true" /> : null}
                            </div>
                          ) : message.error || message.reasoning ? null : (
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
                        </div>

                        {!message.pending ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void copyMessage(message)}
                              className="icon-btn !h-9 !w-9"
                              aria-label="Copy answer"
                              title="Copy"
                            >
                              <IconCopy width={15} height={15} />
                            </button>
                            {message.id === lastMessage?.id && !streaming ? (
                              <button
                                type="button"
                                onClick={regenerate}
                                className="icon-btn !h-9 !w-9"
                                aria-label="Regenerate answer"
                                title="Regenerate"
                              >
                                <IconRefresh width={15} height={15} />
                              </button>
                            ) : null}
                            {copiedId === message.id ? (
                              <span className="ml-1 text-[0.6875rem] font-semibold text-positive" role="status">
                                Copied
                              </span>
                            ) : null}
                            {message.stopped ? (
                              <span className="ml-1 text-[0.6875rem] text-content-muted">Stopped</span>
                            ) : null}
                            {message.degraded ? (
                              <span className="ml-1 text-[0.6875rem] font-medium text-caution">offline explanation</span>
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

        <span className="sr-only" role="status" aria-live="polite">
          {liveStatus}
        </span>

        {showJump ? (
          <div className="pointer-events-none relative z-10 -mb-px flex justify-center">
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="pointer-events-auto mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-surface-border-strong bg-surface-raised/95 px-3.5 py-1.5 text-xs font-semibold text-content-primary shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/50"
              aria-label="Jump to latest message"
            >
              <IconChevronDown width={14} height={14} />
              Latest
            </button>
          </div>
        ) : null}

        {/* Composer */}
        <div className="shrink-0 border-t border-surface-border bg-surface-raised/85 px-2.5 py-2 backdrop-blur-md sm:px-4 sm:py-3">
          <div className="mx-auto w-full max-w-3xl">
            {limitReached ? (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[1rem] border border-caution/40 bg-caution/[0.07] px-3 py-2 text-xs text-content-secondary">
                <span>You have used your AI messages for today. The allowance resets tomorrow.</span>
                <Link href="/pricing" className="btn-secondary btn-sm shrink-0">
                  See plans
                </Link>
              </div>
            ) : hasMessages && showSuggestions ? (
              <div className="no-scrollbar -mx-1 mb-2 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1">
                {suggestions.slice(0, 3).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={streaming}
                    onClick={() => void send(suggestion)}
                    className="chip max-w-[15rem] shrink-0 snap-start !items-start whitespace-normal text-left text-xs leading-snug"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}

            <form onSubmit={onSubmit} aria-label="Ask the AI tutor">
              <div
                className={cn(
                  'rounded-[1.35rem] border bg-surface-base p-2 transition-colors',
                  streaming
                    ? 'border-accent/40'
                    : 'border-surface-border-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
                )}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  maxLength={4000}
                  disabled={limitReached}
                  placeholder={limitReached ? 'Daily AI limit reached' : activeMode.placeholder}
                  aria-label="Message the AI tutor"
                  className="max-h-32 min-h-[40px] w-full resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-content-primary outline-none placeholder:text-content-muted disabled:cursor-not-allowed disabled:opacity-70 sm:text-sm"
                  onInput={(event) => {
                    const element = event.currentTarget;
                    element.style.height = 'auto';
                    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <ModeSelector mode={mode} onChange={changeMode} disabled={streaming || limitReached} />
                  <div className="flex shrink-0 items-center gap-1.5">
                    {input.length > 3400 ? (
                      <span className="numeric text-[0.625rem] text-content-muted">{input.length}/4000</span>
                    ) : null}
                    {streaming ? (
                      <button
                        type="button"
                        onClick={stop}
                        className="btn-secondary !min-h-10 !rounded-2xl !px-3 !py-2"
                        aria-label="Stop generating"
                      >
                        <IconStop width={16} height={16} />
                        <span className="hidden sm:inline">Stop</span>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!input.trim() || limitReached}
                        className="btn-primary !min-h-10 !rounded-2xl !px-3 !py-2"
                        aria-label="Send message"
                      >
                        <IconSend width={16} height={16} />
                        <span className="hidden sm:inline">Send</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>

            <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
              <p className="text-[0.6875rem] text-content-muted">
                {!anchored && !conversationId ? (
                  <>
                    Pick an exam to ground the tutor:{' '}
                    <Link href="/exams" className="link">
                      browse exams
                    </Link>
                  </>
                ) : (
                  'AI can make mistakes — verify with the official exam guide.'
                )}
              </p>
              <p className="hidden shrink-0 text-[0.6875rem] text-content-muted sm:block">
                <span className="kbd">Enter</span> to send · <span className="kbd">Shift</span> +{' '}
                <span className="kbd">Enter</span> for a new line
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
