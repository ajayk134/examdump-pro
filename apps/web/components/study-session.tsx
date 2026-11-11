'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { QuestionsResponse } from '@/lib/types';
import { QuestionCard } from './question-card';
import { Alert, ProgressBar, Skeleton } from './ui';
import { IconArrowRight, IconChart, IconCheck, IconMessage, IconRefresh } from './icons';
import { cn, formatNumber } from '@/lib/format';

const PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

type Mode = 'practice' | 'random';

export function StudySession({
  providerId,
  examKey,
  mode,
}: {
  providerId: string;
  examKey: string;
  mode: Mode;
}) {
  const [data, setData] = useState<QuestionsResponse | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  /** Ids of questions the learner has completed on this page. */
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    get<QuestionsResponse>(
      `/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}/questions?limit=200&mode=${mode}&includeAnswer=true&random=${mode === 'random'}`,
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
  }, [providerId, examKey, mode, reloadKey]);

  // Reset progress when the exam or mode changes.
  useEffect(() => {
    setAnswered(new Set());
    setPage(1);
  }, [providerId, examKey, mode]);

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.questions.length / pageSize)) : 1),
    [data, pageSize],
  );

  const visible = useMemo(
    () => (data ? data.questions.slice((page - 1) * pageSize, page * pageSize) : []),
    [data, page, pageSize],
  );

  const markAnswered = useCallback((id: string) => {
    setAnswered((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  if (error) {
    return (
      <Alert tone="error">
        {error}{' '}
        <Link href="/browse" className="link">
          Back to browse
        </Link>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const limited = data.entitlement.isLimited;
  const progress = data.questions.length
    ? Math.round((answered.size / data.questions.length) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/providers/${encodeURIComponent(providerId)}`}
              className="text-sm text-content-muted transition hover:text-content-primary"
            >
              ← {data.provider.title}
            </Link>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-content-primary sm:text-3xl">
              {data.exam.code}
            </h1>
            <p className="mt-0.5 text-sm text-content-secondary">{data.exam.title}</p>
            <p className="mt-1 text-xs text-content-muted">
              {formatNumber(data.entitlement.totalQuestions)} questions ·{' '}
              {formatNumber(data.entitlement.accessibleQuestions)} available ·{' '}
              {mode === 'random' ? 'shuffled practice' : 'practice mode'}
            </p>
          </div>

          <nav className="flex flex-wrap gap-2" aria-label="Study mode">
            <Link
              href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=practice`}
              className={mode === 'practice' ? 'btn-primary' : 'btn-secondary'}
              aria-current={mode === 'practice' ? 'page' : undefined}
            >
              Practice
            </Link>
            <Link
              href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=mock`}
              className="btn-secondary"
            >
              Mock test
            </Link>
            <Link
              href={`/ask?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
              className="btn-secondary"
            >
              <IconMessage width={16} height={16} /> Ask AI
            </Link>
          </nav>
        </div>

        {/* Session progress */}
        <div className="card flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-content-primary">
              Session progress
            </span>
            <span className="text-content-muted">
              {answered.size} of {data.questions.length} attempted · {progress}%
            </span>
          </div>
          <ProgressBar value={progress} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="btn-ghost !px-2.5 !py-1.5 text-xs"
            >
              <IconRefresh width={14} height={14} /> Reshuffle
            </button>
            <button
              type="button"
              onClick={() => setAnswered(new Set())}
              className="btn-ghost !px-2.5 !py-1.5 text-xs"
              disabled={answered.size === 0}
            >
              Reset progress
            </button>
            <Link
              href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=random`}
              className={cn(
                'btn-ghost !px-2.5 !py-1.5 text-xs',
                mode === 'random' && 'bg-brand-500/10 text-brand-700 dark:text-brand-200',
              )}
            >
              Shuffle mode
            </Link>
            <div className="ml-auto flex items-center gap-1.5 text-xs text-content-muted">
              <label htmlFor="page-size">Per page</label>
              <select
                id="page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-surface-border bg-surface-base px-2 py-1 text-xs text-content-primary"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {limited ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Free preview: first {data.entitlement.accessibleQuestions} questions
            </p>
            <p className="text-xs text-content-secondary">
              {formatNumber(data.entitlement.lockedQuestions)} more questions are locked. Premium unlocks the
              full exam, mock tests and AI explanations.
            </p>
          </div>
          <Link href="/pricing" className="btn-primary shrink-0">
            Unlock everything <IconArrowRight width={16} height={16} />
          </Link>
        </div>
      ) : null}

      {data.questions.length === 0 ? (
        <Alert tone="warning">No questions are available for this exam yet.</Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        {visible.map((question, i) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={(page - 1) * pageSize + i + 1}
            providerId={providerId}
            examKey={examKey}
            onAnswered={() => markAnswered(question.id)}
            answered={answered.has(question.id)}
          />
        ))}
      </div>

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface-raised/70 px-3 py-2.5"
          aria-label="Pagination"
        >
          <button
            className="btn-secondary !px-3 !py-1.5 text-xs"
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            disabled={page === 1}
          >
            Previous
          </button>
          <span className="text-xs text-content-muted sm:text-sm">
            Page {page} of {totalPages}
          </span>
          <button
            className="btn-secondary !px-3 !py-1.5 text-xs"
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            disabled={page === totalPages}
          >
            Next
          </button>
        </nav>
      ) : null}

      {/* Next-step rail */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=mock`}
          className="card card-hover flex items-center gap-3 p-4"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <IconCheck width={18} height={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-content-primary">Ready to simulate?</span>
            <span className="block text-xs text-content-muted">Sit a timed mock test under exam conditions.</span>
          </span>
        </Link>
        <Link href="/dashboard" className="card card-hover flex items-center gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
            <IconChart width={18} height={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-content-primary">Review your analytics</span>
            <span className="block text-xs text-content-muted">See weak topics and accuracy by subject.</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
