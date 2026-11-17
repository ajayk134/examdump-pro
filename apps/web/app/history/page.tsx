'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { get } from '@/lib/api';
import type { AttemptSummary, Paginated } from '@/lib/types';
import { Alert, EmptyState, EmptyIcon, PageHeader, Spinner, TableScroll } from '@/components/ui';
import { formatDateTime, formatDuration } from '@/lib/format';

/** Accuracy banding from design tokens, so light and dark both hold. */
function scoreTone(score: number): string {
  if (score >= 80) return 'text-positive';
  if (score >= 60) return 'text-caution';
  return 'text-negative';
}

/** Left rail colour for each mobile log entry. */
function statusBar(status: string, score?: number): string {
  if (status !== 'completed') return 'bg-surface-border-strong';
  const value = score ?? 0;
  if (value >= 80) return 'bg-positive';
  if (value >= 60) return 'bg-caution';
  return 'bg-negative';
}

function Score({ status, score }: { status: string; score?: number }) {
  if (status !== 'completed') {
    return <span className="badge capitalize">{status.replace('_', ' ')}</span>;
  }
  const value = score ?? 0;
  return <span className={`numeric font-bold ${scoreTone(value)}`}>{value}%</span>;
}

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<Paginated<AttemptSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setData(null);
    get<Paginated<AttemptSummary>>(`/attempts?page=${page}&pageSize=20`)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [user, page]);

  if (loading) return <Spinner />;
  if (!user) return <EmptyState title="Sign in to view your history" action={<Link href="/login" className="btn-primary">Sign in</Link>} />;

  const pagination = data?.pagination;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Activity"
        title="Practice history"
        description="Every attempt, score and session time. Retake one or ask the AI tutor about it."
        actions={
          <Link href="/dashboard" className="btn-secondary btn-sm">
            Dashboard
          </Link>
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No attempts yet"
          description="Start practising to build your history."
          action={<Link href="/exams" className="btn-primary">Browse exams</Link>}
        />
      ) : (
        <>
          {/* A log: a dense table with room, stacked entries on a phone. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="caption">
              {pagination
                ? `Showing ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                    pagination.page * pagination.pageSize,
                    pagination.total,
                  )} of ${pagination.total.toLocaleString()}`
                : null}
            </p>
          </div>

          <TableScroll className="hidden md:block">
            <table className="tbl min-w-[680px]">
              <caption className="sr-only">Practice attempts, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Exam</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Score</th>
                  <th scope="col">Time</th>
                  <th scope="col">Date</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((attempt) => (
                  <tr key={attempt.id}>
                    <th scope="row" className="text-left font-medium">
                      {attempt.examCode || attempt.examKey}
                    </th>
                    <td className="capitalize text-content-muted">{attempt.mode}</td>
                    <td>
                      <Score status={attempt.status} score={attempt.scorePercent} />
                    </td>
                    <td className="numeric text-content-muted">
                      {attempt.timeSpentMs ? formatDuration(attempt.timeSpentMs) : '—'}
                    </td>
                    <td className="whitespace-nowrap text-content-muted">{formatDateTime(attempt.createdAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/practice?provider=${encodeURIComponent(attempt.providerId)}&exam=${encodeURIComponent(attempt.examKey)}&mode=practice`}
                          className="btn-ghost btn-sm"
                        >
                          Retake
                        </Link>
                        <Link
                          href={`/ask?provider=${encodeURIComponent(attempt.providerId)}&exam=${encodeURIComponent(attempt.examKey)}`}
                          className="btn-ghost btn-sm"
                        >
                          Ask AI
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          {/* Phone layout: one log entry per attempt, nothing truncated. */}
          <ul className="flex flex-col gap-2.5 md:hidden">
            {data.items.map((attempt) => (
              <li key={attempt.id} className="panel relative overflow-hidden p-4 pl-[1.15rem]">
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-[3px] ${statusBar(attempt.status, attempt.scorePercent)}`}
                />
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">{attempt.examCode || attempt.examKey}</p>
                  <Score status={attempt.status} score={attempt.scorePercent} />
                </div>
                <p className="caption mt-1 capitalize">
                  {attempt.mode} · {formatDateTime(attempt.createdAt)}
                  {attempt.timeSpentMs ? ` · ${formatDuration(attempt.timeSpentMs)}` : ''}
                </p>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/practice?provider=${encodeURIComponent(attempt.providerId)}&exam=${encodeURIComponent(attempt.examKey)}&mode=practice`}
                    className="btn-secondary btn-sm flex-1"
                  >
                    Retake
                  </Link>
                  <Link
                    href={`/ask?provider=${encodeURIComponent(attempt.providerId)}&exam=${encodeURIComponent(attempt.examKey)}`}
                    className="btn-ghost btn-sm flex-1"
                  >
                    Ask AI
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <nav
            aria-label="Pagination"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-4"
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!data.pagination.hasPrev}
            >
              Previous
            </button>
            <span className="text-sm text-content-muted" aria-live="polite">
              Page <span className="numeric font-semibold text-content-secondary">{data.pagination.page}</span> of{' '}
              <span className="numeric font-semibold text-content-secondary">{Math.max(1, data.pagination.totalPages)}</span>
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.pagination.hasNext}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
