'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import type { Question } from '@/lib/types';
import { QuestionContent } from './question-content';
import { AiChat } from './ai-chat';
import { Dialog, Drawer, EmptyIcon, EmptyState, ProgressRing, Skeleton, StatStrip, Alert } from './ui';
import { IconArrowRight, IconCheck, IconFlag, IconMessage, IconRefresh, IconX } from './icons';
import { QuestionWorkspace } from './workspace/question-workspace';
import { QuestionSheet } from './workspace/question-sheet';
import { QuestionMap, type MapItem } from './workspace/question-map';
import { StudyCompanion, type CompanionTab } from './workspace/study-companion';
import { cn, formatDuration } from '@/lib/format';
import { clearAutosave, loadAutosave, saveAutosave, getPageSizePreference, setPageSizePreference } from '@/lib/local-store';
import {
  DEFAULT_PAGE_SIZE,
  fitPageSize,
  pageBounds,
  pageCount,
  pageOfQuestion,
  parsePageSize,
  rangeLabel,
  selectionRulesFor,
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
  const [mapOpen, setMapOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionTab, setCompanionTab] = useState<CompanionTab>('guide');
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
      else {
        const savedSize = parsePageSize(savedState?.pageSize);
        if (savedSize) setPageSize(savedSize);
      }
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
  const indexById = useMemo(
    () => new Map(questions.map((question, index) => [question.id, index])),
    [questions],
  );

  useEffect(() => {
    if (!session) return;
    const stored = parsePageSize(getPageSizePreference('mock'));
    if (stored && stored !== pageSize) setPageSize(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Keep a restored page inside range once the paper is known, and fold a size
  // the paper cannot fill into "All".
  useEffect(() => {
    if (!session) return;
    const fitted = fitPageSize(pageSize, total);
    if (fitted !== pageSize) {
      setPageSize(fitted);
      return;
    }
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
      setMapOpen(false);
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
      const next = fitPageSize(size, total);
      setPageSizePreference('mock', String(next));
      setPageSize(next);
      setPage(pageOfQuestion(activeIndex, total, next));
      const question = questions[activeIndex];
      if (question) pendingScrollId.current = question.id;
    },
    [activeIndex, total, questions],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (mapOpen || confirmOpen) return;
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
  }, [mapOpen, confirmOpen, activeIndex, goTo, currentQuestion, toggleFlag, toggle]);

  const paletteItems: MapItem[] = useMemo(
    () =>
      questions.map((question, index) => ({
        id: question.id,
        index,
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

  const pages = pageCount(total, pageSize);
  const timeLow = timeLeft !== null && timeLeft < 300;
  const clockLabel =
    timeLeft === null
      ? 'Untimed'
      : timeLeft >= 3600
        ? `${Math.floor(timeLeft / 3600)}:${String(Math.floor((timeLeft % 3600) / 60)).padStart(2, '0')}:${String(
            timeLeft % 60,
          ).padStart(2, '0')}`
        : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`;

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
        mode="mock"
        examCode={session.exam.code}
        backHref={`/mock?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
        backLabel="Leave the mock and return to the simulator"
        total={total}
        answered={answeredCount}
        flagged={flagged.size}
        progress={total ? (answeredCount / total) * 100 : 0}
        range={rangeLabel(bounds.start, bounds.end, total)}
        timer={{ label: clockLabel, low: timeLow }}
        onOpenMap={() => {
          setMapOpen(true);
          setCompanionOpen(false);
        }}
        onOpenGuide={() => {
          setCompanionTab('guide');
          setCompanionOpen(true);
          setMapOpen(false);
        }}
        rail={map('rail')}
        companion={
          <StudyCompanion
            question={currentQuestion}
            questionIndex={activeIndex}
            mode="mock"
            selected={answers[currentQuestion.id] ?? []}
            revealed={false}
            correct={null}
            providerId={providerId}
            examKey={examKey}
            examLabel={session.exam.code}
            aiEnabled={false}
            remaining={null}
            tab={companionTab}
            onTab={setCompanionTab}
            onConsumed={() => undefined}
            open={companionOpen}
            onClose={() => setCompanionOpen(false)}
          />
        }
      >
        <div className="min-w-0">
          {resumed ? (
            <p className="mb-3 rounded-xl bg-accent/[0.06] px-3 py-2 text-[0.75rem] text-content-secondary">
              Your previous answers were restored. The timer continued from the server record.
            </p>
          ) : null}

          <div className="flex flex-col">
            {visible.map((question) => {
              const index = indexById.get(question.id) ?? 0;
              const chosen = answers[question.id] ?? [];
              const isFlagged = flagged.has(question.id);
              return (
                <QuestionSheet
                  key={question.id}
                  question={question}
                  index={index}
                  total={total}
                  mode="mock"
                  selected={chosen}
                  revealed={false}
                  correct={null}
                  flagged={isFlagged}
                  providerId={providerId}
                  examKey={examKey}
                  compact={visible.length > 1}
                  active={visible.length > 1 && question.id === currentQuestion.id}
                  showShortcuts={visible.length === 1}
                  aiEnabled={false}
                  onToggle={(choice) => toggle(question, choice)}
                  onCheck={() => undefined}
                  onClear={() => clearAnswer(question)}
                  onRetry={() => undefined}
                  onToggleFlag={() => toggleFlag(question)}
                  onOpenGuide={() => {
                    setCompanionTab('guide');
                    setCompanionOpen(true);
                  }}
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
              ← Previous
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

          <div className="mt-6 flex flex-col gap-2 rounded-2xl bg-surface-overlay/40 p-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className="btn-primary sm:flex-1"
              onClick={() => setConfirmOpen(true)}
              disabled={submitting}
            >
              {submitting ? 'Grading...' : 'Submit exam'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMapOpen(true)}>
              Review flagged ({flagged.size})
            </button>
            <p className="text-center text-[0.75rem] text-content-muted sm:ml-auto sm:text-right">
              {answeredCount} of {total} answered
            </p>
          </div>

          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[0.6875rem] text-content-muted">
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
              <span className="kbd">G</span> map
            </span>
            <span className="w-full text-content-muted/80">
              Nothing is graded until you submit. Answers save automatically.
            </span>
          </p>
        </div>
      </QuestionWorkspace>

      <Drawer open={mapOpen} onClose={() => setMapOpen(false)} title="Session map" side="bottom">
        <div className="flex min-h-0 flex-1 flex-col">{map('sheet', () => setMapOpen(false))}</div>
      </Drawer>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Submit your exam?"
        description={
          <>
            You answered {answeredCount} of {total} questions.
            {answeredCount < total ? ` ${total - answeredCount} will be marked incorrect.` : ' All questions answered.'}
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
    </>
  );
}
