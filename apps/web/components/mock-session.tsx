'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { post } from '@/lib/api';
import type { Question } from '@/lib/types';
import { QuestionContent } from './question-content';
import { Alert, Drawer, ProgressBar, ProgressRing, Skeleton } from './ui';
import { AiChat } from './ai-chat';
import { IconArrowRight, IconCheck, IconClock, IconMessage, IconRefresh, IconX, IconGrid } from './icons';
import { cn, formatDuration } from '@/lib/format';
import { clearAutosave, loadAutosave, saveAutosave } from '@/lib/local-store';

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

export function MockSession({
  providerId,
  examKey,
  mode,
}: {
  providerId: string;
  examKey: string;
  mode: 'mock' | 'timed';
}) {
  const [session, setSession] = useState<StartResponse | null>(null);
  const [error, setError] = useState('');
  const [upgrade, setUpgrade] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [chatQuestionId, setChatQuestionId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [resumed, setResumed] = useState(false);
  const startedAt = useRef<number>(Date.now());
  const submittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();
    post<StartResponse>('/attempts', {
      provider: providerId,
      exam: examKey,
      mode,
      ...(mode === 'timed' ? { timeLimitSeconds: 3600 } : {}),
    })
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        if (data.attempt.timeLimitSeconds) setTimeLeft(data.attempt.timeLimitSeconds);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err as { status?: number }).status === 403) setUpgrade(true);
        setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, mode]);

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
    const timer = setTimeout(() => setTimeLeft((t) => (t === null ? null : t - 1)), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, result, session, answers, submit]);

  /* ---------- autosave: survive a refresh or accidental navigation ---------- */
  const autosaveKey = session ? `${providerId}/${examKey}/mock/${session.attempt.id}` : '';

  useEffect(() => {
    if (!autosaveKey) return;
    saveAutosave(autosaveKey, { answers, index, savedAt: Date.now() });
  }, [autosaveKey, answers, index]);

  useEffect(() => {
    if (!autosaveKey) return;
    const saved = loadAutosave<{ answers: Record<string, string[]>; index: number }>(autosaveKey);
    if (saved && Object.keys(saved.answers ?? {}).length > 0) {
      setAnswers(saved.answers);
      setIndex(Math.max(0, saved.index ?? 0));
      setResumed(true);
    }
    // Only on first load for a given attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveKey]);

  // Clear the snapshot once the attempt is graded.
  useEffect(() => {
    if (result && autosaveKey) clearAutosave(autosaveKey);
  }, [result, autosaveKey]);

  const questions = session?.questions ?? [];
  const current = questions[index];

  const toggle = (question: Question, key: string) => {
    setAnswers((prev) => {
      const existing = prev[question.id] ?? [];
      const multi = question.type === 'multiple';
      const next = existing.includes(key)
        ? existing.filter((k) => k !== key)
        : multi
          ? [...existing, key]
          : [key];
      return { ...prev, [question.id]: next };
    });
  };

  const answeredCount = useMemo(
    () => Object.values(answers).filter((v) => v.length > 0).length,
    [answers],
  );

  if (error && !session) {
    return (
      <div className="mx-auto max-w-lg">
        <Alert tone="error">{error}</Alert>
        <div className="mt-4 flex gap-2">
          {upgrade ? <Link href="/pricing" className="btn-primary">Upgrade to Premium</Link> : null}
          <Link href={`/exams/${encodeURIComponent(providerId)}`} className="btn-secondary">Back</Link>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="surface p-5" role="status" aria-live="polite">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <p className="text-sm font-semibold">Preparing your exam…</p>
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

  if (result) {
    const score = result.attempt.scorePercent;
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="surface relative overflow-hidden p-5 text-center sm:p-6">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 via-sky-400 to-violet-500" />
          <p className="eyebrow">Exam complete</p>
          <div className="mt-3 flex justify-center">
            <ProgressRing value={score} size={116} stroke={9} tone={score >= 70 ? 'success' : 'warning'}>
              <span className="numeric text-3xl font-black tracking-tight">{score}%</span>
            </ProgressRing>
          </div>
          <p className="mt-3 text-sm text-content-secondary">
            {result.attempt.correctCount} of {result.attempt.totalQuestions} correct · {formatDuration(result.attempt.timeSpentMs)}
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
            <Link href="/dashboard" className="btn-secondary">View dashboard</Link>
            <Link
              href={`/ask?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
              className="btn-secondary"
            >
              <IconMessage width={16} height={16} /> Ask the tutor
            </Link>
            <Link href={`/exams/${encodeURIComponent(providerId)}`} className="btn-ghost">Back to exams</Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="surface p-3 text-center">
            <p className="text-[0.625rem] font-bold uppercase tracking-wider text-content-muted">Correct</p>
            <p className="numeric mt-1 text-xl font-bold text-positive">{result.attempt.correctCount}</p>
          </div>
          <div className="surface p-3 text-center">
            <p className="text-[0.625rem] font-bold uppercase tracking-wider text-content-muted">Incorrect</p>
            <p className="numeric mt-1 text-xl font-bold text-negative">
              {result.attempt.totalQuestions - result.attempt.correctCount}
            </p>
          </div>
          <div className="surface p-3 text-center">
            <p className="text-[0.625rem] font-bold uppercase tracking-wider text-content-muted">Streak</p>
            <p className="numeric mt-1 text-xl font-bold text-accent">{result.stats.currentStreak}d</p>
          </div>
        </div>

        <h2 className="heading-2 mt-1">Review your answers</h2>
        <div className="flex flex-col gap-3">
          {result.results.map((item, i) => {
            const question = questions.find((q) => q.id === item.questionId);
            return (
              <details key={item.questionId} className="surface group p-3.5">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', item.correct ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative')}>
                    {item.correct ? <IconCheck width={14} height={14} /> : <IconX width={14} height={14} />}
                  </span>
                  <span className="flex-1 text-sm font-medium">Question {i + 1}</span>
                  <span className="text-xs text-content-muted">{item.topic}</span>
                </summary>
                <div className="mt-3 border-t border-surface-border pt-3 text-sm">
                  {question ? <QuestionContent items={question.stem} className="text-content-secondary" /> : null}
                  <p className="mt-2">
                    <span className="text-content-muted">Your answer: </span>
                    <b className={item.correct ? 'text-positive' : 'text-negative'}>{item.selected.join(', ') || '—'}</b>
                    <span className="text-content-muted"> · Correct: </span>
                    <b className="text-positive">{item.correctAnswer}</b>
                  </p>
                  {item.explanation ? <p className="mt-2 whitespace-pre-wrap text-content-muted">{item.explanation}</p> : null}
                  <button
                    type="button"
                    onClick={() => setChatQuestionId(item.questionId)}
                    className="btn-secondary mt-3 !px-3 !py-1.5 text-xs"
                  >
                    <IconMessage width={14} height={14} /> Ask AI about this
                  </button>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    );
  }

  if (!current) return <Alert tone="warning">This mock exam has no questions.</Alert>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {resumed ? (
        <Alert tone="info">
          Your previous answers were restored. Submission is unchanged.
        </Alert>
      ) : null}

      {/* Sticky exam header with timer and progress */}
      <header className="sticky top-14 z-30 -mx-3.5 border-b border-surface-border/60 bg-surface-base/92 px-3.5 py-2 backdrop-blur-lg sm:top-16 sm:mx-0 sm:rounded-xl sm:border sm:px-3">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted">
              {session.exam.providerTitle} · {session.exam.code}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={(answeredCount / questions.length) * 100} className="h-1" label="Exam progress" />
              <span className="numeric shrink-0 text-[0.6875rem] font-semibold text-content-muted">
                {answeredCount}/{questions.length}
              </span>
            </div>
          </div>

          {timeLeft !== null ? (
            <div
              role="timer"
              aria-live={timeLeft <= 60 ? 'assertive' : 'off'}
              aria-label={`Time remaining ${Math.floor(timeLeft / 60)} minutes`}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-bold tabular-nums',
                timeLeft < 300
                  ? 'animate-pulse border-negative/50 bg-negative/10 text-negative'
                  : 'border-surface-border-strong text-content-secondary',
              )}
            >
              <IconClock width={15} height={15} />
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </div>
          ) : (
            <span className="badge shrink-0">Untimed</span>
          )}

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="icon-btn shrink-0"
            aria-label="Open question palette"
          >
            <IconGrid />
          </button>
        </div>
      </header>

      <article className="surface p-4 sm:p-5" aria-label={`Question ${index + 1}`}>
        <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
          <span className="badge font-mono">Q{current.number ?? index + 1}</span>
          {current.type === 'multiple' ? <span className="badge">Select all that apply</span> : null}
        </div>
        <div className="text-[0.9375rem] leading-relaxed">
          <QuestionContent items={current.stem} />
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {current.choices.map((choice) => {
            const selected = (answers[current.id] ?? []).includes(choice.key);
            return (
              <li key={choice.key}>
                <button
                  type="button"
                  onClick={() => toggle(current, choice.key)}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition-all duration-150 sm:p-3.5',
                    selected
                      ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                      : 'border-surface-border-strong hover:border-accent/50 hover:bg-surface-overlay',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-bold transition-colors',
                      selected ? 'border-accent bg-accent text-white' : 'border-surface-border-strong text-content-muted',
                    )}
                  >
                    {choice.key}
                  </span>
                  <span className="flex-1">
                    <QuestionContent items={choice.content} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </article>

      <nav className="flex items-center justify-between gap-2" aria-label="Exam navigation">
        <button
          className="btn-secondary flex-1 sm:flex-none"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          Previous
        </button>

        {index < questions.length - 1 ? (
          <button
            className="btn-primary flex-1 sm:flex-none"
            onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
          >
            Next
            <IconArrowRight width={16} height={16} />
          </button>
        ) : (
          <button className="btn-primary flex-1 sm:flex-none" onClick={() => setConfirmOpen(true)} disabled={submitting}>
            {submitting ? 'Grading…' : 'Finish'}
            <IconCheck width={16} height={16} />
          </button>
        )}
      </nav>

      <button
        className="btn-ghost btn-block text-negative"
        onClick={() => setConfirmOpen(true)}
        disabled={submitting}
      >
        Submit exam now
      </button>

      <Drawer open={paletteOpen} onClose={() => setPaletteOpen(false)} title="Question palette" side="bottom">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <div>
            <p className="heading-3">Question palette</p>
            <p className="caption mt-0.5">
              {answeredCount} answered · {questions.length - answeredCount} remaining
            </p>
          </div>
          <button type="button" onClick={() => setPaletteOpen(false)} className="icon-btn" aria-label="Close palette">
            <IconX />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
            {questions.map((q, i) => {
              const isAnswered = (answers[q.id]?.length ?? 0) > 0;
              const isCurrent = i === index;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    setPaletteOpen(false);
                  }}
                  aria-label={`Go to question ${i + 1}${isAnswered ? ', answered' : ''}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn(
                    'numeric grid aspect-square place-items-center rounded-lg text-xs font-bold transition-all',
                    isCurrent
                      ? 'bg-accent text-white shadow-sm'
                      : isAnswered
                        ? 'bg-positive/15 text-positive'
                        : 'bg-surface-inset text-content-muted hover:bg-surface-overlay',
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-surface-border p-3">
          <button type="button" onClick={() => setConfirmOpen(true)} className="btn-primary btn-block">
            Submit exam
          </button>
        </div>
      </Drawer>

      {/* Confirm-before-submit sheet */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-submit-title"
            className="surface w-full max-w-sm p-5"
          >
            <h2 id="confirm-submit-title" className="heading-2">
              Submit your exam?
            </h2>
            <p className="mt-1 text-sm text-content-secondary">
              You answered {answeredCount} of {questions.length} questions.
              {answeredCount < questions.length
                ? ` ${questions.length - answeredCount} will be marked incorrect.`
                : ' All questions answered.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmOpen(false)}>
                Keep working
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setConfirmOpen(false);
                  void submit(session, answers);
                }}
                disabled={submitting}
              >
                {submitting ? 'Grading…' : 'Submit and grade'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            embedded
            onClose={() => setChatQuestionId(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}