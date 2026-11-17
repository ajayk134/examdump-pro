'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import type { Question } from '@/lib/types';
import { QuestionStage, selectionRulesFor } from './question-stage';
import { QuestionContent } from './question-content';
import { AiChat } from './ai-chat';
import {
  PageSizePicker,
  QuestionPalette,
  QuestionPager,
  type PaletteItem,
} from './question-session-controls';
import {
  Alert,
  Dialog,
  Drawer,
  EmptyIcon,
  EmptyState,
  ProgressBar,
  ProgressRing,
  Skeleton,
  StatStrip,
} from './ui';
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconFlag,
  IconGrid,
  IconMessage,
  IconRefresh,
  IconX,
} from './icons';
import { cn, formatDuration } from '@/lib/format';
import { clearAutosave, loadAutosave, saveAutosave, getPageSizePreference, setPageSizePreference } from '@/lib/local-store';
import {
  DEFAULT_PAGE_SIZE,
  pageBounds,
  pageCount,
  pageOfQuestion,
  parsePageSize,
  statusOf,
  toggleSelection,
  type PageSize,
} from '@/lib/question-session';

interface StartResponse {
  attempt: {
    id: string;
    mode: string;
    status: string;
    questionIds: string[];
    totalQuestions: number;
    timeLimitSeconds: number | null;
    startedAt: string;
  };
  exam: { key: string; code: string; title: string; providerId: string; providerTitle: string };
  questions: Question[];
  entitlement: { plan: string; accessibleQuestions: number; totalQuestions: number; isLimited: boolean };
}

interface ResultItem {
  questionId: string;
  selected: string[];
  correctAnswer: string;
  correct: boolean;
  explanation: string;
  topic: string;
}

interface CompleteResponse {
  attempt: {
    id: string;
    totalQuestions: number;
    answeredCount: number;
    correctCount: number;
    scorePercent: number;
    timeSpentMs: number;
    completedAt: string;
  };
  results: ResultItem[];
  stats: { currentStreak: number; longestStreak: number; totalQuestions: number; totalCorrect: number };
}

/** The immutable part of a sitting, stored once so a reload can resume it. */
interface MockPlanSnapshot {
  attemptId: string;
  questions: Question[];
  exam: StartResponse['exam'];
  entitlement: StartResponse['entitlement'];
  mode: string;
  timeLimitSeconds: number | null;
  startedAt: string;
}

/** The mutable part, saved as the learner answers. */
interface MockStateSnapshot {
  answers: Record<string, string[]>;
  page: number;
  pageSize: PageSize;
  flagged: string[];
  activeId: string | null;
}

interface AttemptRow {
  id: string;
  providerId: string;
  examKey: string;
  mode: string;
  status: string;
  questionIds: string[];
  totalQuestions: number;
  timeLimitSeconds: number | null;
  startedAt: string;
}

type ReviewFilter = 'all' | 'incorrect' | 'unanswered' | 'flagged';

/**
 * Mock exam simulator.
 *
 * Exam conditions are preserved: no answer key reaches the browser, nothing is
 * graded until submission, and the timer is authoritative. Paging, the question
 * navigator and review flags are presentation only — the submitted payload is
 * exactly the same as before.
 */
