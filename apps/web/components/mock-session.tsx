'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { post } from '@/lib/api';
import type { Question } from '@/lib/types';
import { QuestionContent } from './question-content';
import { Alert, ProgressBar, Spinner } from './ui';
import { IconArrowRight, IconCheck, IconClock, IconX } from './icons';
import { cn, formatDuration, scoreColor } from '@/lib/format';

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
          <Link href={`/providers/${encodeURIComponent(providerId)}`} className="btn-secondary">Back</Link>
        </div>
      </div>
    );
  }

  if (!session) return <Spinner label="Preparing your mock exam…" />;

  if (result) {
    const score = result.attempt.scorePercent;
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="card overflow-hidden p-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-content-muted">Exam complete</p>
          <p className={cn('mt-2 text-6xl font-black tracking-tight', scoreColor(score))}>{score}%</p>
          <p className="mt-1 text-content-secondary">
            {result.attempt.correctCount} of {result.attempt.totalQuestions} correct · {formatDuration(result.attempt.timeSpentMs)}
          </p>
          <div className="mx-auto mt-4 max-w-md"><ProgressBar value={score} /></div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={() => window.location.reload()} className="btn-primary">Try another mock</button>
            <Link href="/dashboard" className="btn-secondary">View dashboard</Link>
            <Link href={`/providers/${encodeURIComponent(providerId)}`} className="btn-ghost">Back to exams</Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card p-4 text-center"><p className="text-xs text-content-muted">Correct</p><p className="text-2xl font-bold text-emerald-500">{result.attempt.correctCount}</p></div>
          <div className="card p-4 text-center"><p className="text-xs text-content-muted">Incorrect</p><p className="text-2xl font-bold text-rose-500">{result.attempt.totalQuestions - result.attempt.correctCount}</p></div>
          <div className="card p-4 text-center"><p className="text-xs text-content-muted">Current streak</p><p className="text-2xl font-bold text-brand-400">{result.stats.currentStreak} days</p></div>
        </div>

        <h2 className="mt-2 text-lg font-semibold">Review your answers</h2>
        <div className="flex flex-col gap-3">
          {result.results.map((item, i) => {
            const question = questions.find((q) => q.id === item.questionId);
            return (
              <details key={item.questionId} className="card group p-4">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', item.correct ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500')}>
                    {item.correct ? <IconCheck width={14} height={14} /> : <IconX width={14} height={14} />}
                  </span>
                  <span className="flex-1 text-sm font-medium">Question {i + 1}</span>
                  <span className="text-xs text-content-muted">{item.topic}</span>
                </summary>
                <div className="mt-3 border-t border-surface-border pt-3 text-sm">
                  {question ? <QuestionContent items={question.stem} className="text-content-secondary" /> : null}
                  <p className="mt-2">
                    <span className="text-content-muted">Your answer: </span>
                    <b className={item.correct ? 'text-emerald-500' : 'text-rose-500'}>{item.selected.join(', ') || '—'}</b>
                    <span className="text-content-muted"> · Correct: </span>
                    <b className="text-emerald-500">{item.correctAnswer}</b>
                  </p>
                  {item.explanation ? <p className="mt-2 whitespace-pre-wrap text-content-muted">{item.explanation}</p> : null}
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
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-content-muted">{session.exam.providerTitle} · {session.exam.code}</p>
          <h1 className="text-xl font-bold">{mode === 'timed' ? 'Timed exam' : 'Mock exam'}</h1>
        </div>
        {timeLeft !== null ? (
          <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold', timeLeft < 300 ? 'border-rose-400/40 text-rose-500' : 'border-surface-border text-content-secondary')}>
            <IconClock width={16} height={16} />
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex justify-between text-xs text-content-muted">
          <span>Question {index + 1} of {questions.length}</span>
          <span>{answeredCount} answered</span>
        </div>
        <ProgressBar value={((index + 1) / questions.length) * 100} />
      </div>

      <article className="card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-lg bg-surface-overlay px-2.5 py-1 text-xs font-semibold text-content-secondary">Q{current.number ?? index + 1}</span>
          {current.type === 'multiple' ? <span className="badge">Select all that apply</span> : null}
        </div>
        <div className="text-[15px] leading-relaxed"><QuestionContent items={current.stem} /></div>
        <ul className="mt-5 flex flex-col gap-2">
          {current.choices.map((choice) => {
            const selected = (answers[current.id] ?? []).includes(choice.key);
            return (
              <li key={choice.key}>
                <button
                  type="button"
                  onClick={() => toggle(current, choice.key)}
                  aria-pressed={selected}
                  className={cn('flex w-full items-start gap-3 rounded-xl border p-3.5 text-left text-sm transition', selected ? 'border-brand-400 bg-brand-500/10' : 'border-surface-border hover:border-brand-400/60 hover:bg-surface-overlay')}
                >
                  <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-bold', selected ? 'border-brand-400 text-brand-400' : 'border-surface-border text-content-muted')}>{choice.key}</span>
                  <span className="flex-1"><QuestionContent items={choice.content} /></span>
                </button>
              </li>
            );
          })}
        </ul>
      </article>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn-secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>Previous</button>
        <div className="hidden flex-wrap gap-1 sm:flex">
          {questions.map((q, i) => (
            <button
              key={q.id}
              onClick={() => setIndex(i)}
              className={cn(
                'h-8 w-8 rounded-lg text-xs font-semibold transition',
                i === index ? 'bg-brand-500 text-white' : (answers[q.id]?.length ?? 0) > 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-surface-overlay text-content-muted hover:text-content-primary',
              )}
              aria-label={`Go to question ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        {index < questions.length - 1 ? (
          <button className="btn-primary" onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>Next</button>
        ) : (
          <button className="btn-primary" onClick={() => void submit(session, answers)} disabled={submitting}>
            {submitting ? 'Grading…' : 'Submit exam'} <IconArrowRight width={16} height={16} />
          </button>
        )}
      </div>

      {index === questions.length - 1 ? (
        <button className="btn-secondary w-full" onClick={() => void submit(session, answers)} disabled={submitting}>
          Submit now
        </button>
      ) : null}
    </div>
  );
}