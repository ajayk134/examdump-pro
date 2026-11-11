'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { get } from '@/lib/api';
import type { AttemptSummary, Paginated } from '@/lib/types';
import { Alert, EmptyState, Spinner } from '@/components/ui';
import { IconHistory } from '@/components/icons';
import { formatDateTime, formatDuration, scoreColor } from '@/lib/format';

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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><IconHistory className="text-brand-400" /> Practice history</h1>
        <p className="mt-1 text-content-muted">Every attempt, score and session.</p>
      </header>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState title="No attempts yet" description="Start practising to build your history." action={<Link href="/browse" className="btn-primary">Browse exams</Link>} />
      ) : (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th className="px-4 py-3">Exam</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {data.items.map((attempt) => (
                  <tr key={attempt.id} className="hover:bg-surface-overlay/60">
                    <td className="px-4 py-3 font-medium">{attempt.examCode || attempt.examKey}</td>
                    <td className="px-4 py-3 capitalize text-content-muted">{attempt.mode}</td>
                    <td className="px-4 py-3">
                      {attempt.status === 'completed' ? (
                        <span className={`font-bold ${scoreColor(attempt.scorePercent ?? 0)}`}>{attempt.scorePercent ?? 0}%</span>
                      ) : (
                        <span className="badge">{attempt.status.replace('_', ' ')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-content-muted">{attempt.timeSpentMs ? formatDuration(attempt.timeSpentMs) : '—'}</td>
                    <td className="px-4 py-3 text-content-muted">{formatDateTime(attempt.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/study?provider=${encodeURIComponent(attempt.providerId)}&exam=${encodeURIComponent(attempt.examKey)}&mode=practice`} className="btn-ghost !px-3 !py-1.5 text-xs">Retake</Link>
                        <Link href={`/ask?provider=${encodeURIComponent(attempt.providerId)}&exam=${encodeURIComponent(attempt.examKey)}`} className="btn-ghost !px-3 !py-1.5 text-xs">Ask AI</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!data.pagination.hasPrev}>Previous</button>
            <span className="text-sm text-content-muted">Page {data.pagination.page} of {data.pagination.totalPages}</span>
            <button className="btn-secondary" onClick={() => setPage((p) => p + 1)} disabled={!data.pagination.hasNext}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}