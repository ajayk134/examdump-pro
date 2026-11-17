'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { del, get, post } from '@/lib/api';
import type { Question, QuestionsResponse } from '@/lib/types';
import { PracticeQuestion } from './practice-question';
import { AiChat } from './ai-chat';
import { AiDock } from './ai-dock';
import {
  PageSizePicker,
  QuestionPalette,
  QuestionPager,
  type PaletteItem,
} from './question-session-controls';
import { selectionRulesFor } from './question-stage';
import { Drawer, EmptyIcon, EmptyState, ErrorState, ProgressBar, ProgressRing, Skeleton } from './ui';
import {
  IconArrowLeft,
  IconChart,
  IconCheck,
  IconClock,
  IconFlag,
  IconGrid,
  IconRefresh,
  IconX,
} from './icons';
import { cn } from '@/lib/format';
import {
  clearAutosave,
  getPageSizePreference,
  loadAutosave,
  saveAutosave,
  setPageSizePreference,
} from '@/lib/local-store';
import {
  DEFAULT_PAGE_SIZE,
  elapsedLabel,
  fitPageSize,
  pageBounds,
  pageCount,
  pageOfQuestion,
  parsePageSize,
  rangeLabel,
  statusOf,
  toggleSelection,
  type AnsweredResult,
  type PageSize,
} from '@/lib/question-session';
import { useAuth, useToast } from './providers';

type Mode = 'practice' | 'random';

interface PracticeSnapshot {
  page: number;
  pageSize: PageSize;
  answers: Record<string, string[]>;
  revealed: Record<string, boolean>;
  flagged: string[];
  activeId: string | null;
}

/** Older snapshots only stored the cursor and the answered ids. */
interface LegacySnapshot {
  index?: number;
  answered?: string[];
}

/**
 * Practice runner.
 *
 * The learner picks how many questions a page shows, answers with immediate
 * feedback, flags items for review and jumps anywhere from the palette. The AI
 * tutor docks beside the questions, so asking for help never ends the session.
 * Answers are re-graded on the server through `POST /api/analytics/practice`.
 */
