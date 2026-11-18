'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { del, get, post } from '@/lib/api';
import type { Question, QuestionsResponse } from '@/lib/types';
import { Drawer, EmptyIcon, EmptyState, ErrorState, Skeleton } from './ui';
import { IconArrowLeft, IconArrowRight, IconCheck } from './icons';
import { QuestionWorkspace } from './workspace/question-workspace';
import { QuestionSheet } from './workspace/question-sheet';
import { QuestionMap, type MapItem } from './workspace/question-map';
import { StudyCompanion, type CompanionTab } from './workspace/study-companion';
import { cn } from '@/lib/format';
import { loadAllQuestionPages } from '@/lib/load-questions';
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
  selectionRulesFor,
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
  count,
}: {
  providerId: string;
  examKey: string;
  mode: Mode;
  focus?: string;
  count?: number;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const autosaveKey = `${providerId}/${examKey}/${mode}/${focus}/${count ?? 'all'}`;

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
  const [mapOpen, setMapOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionTab, setCompanionTab] = useState<CompanionTab>('guide');
  const [restored, setRestored] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);

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
    const pageSize = 200;
    const target = count && count > 0 ? count : null;

    async function loadAll() {
      try {
        let first: QuestionsResponse | null = null;
        const collected = await loadAllQuestionPages<Question>(async (offset, limit) => {
          const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
            mode,
            includeAnswer: 'true',
            focus,
          });
          const res = await get<QuestionsResponse>(
            `/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}/questions?${params.toString()}`,
          );
          if (!first) first = res;
          return {
            questions: res.questions,
            accessible: res.entitlement.accessibleQuestions,
          };
        }, target, pageSize);

        if (!cancelled && first) {
          const response = first as QuestionsResponse;
          setData({ ...response, questions: collected });
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, mode, focus, count, reloadKey]);

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
      mode: 'practice',
      focus,
    });
    if (count) params.set('count', String(count));
    return `/practice/session?${params.toString()}`;
  }, [providerId, examKey, focus, count]);

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
      setMapOpen(false);
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

  const openGuide = useCallback(
    (tab: CompanionTab, questionId?: string) => {
      if (questionId) setActiveId(questionId);
      setCompanionTab(tab);
      setCompanionOpen(true);
      setMapOpen(false);
    },
    [],
  );

  const consumeAi = useCallback(() => {
    setAiRemaining((current) => (current === null ? null : Math.max(0, current - 1)));
  }, []);

  /* ---------------- keyboard + swipe ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (mapOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'g') {
        event.preventDefault();
        setMapOpen(true);
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
      if ((event.key === 'h' || event.key === 'H') && currentQuestion) {
        event.preventDefault();
        openGuide('guide', currentQuestion.id);
        return;
      }
      if ((event.key === 'e' || event.key === 'E') && currentQuestion) {
        event.preventDefault();
        openGuide('explain', currentQuestion.id);
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
  }, [mapOpen, activeIndex, goTo, currentQuestion, revealed, toggleFlag, toggle, openGuide]);

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

  /* ---------------- session map ---------------- */

  const paletteItems: MapItem[] = useMemo(
    () =>
      questions.map((question, index) => ({
        id: question.id,
        index,
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

  const pages = pageCount(total, pageSize);
  const complete = total > 0 && answeredCount === total;
  const activeCorrect =
    currentQuestion && revealed[currentQuestion.id] && currentQuestion.answer
      ? [...(answers[currentQuestion.id] ?? [])].map((value) => value.toUpperCase()).sort().join('') ===
        currentQuestion.answer.split('').sort().join('')
      : null;

  const map = (variant: 'rail' | 'sheet', close?: () => void) => (
    <QuestionMap
      items={paletteItems}
      answered={answeredCount}
      flagged={flagged.size}
      pageSize={pageSize}
      onPageSize={changePageSize}
      onJump={goTo}
      variant={variant}
      onClose={close}
    />
  );

  return (
    <>
      <QuestionWorkspace
        mode="practice"
        examCode={examKey}
        backHref={`/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}`}
        backLabel="Back to exam"
        total={total}
        answered={answeredCount}
        flagged={flagged.size}
        progress={progress}
        range={rangeLabel(bounds.start, bounds.end, total)}
        timer={{ label: elapsedLabel(elapsedMs) }}
        onOpenMap={() => {
          setMapOpen(true);
          setCompanionOpen(false);
        }}
        onOpenGuide={(tab) => openGuide(tab, currentQuestion?.id)}
        rail={map('rail')}
        companion={
          <StudyCompanion
            question={currentQuestion}
            questionIndex={activeIndex}
            mode="practice"
            selected={currentQuestion ? answers[currentQuestion.id] ?? [] : []}
            revealed={currentQuestion ? Boolean(revealed[currentQuestion.id]) : false}
            correct={activeCorrect}
            providerId={providerId}
            examKey={examKey}
            examLabel={examKey}
            aiEnabled={aiEnabled}
            remaining={aiRemaining}
            tab={companionTab}
            onTab={setCompanionTab}
            onConsumed={consumeAi}
            open={companionOpen}
            onClose={() => setCompanionOpen(false)}
          />
        }
      >
        <div className="min-w-0">
          <div
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className={cn(visible.length === 1 && 'touch-pan-y')}
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
                <QuestionSheet
                  key={question.id}
                  question={question}
                  index={index}
                  total={total}
                  mode="practice"
                  selected={chosen}
                  revealed={isRevealed}
                  correct={isCorrect}
                  flagged={flagged.has(question.id)}
                  bookmarked={bookmarked.has(question.id)}
                  providerId={providerId}
                  examKey={examKey}
                  compact={visible.length > 1}
                  active={visible.length > 1 && question.id === currentQuestion?.id}
                  showShortcuts={visible.length === 1}
                  aiEnabled={aiEnabled}
                  onToggle={(choice) => toggle(question, choice)}
                  onCheck={() => check(question)}
                  onClear={() => clearAnswer(question)}
                  onRetry={() => retry(question)}
                  onToggleFlag={() => toggleFlag(question)}
                  onToggleBookmark={() => void toggleBookmark(question)}
                  onOpenGuide={(tab) => openGuide(tab, question.id)}
                  onNext={index < total - 1 && visible.length === 1 ? () => goTo(index + 1) : undefined}
                />
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-surface-border/70 pt-4">
            <button
              type="button"
              onClick={() => goTo(pageBounds(bounds.page - 1, total, pageSize).start)}
              disabled={bounds.page <= 0}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary disabled:opacity-35"
            >
              <IconArrowLeft width={15} height={15} /> Previous
            </button>
            <div className="text-center">
              <p className="numeric text-[0.75rem] font-semibold text-content-primary">
                {rangeLabel(bounds.start, bounds.end, total)}
              </p>
              <p className="text-[0.6875rem] text-content-muted">
                {pages <= 1 ? 'All on one page' : `Page ${bounds.page + 1} of ${pages}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => goTo(pageBounds(bounds.page + 1, total, pageSize).start)}
              disabled={bounds.page >= pages - 1}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary disabled:opacity-35"
            >
              Next <IconArrowRight width={15} height={15} />
            </button>
          </div>

          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.6875rem] text-content-muted">
            {visible.length > 1 ? (
              <span className="w-full text-center">Shortcuts act on the focused question.</span>
            ) : null}
            <span>
              <span className="kbd">←</span> <span className="kbd">→</span> move
            </span>
            <span>
              <span className="kbd">1</span>–<span className="kbd">9</span> pick
            </span>
            <span>
              <span className="kbd">F</span> flag
            </span>
            <span>
              <span className="kbd">H</span> hint
            </span>
            <span>
              <span className="kbd">E</span> explain
            </span>
            <span>
              <span className="kbd">G</span> map
            </span>
          </p>

          {complete ? (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-accent/[0.06] px-4 py-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-positive/15 text-positive">
                <IconCheck width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content-primary">Session complete</p>
                <p className="text-[0.75rem] text-content-muted">
                  You worked through all {total} questions in {elapsedLabel(elapsedMs)}.
                </p>
              </div>
              <button type="button" onClick={() => router.push('/dashboard')} className="btn-secondary btn-sm">
                View progress
              </button>
            </div>
          ) : null}
        </div>
      </QuestionWorkspace>

      <Drawer open={mapOpen} onClose={() => setMapOpen(false)} title="Session map" side="bottom">
        <div className="flex min-h-0 flex-1 flex-col">
          {map('sheet', () => setMapOpen(false))}
        </div>
      </Drawer>
    </>
  );
}