export function MockSession({
  providerId,
  examKey,
  mode,
  count,
  durationSeconds,
}: {
  providerId: string;
  examKey: string;
  mode: 'mock' | 'timed';
  count?: number;
  durationSeconds?: number | null;
}) {
  const [session, setSession] = useState<StartResponse | null>(null);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [chatQuestionId, setChatQuestionId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const startedAt = useRef<number>(Date.now());
  const submittedRef = useRef(false);
  const hydrated = useRef(false);
  // A palette jump can land on another page; scroll once that page renders.
  const pendingScrollId = useRef<string | null>(null);

  const planKey = `mock-plan/${providerId}/${examKey}/${mode}/${count ?? 'paper'}/${durationSeconds ?? 'default'}`;

  useEffect(() => {
    let cancelled = false;
    const storedSize = parsePageSize(getPageSizePreference('mock'));
    const savedPlan = loadAutosave<MockPlanSnapshot>(planKey);
    const stateKey = savedPlan?.attemptId ? `mock-state/${savedPlan.attemptId}` : '';
    const savedState = stateKey ? loadAutosave<MockStateSnapshot>(stateKey) : null;

    /**
     * Resume only when the server still reports the same sitting in progress.
     * The stored questions are what the learner was actually shown; the server
     * re-grades the same ids on submission.
     */
    const restore = async (): Promise<boolean> => {
      if (!savedPlan?.attemptId || !Array.isArray(savedPlan.questions) || savedPlan.questions.length === 0) {
        return false;
      }
      if (savedPlan.mode !== mode || savedPlan.exam?.key !== examKey) return false;
      let attempt: AttemptRow;
      try {
        ({ attempt } = await get<{ attempt: AttemptRow }>(`/attempts/${savedPlan.attemptId}`));
      } catch {
        return false;
      }
      if (!attempt || attempt.status !== 'in_progress') return false;
      if (attempt.providerId !== providerId || attempt.examKey !== examKey) return false;
      if (cancelled) return true;

      startedAt.current = new Date(attempt.startedAt).getTime();
      setSession({
        attempt: {
          id: attempt.id,
          mode: attempt.mode,
          status: attempt.status,
          questionIds: attempt.questionIds,
          totalQuestions: attempt.totalQuestions,
          timeLimitSeconds: attempt.timeLimitSeconds,
          startedAt: attempt.startedAt,
        },
        exam: savedPlan.exam,
        questions: savedPlan.questions,
        entitlement: savedPlan.entitlement,
      });
      if (storedSize) setPageSize(storedSize);
      else if (savedState?.pageSize) setPageSize(savedState.pageSize);
      if (savedState) {
        setAnswers(savedState.answers ?? {});
        setPage(savedState.page ?? 0);
        setFlagged(new Set(savedState.flagged ?? []));
        setActiveId(savedState.activeId ?? null);
      }
      if (attempt.timeLimitSeconds !== null) {
        const elapsed = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
        setTimeLeft(Math.max(0, attempt.timeLimitSeconds - elapsed));
      }
      setResumed(Boolean(savedState && Object.keys(savedState.answers ?? {}).length > 0));
      hydrated.current = true;
      return true;
    };

    void (async () => {
      if (await restore()) return;
      if (cancelled) return;
      // The saved sitting is gone or finished; never start from stale answers.
      if (savedPlan) clearAutosave(planKey);
      if (stateKey) clearAutosave(stateKey);

      startedAt.current = Date.now();
      try {
        const data = await post<StartResponse>('/attempts', {
          provider: providerId,
          exam: examKey,
          mode,
          ...(count ? { count } : {}),
          ...(mode === 'timed' ? { timeLimitSeconds: durationSeconds ?? 3600 } : {}),
        });
        if (cancelled) return;
        setSession(data);
        if (data.attempt.timeLimitSeconds) setTimeLeft(data.attempt.timeLimitSeconds);
        if (storedSize) setPageSize(storedSize);
        saveAutosave<MockPlanSnapshot>(planKey, {
          attemptId: data.attempt.id,
          questions: data.questions,
          exam: data.exam,
          entitlement: data.entitlement,
          mode,
          timeLimitSeconds: data.attempt.timeLimitSeconds,
          startedAt: data.attempt.startedAt,
        });
        hydrated.current = true;
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 403) setUpgrade(true);
        if (status === 401) setNeedsAuth(true);
        setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, mode, count, durationSeconds, planKey]);

  const submit = useCallback(
    async (currentSession: StartResponse, currentAnswers: Record<string, string[]>, auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const payload = {
          answers: Object.entries(currentAnswers)
            .filter(([, selected]) => selected.length > 0)
            .map(([questionId, selected]) => ({ questionId, selected })),
          timeSpentMs: Date.now() - startedAt.current,
        };
        const data = await post<CompleteResponse>(`/attempts/${currentSession.attempt.id}/complete`, payload);
        setResult(data);
        void auto;
      } catch (err) {
        submittedRef.current = false;
        setError((err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (timeLeft === null || result) return;
    if (timeLeft <= 0) {
      if (session) void submit(session, answers, true);
      return;
    }
    const timer = setTimeout(() => setTimeLeft((value) => (value === null ? null : value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, result, session, answers, submit]);

  /* ---------- autosave: survive a refresh or accidental navigation ---------- */

  useEffect(() => {
    if (!session || !hydrated.current) return;
    saveAutosave<MockStateSnapshot>(`mock-state/${session.attempt.id}`, {
      answers,
      page,
      pageSize,
      flagged: [...flagged],
      activeId,
    });
  }, [session, answers, page, pageSize, flagged, activeId]);

  // Clear both snapshots once the attempt is graded.
  useEffect(() => {
    if (!result || !session) return;
    clearAutosave(planKey);
    clearAutosave(`mock-state/${session.attempt.id}`);
  }, [result, session, planKey]);

  const questions = session?.questions ?? [];
  const total = questions.length;
  const bounds = useMemo(() => pageBounds(page, total, pageSize), [page, total, pageSize]);
  const visible = useMemo(() => questions.slice(bounds.start, bounds.end), [questions, bounds.start, bounds.end]);

  const answeredCount = useMemo(
    () => Object.values(answers).filter((value) => value.length > 0).length,
    [answers],
  );

  const activeIndex = useMemo(() => {
    const found = questions.findIndex((question) => question.id === activeId);
    if (found >= 0) return found;
    return Math.min(bounds.start, Math.max(0, total - 1));
  }, [questions, activeId, bounds.start, total]);

  const currentQuestion = questions[activeIndex] ?? null;

  useEffect(() => {
    if (!session) return;
    const stored = parsePageSize(getPageSizePreference('mock'));
    if (stored && stored !== pageSize) setPageSize(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Keep a restored page inside range once the paper is known.
  useEffect(() => {
    if (!session) return;
    setPage((current) => pageBounds(current, total, pageSize).page);
    setActiveId((current) => current ?? session.questions[0]?.id ?? null);
  }, [session, total, pageSize]);

  const toggle = useCallback((question: Question, key: string) => {
    const rules = selectionRulesFor(question);
    setAnswers((previous) => ({
      ...previous,
      // The mock payload carries no answer key, so a multi-answer item must not
      // cap how many options the learner may pick.
      [question.id]: toggleSelection(previous[question.id] ?? [], key, {
        multi: rules.multi,
        limit: question.answer ? rules.limit : 0,
      }),
    }));
    setActiveId(question.id);
  }, []);

  const clearAnswer = (question: Question) => {
    setAnswers((previous) => ({ ...previous, [question.id]: [] }));
  };

  const toggleFlag = useCallback((question: Question) => {
    setFlagged((previous) => {
      const next = new Set(previous);
      if (next.has(question.id)) next.delete(question.id);
      else next.add(question.id);
      return next;
    });
  }, []);

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
      setPageSizePreference('mock', String(size));
      setPageSize(size);
      setPage(pageOfQuestion(activeIndex, total, size));
    },
    [activeIndex, total],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (paletteOpen || confirmOpen) return;
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
      if (!currentQuestion) return;
      const numeric = Number(event.key);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > currentQuestion.choices.length) return;
      const choice = currentQuestion.choices[numeric - 1];
      if (!choice) return;
      event.preventDefault();
      toggle(currentQuestion, choice.key);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, confirmOpen, activeIndex, goTo, currentQuestion, toggleFlag, toggle]);

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      questions.map((question, index) => ({
        id: question.id,
        label: String(index + 1),
        status: statusOf({
          answered: (answers[question.id]?.length ?? 0) > 0,
          flagged: flagged.has(question.id),
        }),
        current: question.id === currentQuestion?.id,
      })),
    [questions, answers, flagged, currentQuestion?.id],
  );

  const reviewRows = useMemo(() => {
    if (!result) return [];
    return result.results.filter((item) => {
      if (reviewFilter === 'incorrect') return !item.correct;
      if (reviewFilter === 'unanswered') return item.selected.length === 0;
      if (reviewFilter === 'flagged') return flagged.has(item.questionId);
      return true;
    });
  }, [result, reviewFilter, flagged]);

  if (error && !session) {
    const backToMock = `/mock/session?${new URLSearchParams({
      provider: providerId,
      exam: examKey,
      mode,
      ...(count ? { count: String(count) } : {}),
      ...(durationSeconds ? { duration: String(durationSeconds) } : {}),
    }).toString()}`;

    if (needsAuth) {
      return (
        <div className="mx-auto max-w-lg py-6">
          <EmptyState
            icon={<EmptyIcon name="book" />}
            title="Sign in to sit this mock"
            description="Mock exams are timed and scored, so they are tied to your account. Sign in and you will come straight back to this exam."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link href={`/login?next=${encodeURIComponent(backToMock)}`} className="btn-primary">
                  Sign in
                </Link>
                <Link
                  href={`/practice?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
                  className="btn-secondary"
                >
                  Practise instead
                </Link>
              </div>
            }
          />
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-lg py-6">
        <Alert tone="error">{error}</Alert>
        <div className="mt-4 flex flex-wrap gap-2">
          {upgrade ? (
            <Link href="/pricing" className="btn-primary">
              See plans
            </Link>
          ) : null}
          <Link
            href={`/mock?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
            className="btn-secondary"
          >
            Back to the simulator
          </Link>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="panel p-5" role="status" aria-live="polite">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-sm font-semibold">Preparing your exam...</p>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-2/5" />
          </div>
          <ul className="mt-4 space-y-1.5 text-xs text-content-muted">
            <li>· Selecting fresh questions from the private bank</li>
            <li>· Shuffling answer options</li>
            <li>· Starting your timer</li>
          </ul>
        </div>
      </div>
    );
  }

  /* ---------------- Score report and review ---------------- */

  if (result) {
    const score = result.attempt.scorePercent;
    const incorrect = result.results.filter((item) => !item.correct).length;
    const unanswered = result.results.filter((item) => item.selected.length === 0).length;
    const filters: Array<{ id: ReviewFilter; label: string; count: number }> = [
      { id: 'all', label: 'All', count: result.results.length },
      { id: 'incorrect', label: 'Incorrect', count: incorrect },
      { id: 'unanswered', label: 'Skipped', count: unanswered },
      { id: 'flagged', label: 'Flagged', count: result.results.filter((item) => flagged.has(item.questionId)).length },
    ];

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="relative overflow-hidden rounded-[2rem] border border-surface-border bg-surface-raised p-5 text-center shadow-sm sm:p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-brand-500/[0.12] via-accent-2/[0.06] to-transparent"
          />
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 via-accent-2 to-aqua-400" />
          <p className="eyebrow">Exam complete</p>
          <div className="mt-3 flex justify-center">
            <ProgressRing value={score} size={116} stroke={9} tone={score >= 70 ? 'success' : 'warning'}>
              <span className="numeric text-3xl font-black tracking-tight">{score}%</span>
            </ProgressRing>
          </div>
          <p className="mt-3 text-sm text-content-secondary">
            {result.attempt.correctCount} of {result.attempt.totalQuestions} correct ·{' '}
            {formatDuration(result.attempt.timeSpentMs)}
          </p>
          <p className="mt-3 text-sm font-medium text-content-secondary">
            {score >= 85
              ? 'Exam-ready. Keep this momentum with a timed run.'
              : score >= 70
                ? 'Close to the pass mark — review the misses below.'
                : 'Focus on the weak topics below, then retry.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={() => window.location.reload()} className="btn-primary">
              <IconRefresh width={16} height={16} /> Try another mock
            </button>
            <Link href="/dashboard" className="btn-secondary">
              View dashboard
            </Link>
            <Link
              href={`/ask?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
              className="btn-secondary"
            >
              <IconMessage width={16} height={16} /> Ask the tutor
            </Link>
            <Link href={`/exams/${encodeURIComponent(providerId)}`} className="btn-ghost">
              Back to exams
            </Link>
          </div>
        </div>

        <div className="panel px-1 py-1">
          <StatStrip
            columns={3}
            items={[
              { label: 'Correct', value: result.attempt.correctCount, tone: 'success' },
              { label: 'Incorrect', value: result.attempt.totalQuestions - result.attempt.correctCount, tone: 'default' },
              { label: 'Streak', value: `${result.stats.currentStreak}d`, tone: 'brand' },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="heading-2">Review your answers</h2>
            <p className="caption mt-1">
              Every question now shows the verified answer and the explanation. Flags are kept from the
              sitting.
            </p>
          </div>
        </div>

        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter review">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setReviewFilter(filter.id)}
              aria-pressed={reviewFilter === filter.id}
              className={cn(
                'chip shrink-0',
                reviewFilter === filter.id ? 'chip-active' : 'text-content-secondary',
              )}
            >
              {filter.label}
              <span className="numeric text-[0.6875rem] opacity-80">{filter.count}</span>
            </button>
          ))}
        </div>

        {reviewRows.length === 0 ? (
          <EmptyState
            icon={<EmptyIcon name="spark" />}
            title="Nothing in this filter"
            description="Switch the filter to see the rest of your answers."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {reviewRows.map((item) => {
              const position = result.results.findIndex((row) => row.questionId === item.questionId);
              const question = questions.find((row) => row.id === item.questionId);
              return (
                <details key={item.questionId} className="group rounded-[1.5rem] border border-surface-border bg-surface-raised shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold',
                        item.correct ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative',
                      )}
                    >
                      {item.correct ? <IconCheck width={15} height={15} /> : <IconX width={15} height={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        Question {position + 1}
                        {item.selected.length === 0 ? (
                          <span className="ml-1.5 text-xs font-medium text-caution">skipped</span>
                        ) : null}
                        {flagged.has(item.questionId) ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-medium text-caution">
                            <IconFlag width={11} height={11} /> flagged
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-content-muted">{item.topic}</span>
                    </span>
                    <span className="badge shrink-0">
                      {[...item.selected].sort().join('') || '—'} → {item.correctAnswer}
                    </span>
                  </summary>

                  <div className="border-t border-surface-border px-4 py-3.5">
                    {question ? (
                      <div className="text-[0.9375rem] leading-relaxed">
                        <QuestionContent items={question.stem} />
                      </div>
                    ) : null}

                    {question ? (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {question.choices.map((choice) => {
                          const isAnswer = item.correctAnswer.includes(choice.key);
                          const isPicked = item.selected.includes(choice.key);
                          return (
                            <li
                              key={choice.key}
                              className={cn(
                                'flex items-start gap-2.5 rounded-[0.85rem] border px-3 py-2 text-sm',
                                isAnswer
                                  ? 'border-positive/45 bg-positive/[0.07]'
                                  : isPicked
                                    ? 'border-negative/45 bg-negative/[0.06]'
                                    : 'border-surface-border bg-surface-base opacity-80',
                              )}
                            >
                              <span
                                className={cn(
                                  'numeric mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[0.5rem] text-[0.6875rem] font-bold',
                                  isAnswer
                                    ? 'bg-positive text-white'
                                    : isPicked
                                      ? 'bg-negative text-white'
                                      : 'bg-surface-inset text-content-muted',
                                )}
                              >
                                {choice.key}
                              </span>
                              <span className="min-w-0 flex-1">
                                <QuestionContent items={choice.content} />
                              </span>
                              {isAnswer ? (
                                <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wide text-positive">
                                  Correct
                                </span>
                              ) : isPicked ? (
                                <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wide text-negative">
                                  Your pick
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}

                    <p className="mt-3 text-xs text-content-muted">
                      Your answer:{' '}
                      <b className={cn('numeric', item.correct ? 'text-positive' : 'text-negative')}>
                        {item.selected.join('') || 'none'}
                      </b>
                      {' · '}Correct answer: <b className="numeric text-positive">{item.correctAnswer}</b>
                    </p>

                    {item.explanation ? (
                      <div className="mt-2.5 rounded-[0.9rem] border border-surface-border bg-surface-overlay/40 p-3">
                        <p className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-content-muted">
                          Explanation
                        </p>
                        <div className="answer-prose text-sm">
                          <QuestionContent items={[{ type: 'text', value: item.explanation }]} />
                        </div>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setChatQuestionId(item.questionId)}
                      className="btn-secondary btn-sm mt-3"
                    >
                      <IconMessage width={14} height={14} /> Ask AI about this
                    </button>
                  </div>
                </details>
              );
            })}
          </div>
        )}

        <Drawer
          open={Boolean(chatQuestionId)}
          onClose={() => setChatQuestionId(null)}
          title="Ask AI about this question"
        >
          {chatQuestionId ? (
            <AiChat
              key={chatQuestionId}
              providerId={providerId}
              examKey={examKey}
              questionId={chatQuestionId}
              examLabel={examKey}
              learnerChoice={
                result.results.find((item) => item.questionId === chatQuestionId)?.selected ?? []
              }
              onClose={() => setChatQuestionId(null)}
            />
          ) : null}
        </Drawer>
      </div>
    );
  }

  if (!currentQuestion) return <Alert tone="warning">This mock exam has no questions.</Alert>;

  const answeredNow = (answers[currentQuestion.id]?.length ?? 0) > 0;
  const timeLow = timeLeft !== null && timeLeft < 300;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {resumed ? <Alert tone="info">Your previous answers were restored. Submission is unchanged.</Alert> : null}

      {/* Sticky exam header: state, clock, navigator */}
      <header className="sticky top-14 z-30 -mx-3.5 px-3.5 py-2 sm:top-16 sm:mx-0 sm:px-0">
        <div className="glass flex items-center gap-2 rounded-[1.25rem] border border-surface-border/70 px-2 py-1.5 shadow-sm sm:gap-2.5 sm:px-2.5">
          <Link
            href={`/mock?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
            className="icon-btn shrink-0"
            aria-label="Leave the mock and return to the simulator"
          >
            <IconArrowLeft />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-accent">
                {session.exam.code}
              </span>
              <span className="truncate text-[0.8125rem] font-semibold">
                Q{activeIndex + 1}
                <span className="text-content-muted"> / {total}</span>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar
                value={total ? (answeredCount / total) * 100 : 0}
                className="h-1"
                label="Exam progress"
              />
              <span className="numeric shrink-0 text-[0.6875rem] font-semibold text-content-muted">
                {answeredCount}/{total}
              </span>
            </div>
          </div>

          {timeLeft !== null ? (
            <div
              role="timer"
              aria-live={timeLeft <= 60 ? 'assertive' : 'off'}
              aria-label={`Time remaining ${Math.floor(timeLeft / 60)} minutes`}
              className={cn(
                'numeric flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.8125rem] font-bold tabular-nums',
                timeLow
                  ? 'animate-pulse border-negative/50 bg-negative/10 text-negative'
                  : 'border-surface-border text-content-secondary',
              )}
            >
              <IconClock width={14} height={14} />
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </div>
          ) : (
            <span className="badge shrink-0">Untimed</span>
          )}

          <div className="hidden shrink-0 lg:block">
            <PageSizePicker value={pageSize} total={total} onChange={changePageSize} />
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="icon-btn relative shrink-0"
            aria-label="Open question navigator"
          >
            <IconGrid />
            {flagged.size > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-caution px-1 text-[0.5625rem] font-bold text-[rgb(var(--accent-contrast))]">
                {flagged.size}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <p className="caption -mb-1 flex items-center gap-1.5">
        <IconCheck width={13} height={13} className="text-positive" />
        Exam conditions: nothing is graded until you submit. Your answers survive a reload.
      </p>

      {/* Questions on this page */}
      <div className="flex flex-col gap-3.5">
        {visible.map((question) => {
          const index = questions.findIndex((row) => row.id === question.id);
          const chosen = answers[question.id] ?? [];
          const isFlagged = flagged.has(question.id);
          return (
            <QuestionStage
              key={question.id}
              question={question}
              label={`Q${index + 1}`}
              mode="mock"
              selected={chosen}
              onToggle={(choice) => toggle(question, choice)}
              showShortcuts={visible.length === 1}
              active={visible.length > 1 && question.id === currentQuestion?.id}
              badges={
                <>
                  {chosen.length > 0 ? <span className="badge badge-success">Answered</span> : null}
                  {isFlagged ? (
                    <span className="badge badge-warning">
                      <IconFlag width={11} height={11} /> Review
                    </span>
                  ) : null}
                </>
              }
              actions={
                <button
                  type="button"
                  onClick={() => toggleFlag(question)}
                  className={cn('icon-btn', isFlagged && 'text-caution')}
                  aria-label={isFlagged ? 'Remove review flag' : 'Mark for review'}
                  aria-pressed={isFlagged}
                  title={isFlagged ? 'Remove review flag' : 'Mark for review'}
                >
                  <IconFlag className={isFlagged ? 'fill-current' : undefined} />
                </button>
              }
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => clearAnswer(question)}
                    disabled={chosen.length === 0}
                    className="btn-ghost btn-sm"
                  >
                    Clear answer
                  </button>
                  <span className="caption">
                    {chosen.length === 0
                      ? 'Not answered yet'
                      : `${chosen.length} option${chosen.length === 1 ? '' : 's'} selected`}
                  </span>
                </div>
              }
            />
          );
        })}
      </div>

      <QuestionPager
        page={bounds.page}
        pages={pageCount(total, pageSize)}
        start={bounds.start}
        end={bounds.end}
        total={total}
        onPage={(next) => goTo(pageBounds(next, total, pageSize).start)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={() => setConfirmOpen(true)}
          disabled={submitting}
        >
          {submitting ? 'Grading...' : 'Submit exam'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setPaletteOpen(true)}
        >
          <IconGrid className="h-4 w-4" /> Navigator
        </button>
      </div>

      <p className="caption text-center">
        {answeredCount} of {total} answered
        {answeredNow ? '' : ' · this question is still blank'}
      </p>

      {/* Navigator */}
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
              goTo(nextFlagged >= 0 ? nextFlagged : questions.findIndex((question) => flagged.has(question.id)));
            }}
            disabled={flagged.size === 0}
            className="btn-secondary flex-1"
          >
            <IconFlag className="h-4 w-4" /> Next flagged
          </button>
          <button
            type="button"
            onClick={() => {
              setPaletteOpen(false);
              setConfirmOpen(true);
            }}
            className="btn-primary flex-1"
          >
            Submit exam
          </button>
        </div>
      </Drawer>

      {/* Confirm-before-submit dialog */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Submit your exam?"
        description={
          <>
            You answered {answeredCount} of {total} questions.
            {answeredCount < total
              ? ` ${total - answeredCount} will be marked incorrect.`
              : ' All questions answered.'}
            {flagged.size > 0 ? ` ${flagged.size} still marked for review.` : ''}
          </>
        }
        footer={
          <>
            <button className="btn-ghost w-full sm:w-auto" onClick={() => setConfirmOpen(false)}>
              Keep working
            </button>
            <button
              className="btn-primary w-full sm:w-auto"
              onClick={() => {
                setConfirmOpen(false);
                void submit(session, answers);
              }}
              disabled={submitting}
            >
              {submitting ? 'Grading...' : 'Submit and grade'}
            </button>
          </>
        }
      />
    </div>
  );
}