export function StudySession({
  providerId,
  examKey,
  mode,
  focus = 'all',
  types,
  topic,
  count,
  random = false,
}: {
  providerId: string;
  examKey: string;
  mode: Mode;
  focus?: string;
  types?: string;
  topic?: string;
  count?: number;
  random?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const autosaveKey = `${providerId}/${examKey}/${mode}/${focus}/${types ?? 'any'}/${topic ?? 'all'}/${count ?? 'all'}`;

  const [data, setData] = useState<QuestionsResponse | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);

  const [chatQuestionId, setChatQuestionId] = useState<string | null>(null);
  const [chatMounted, setChatMounted] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(Date.now());
  const hydrated = useRef(false);
  const recorded = useRef<Set<string>>(new Set());
  const questionTimers = useRef<Map<string, number>>(new Map());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // A jump can target a card on another page, so the scroll runs after the new
  // page has rendered rather than inside the click handler.
  const pendingScrollId = useRef<string | null>(null);
  // A version-1 snapshot stored a question index that we can only turn into a
  // page after the paper has loaded.
  const legacyIndex = useRef<number | null>(null);

  /* ---------------- load ---------------- */

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    const params = new URLSearchParams({
      limit: String(Math.min(count ?? 200, 200)),
      mode,
      includeAnswer: 'true',
      focus,
    });
    if (types) params.set('types', types);
    if (topic) params.set('topic', topic);
    if (random || mode === 'random') params.set('random', 'true');
    get<QuestionsResponse>(
      `/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}/questions?${params.toString()}`,
    )
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, mode, focus, types, topic, count, random, reloadKey]);

  /* ---------------- AI capability ---------------- */

  useEffect(() => {
    let cancelled = false;
    get<{ enabled: boolean; remaining: number | null }>('/ai/status')
      .then((res) => {
        if (cancelled) return;
        setAiEnabled(res.enabled);
        setAiRemaining(typeof res.remaining === 'number' ? res.remaining : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- bookmarks (one request per session) ---------------- */

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    get<{ items: Array<{ questionId: string }> }>(
      `/bookmarks?examKey=${encodeURIComponent(examKey)}&pageSize=200`,
    )
      .then((res) => {
        if (!cancelled) setBookmarked(new Set(res.items.map((item) => item.questionId)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, examKey]);

  /* ---------------- session clock ---------------- */

  useEffect(() => {
    startedAt.current = Date.now();
    const tick = () => setElapsedMs(Date.now() - startedAt.current);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ---------------- progress recording ---------------- */

  const queue = useRef<AnsweredResult[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (!user || queue.current.length === 0) return;
    const answersBatch = queue.current
      .splice(0, 50)
      .map(({ questionId, selected, timeSpentMs }) => ({ questionId, selected, timeSpentMs }));
    post('/analytics/practice', { provider: providerId, exam: examKey, answers: answersBatch }).catch(() => {
      toast('Could not save this answer to your progress.', 'info');
    });
  }, [user, providerId, examKey, toast]);

  const recordAnswer = useCallback(
    (result: AnsweredResult) => {
      if (!user) return;
      queue.current.push(result);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (queue.current.length >= 25) {
        flush();
        return;
      }
      flushTimer.current = setTimeout(flush, 1500);
    },
    [user, flush],
  );

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flush();
    },
    [flush],
  );

  /* ---------------- restore + autosave ---------------- */

  useEffect(() => {
    const storedSize = parsePageSize(getPageSizePreference('practice'));
    if (storedSize) setPageSize(storedSize);

    const saved = loadAutosave<PracticeSnapshot>(autosaveKey);
    if (saved && saved.answers) {
      setPage(typeof saved.page === 'number' ? saved.page : 0);
      const savedSize = parsePageSize(saved.pageSize);
      if (storedSize === null && savedSize) setPageSize(savedSize);
      setAnswers(saved.answers ?? {});
      setRevealed(saved.revealed ?? {});
      setFlagged(new Set(saved.flagged ?? []));
      setActiveId(saved.activeId ?? null);
      recorded.current = new Set(Object.keys(saved.revealed ?? {}).filter((id) => saved.revealed?.[id]));
      setRestored(true);
    } else {
      const legacy = loadAutosave<LegacySnapshot>(autosaveKey);
      if (legacy) {
        const answered = new Set(legacy.answered ?? []);
        setRevealed(Object.fromEntries([...answered].map((id) => [id, true])));
        recorded.current = answered;
        // The old snapshot used one-per-page, so its index was the question.
        legacyIndex.current = Math.max(0, legacy.index ?? 0);
        setRestored(answered.size > 0);
      }
    }
    hydrated.current = true;
    // Restore once per session key; copying a stale session forward is worse
    // than starting clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveKey]);

  useEffect(() => {
    if (!data || !hydrated.current) return;
    saveAutosave<PracticeSnapshot>(autosaveKey, {
      page,
      pageSize,
      answers,
      revealed,
      flagged: [...flagged],
      activeId,
    });
  }, [data, autosaveKey, page, pageSize, answers, revealed, flagged, activeId]);

  /* ---------------- derived ---------------- */

  const questions = data?.questions ?? [];
  const total = questions.length;
  const bounds = useMemo(() => pageBounds(page, total, pageSize), [page, total, pageSize]);
  const visible = useMemo(
    () => questions.slice(bounds.start, bounds.end),
    [questions, bounds.start, bounds.end],
  );
  const answeredCount = useMemo(
    () => questions.filter((question) => revealed[question.id]).length,
    [questions, revealed],
  );
  const progress = total ? (answeredCount / total) * 100 : 0;

  const activeIndex = useMemo(() => {
    const found = questions.findIndex((question) => question.id === activeId);
    if (found >= 0) return found;
    return Math.min(bounds.start, Math.max(0, total - 1));
  }, [questions, activeId, bounds.start, total]);

  const currentQuestion = questions[activeIndex] ?? null;
  const indexById = useMemo(
    () => new Map(questions.map((question, index) => [question.id, index])),
    [questions],
  );

  useEffect(() => {
    const now = Date.now();
    for (const question of visible) {
      if (!questionTimers.current.has(question.id)) questionTimers.current.set(question.id, now);
    }
  }, [visible]);

  // Clamp a restored cursor once the real question count is known, and fold a
  // stored size the paper cannot fill into "All".
  useEffect(() => {
    if (!data) return;
    const fitted = fitPageSize(pageSize, total);
    if (fitted !== pageSize) {
      setPageSize(fitted);
      return;
    }
    if (legacyIndex.current !== null) {
      const index = Math.min(Math.max(0, legacyIndex.current), Math.max(0, total - 1));
      legacyIndex.current = null;
      const question = data.questions[index];
      setPage(pageOfQuestion(index, total, fitted));
      setActiveId(question?.id ?? null);
      pendingScrollId.current = question?.id ?? null;
      return;
    }
    setPage((current) => pageBounds(current, total, pageSize).page);
    setActiveId((current) => current ?? data.questions[0]?.id ?? null);
  }, [data, total, pageSize]);

  const restartHref = useMemo(() => {
    const params = new URLSearchParams({
      provider: providerId,
      exam: examKey,
      mode: random ? 'random' : 'practice',
      focus,
    });
    if (types) params.set('types', types);
    if (topic) params.set('topic', topic);
    if (count) params.set('count', String(count));
    if (random) params.set('random', '1');
    return `/practice/session?${params.toString()}`;
  }, [providerId, examKey, random, focus, types, topic, count]);

  /* ---------------- actions ---------------- */

  const goTo = useCallback(
    (index: number) => {
      if (total === 0) return;
      const target = Math.max(0, Math.min(total - 1, index));
      const question = questions[target];
      setPage(pageOfQuestion(target, total, pageSize));
      if (question) {
        setActiveId(question.id);
        pendingScrollId.current = question.id;
      }
      setPaletteOpen(false);
    },
    [questions, total, pageSize],
  );

  // Bring the cursor's card into view, whichever page it lives on.
  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    pendingScrollId.current = null;
    const card = [...document.querySelectorAll<HTMLElement>('[data-question-id]')].find(
      (element) => element.dataset.questionId === id,
    );
    if (!card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [page, pageSize, activeId]);

  const changePageSize = useCallback(
    (size: PageSize) => {
      const next = fitPageSize(size, total);
      setPageSizePreference('practice', String(next));
      setPageSize(next);
      setPage(pageOfQuestion(activeIndex, total, next));
      const question = questions[activeIndex];
      if (question) pendingScrollId.current = question.id;
    },
    [activeIndex, total, questions],
  );

  const toggle = useCallback((question: Question, key: string) => {
    setAnswers((current) => {
      const rules = selectionRulesFor(question);
      return {
        ...current,
        [question.id]: toggleSelection(current[question.id] ?? [], key, rules),
      };
    });
    setActiveId(question.id);
  }, []);

  const check = useCallback(
    (question: Question) => {
      const chosen = answers[question.id] ?? [];
      if (chosen.length === 0) return;
      const correctKey = question.answer ?? '';
      const sortedSelected = [...chosen].map((value) => value.toUpperCase()).sort().join('');
      const isCorrect = correctKey.length > 0 && sortedSelected === correctKey.split('').sort().join('');
      setRevealed((current) => ({ ...current, [question.id]: true }));
      if (!recorded.current.has(question.id)) {
        recorded.current.add(question.id);
        const started = questionTimers.current.get(question.id) ?? Date.now();
        recordAnswer({
          questionId: question.id,
          selected: chosen,
          correct: isCorrect,
          timeSpentMs: Math.max(0, Date.now() - started),
        });
      }
    },
    [answers, recordAnswer],
  );

  const clearAnswer = useCallback((question: Question) => {
    setAnswers((current) => ({ ...current, [question.id]: [] }));
  }, []);

  const retry = useCallback((question: Question) => {
    setAnswers((current) => ({ ...current, [question.id]: [] }));
    setRevealed((current) => {
      const next = { ...current };
      delete next[question.id];
      return next;
    });
    questionTimers.current.set(question.id, Date.now());
  }, []);

  const toggleFlag = useCallback((question: Question) => {
    setFlagged((current) => {
      const next = new Set(current);
      if (next.has(question.id)) next.delete(question.id);
      else next.add(question.id);
      return next;
    });
  }, []);

  const toggleBookmark = useCallback(
    async (question: Question) => {
      if (!user) {
        toast('Sign in to save bookmarks.', 'info');
        return;
      }
      const isSaved = bookmarked.has(question.id);
      setBookmarked((current) => {
        const next = new Set(current);
        if (isSaved) next.delete(question.id);
        else next.add(question.id);
        return next;
      });
      try {
        if (isSaved) {
          await del(
            `/bookmarks?examKey=${encodeURIComponent(examKey)}&questionId=${encodeURIComponent(question.id)}`,
          );
          toast('Bookmark removed', 'info');
        } else {
          await post('/bookmarks', { provider: providerId, exam: examKey, questionId: question.id });
          toast('Bookmarked', 'success');
        }
      } catch (err) {
        setBookmarked((current) => {
          const next = new Set(current);
          if (isSaved) next.add(question.id);
          else next.delete(question.id);
          return next;
        });
        toast((err as Error).message, 'error');
      }
    },
    [user, bookmarked, examKey, providerId, toast],
  );

  const openChat = useCallback(
    (question: Question) => {
      if (!user) {
        toast('Sign in to use the AI tutor.', 'info');
        return;
      }
      setChatQuestionId(question.id);
      setChatMounted(true);
      setChatOpen(true);
    },
    [user, toast],
  );

  /* ---------------- keyboard + swipe ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (paletteOpen || chatOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'g') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'j') {
        event.preventDefault();
        goTo(activeIndex + 1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'k') {
        event.preventDefault();
        goTo(activeIndex - 1);
        return;
      }
      if ((event.key === 'f' || event.key === 'F') && currentQuestion) {
        event.preventDefault();
        toggleFlag(currentQuestion);
        return;
      }
      if (currentQuestion && !revealed[currentQuestion.id]) {
        const numeric = Number(event.key);
        if (!Number.isInteger(numeric) || numeric < 1 || numeric > currentQuestion.choices.length) return;
        const choice = currentQuestion.choices[numeric - 1];
        if (!choice) return;
        event.preventDefault();
        toggle(currentQuestion, choice.key);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, chatOpen, activeIndex, goTo, currentQuestion, revealed, toggleFlag, toggle]);

  function onTouchStart(event: React.TouchEvent) {
    if (visible.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: React.TouchEvent) {
    if (visible.length !== 1) return;
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    goTo(activeIndex + (dx < 0 ? 1 : -1));
  }

  /* ---------------- palette items ---------------- */

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      questions.map((question, index) => ({
        id: question.id,
        label: String(index + 1),
        status: statusOf({ answered: Boolean(revealed[question.id]), flagged: flagged.has(question.id) }),
        current: question.id === currentQuestion?.id,
      })),
    [questions, revealed, flagged, currentQuestion?.id],
  );

  /* ---------------- states ---------------- */

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <ErrorState
          title="Could not load questions"
          description={error}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
        <div className="mt-4 flex justify-center">
          <Link href={`/exams/${encodeURIComponent(providerId)}`} className="btn-secondary btn-sm">
            Back to exam
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="panel p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-5 w-full" />
          <Skeleton className="mb-5 h-5 w-4/5" />
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="mb-2.5 h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon={<EmptyIcon name="book" />}
          title="No questions available"
          description="This exam has no questions unlocked yet. Try a different exam or check back after the next sync."
          action={
            <Link href="/exams" className="btn-primary btn-sm">
              Browse exams
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={cn('mx-auto w-full', chatOpen ? 'max-w-6xl' : 'max-w-3xl')}>
      {/* ---------- Session bar ---------- */}
      <header className="sticky top-14 z-30 -mx-3.5 mb-3 px-3.5 py-2 sm:top-16 sm:mx-0 sm:px-0">
        <div className="glass flex items-center gap-2 rounded-[1.25rem] border border-surface-border/70 px-2 py-1.5 shadow-sm sm:gap-2.5 sm:px-2.5">
          <Link
            href={`/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}`}
            className="icon-btn shrink-0"
            aria-label="Back to exam"
          >
            <IconArrowLeft />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-accent">
                {examKey}
              </span>
              <span className="truncate text-[0.8125rem] font-semibold">
                {visible.length > 1 ? `${bounds.start + 1}–${bounds.end}` : `Q${activeIndex + 1}`}
                <span className="text-content-muted"> / {total}</span>
              </span>
              {restored ? (
                <span className="badge badge-accent hidden md:inline-flex">Resumed</span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={progress} className="h-1" label="Session progress" />
              <span className="numeric shrink-0 text-[0.6875rem] font-semibold text-content-muted sm:hidden">
                {elapsedLabel(elapsedMs)}
              </span>
              <span className="numeric hidden shrink-0 text-[0.6875rem] font-semibold text-content-muted sm:inline">
                {answeredCount}/{total}
              </span>
            </div>
          </div>

          <div
            role="timer"
            aria-label="Time in this session"
            className="numeric hidden shrink-0 items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-[0.75rem] font-bold text-content-secondary sm:flex"
          >
            <IconClock width={13} height={13} />
            {elapsedLabel(elapsedMs)}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="icon-btn relative"
              aria-label="Open question navigator"
            >
              <IconGrid />
              {flagged.size > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-caution px-1 text-[0.5625rem] font-bold text-[rgb(var(--accent-contrast))]">
                  {flagged.size}
                </span>
              ) : null}
            </button>
            <Link
              href={restartHref}
              onClick={() => clearAutosave(autosaveKey)}
              className="icon-btn hidden sm:inline-flex"
              aria-label="Restart session"
            >
              <IconRefresh />
            </Link>
          </div>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[1.1rem] border border-surface-border bg-surface-raised/70 px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-[0.75rem] font-semibold text-content-primary">
            Showing {visible.length} of {total}
          </p>
          <p className="caption truncate text-[0.6875rem]">{rangeLabel(bounds.start, bounds.end, total)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="caption hidden shrink-0 sm:inline">Per page</span>
          <PageSizePicker value={pageSize} total={total} onChange={changePageSize} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          {/* ---------- Questions on this page ---------- */}
          <div
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className={cn('flex flex-col gap-4', visible.length === 1 && 'touch-pan-y')}
          >
            {visible.map((question) => {
              const index = indexById.get(question.id) ?? 0;
              const chosen = answers[question.id] ?? [];
              const isRevealed = Boolean(revealed[question.id]);
              const key = question.answer ?? '';
              const isCorrect =
                isRevealed && key.length > 0
                  ? [...chosen].map((value) => value.toUpperCase()).sort().join('') ===
                    key.split('').sort().join('')
                  : null;
              return (
                <PracticeQuestion
                  key={question.id}
                  question={question}
                  index={index}
                  total={total}
                  compact={visible.length > 1}
                  providerId={providerId}
                  examKey={examKey}
                  selected={chosen}
                  revealed={isRevealed}
                  correct={isCorrect}
                  flagged={flagged.has(question.id)}
                  bookmarked={bookmarked.has(question.id)}
                  aiEnabled={aiEnabled}
                  aiRemaining={aiRemaining}
                  showShortcuts={visible.length === 1}
                  active={visible.length > 1 && question.id === currentQuestion?.id}
                  onToggle={(choice) => toggle(question, choice)}
                  onCheck={() => check(question)}
                  onClear={() => clearAnswer(question)}
                  onRetry={() => retry(question)}
                  onToggleFlag={() => toggleFlag(question)}
                  onToggleBookmark={() => void toggleBookmark(question)}
                  onAskAi={() => openChat(question)}
                  onNext={
                    index < total - 1 && visible.length === 1 ? () => goTo(index + 1) : undefined
                  }
                  onAiUsage={setAiRemaining}
                />
              );
            })}
          </div>

          <QuestionPager
            className="mt-3"
            page={bounds.page}
            pages={pageCount(total, pageSize)}
            start={bounds.start}
            end={bounds.end}
            total={total}
            onPage={(next) => goTo(pageBounds(next, total, pageSize).start)}
          />

          <p className="caption mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
            {visible.length > 1 ? (
              <span className="w-full text-[0.6875rem] text-content-muted">
                Shortcuts act on the outlined question.
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <span className="kbd">←</span>
              <span className="kbd">→</span> move
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="kbd">1</span>–<span className="kbd">9</span> pick
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="kbd">F</span> flag
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="kbd">G</span> navigator
            </span>
          </p>

          {answeredCount > 0 && answeredCount === total ? (
            <div className="panel mt-4 flex items-center gap-3 p-4">
              <ProgressRing value={100} size={52} tone="success">
                <IconCheck className="h-5 w-5 text-positive" />
              </ProgressRing>
              <div className="min-w-0 flex-1">
                <p className="heading-3">Session complete</p>
                <p className="caption">
                  You worked through all {total} questions in {elapsedLabel(elapsedMs)}.
                </p>
              </div>
              <button type="button" onClick={() => router.push('/dashboard')} className="btn-primary btn-sm shrink-0">
                <IconChart className="h-4 w-4" />
                Progress
              </button>
            </div>
          ) : null}
        </div>

        {/* ---------- AI tutor beside the question ---------- */}
        {chatMounted ? (
          <AiDock open={chatOpen} onClose={() => setChatOpen(false)} title="Ask AI about this question">
            <AiChat
              key={chatQuestionId ?? 'practice'}
              variant="panel"
              providerId={providerId}
              examKey={examKey}
              questionId={chatQuestionId ?? undefined}
              examLabel={examKey}
              learnerChoice={chatQuestionId ? answers[chatQuestionId] ?? [] : []}
              onClose={() => setChatOpen(false)}
            />
          </AiDock>
        ) : null}
      </div>

      {/* ---------- Navigator ---------- */}
      <Drawer open={paletteOpen} onClose={() => setPaletteOpen(false)} title="Question navigator" side="bottom">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <div>
            <p className="heading-3">Question navigator</p>
            <p className="caption mt-0.5">
              {answeredCount} answered · {flagged.size} flagged · {total - answeredCount} left
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(false)}
            className="icon-btn"
            aria-label="Close navigator"
          >
            <IconX />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5">
          <p className="text-[0.75rem] font-semibold text-content-secondary">Questions per page</p>
          <PageSizePicker value={pageSize} total={total} onChange={changePageSize} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <QuestionPalette items={paletteItems} onJump={goTo} columns="fixed" className="min-h-0 flex-1" />
        </div>

        <div className="flex items-center gap-2 border-t border-surface-border p-3">
          <button
            type="button"
            onClick={() => {
              const nextFlagged = questions.findIndex(
                (question, index) => flagged.has(question.id) && index > activeIndex,
              );
              goTo(nextFlagged >= 0 ? nextFlagged : questions.findIndex((q) => flagged.has(q.id)));
            }}
            disabled={flagged.size === 0}
            className="btn-secondary flex-1"
          >
            <IconFlag className="h-4 w-4" /> Next flagged
          </button>
          <button type="button" onClick={() => setPaletteOpen(false)} className="btn-primary flex-1">
            Back to question
          </button>
        </div>
      </Drawer>
    </div>
  );
}
