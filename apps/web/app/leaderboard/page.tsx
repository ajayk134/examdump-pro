'use client';

import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/types';
import { Avatar, Alert, EmptyState, EmptyIcon, PageHeader, Spinner, Tabs } from '@/components/ui';
import { useAuth } from '@/components/providers';
import { IconStar, IconTrophy } from '@/components/icons';
import { cn, formatNumber } from '@/lib/format';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    get<{ leaderboard: LeaderboardEntry[] }>(`/leaderboard?period=${period}&limit=50`)
      .then((data) => setRows(data.leaderboard))
      .catch((err) => setError((err as Error).message));
  }, [period]);

  const podium = rows && rows.length >= 1 ? rows.slice(0, 3) : [];
  const rest = rows ? rows.slice(3) : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Ranking"
        title="Leaderboard"
        description="Learners ranked by correct answers. Everyone's totals, updated as attempts are graded."
        actions={
          <Tabs
            tabs={[
              { id: 'all', label: 'All time' },
              { id: 'month', label: 'This month' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!rows ? (
        <Spinner label="Loading leaderboard..." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="chart" />}
          title="No completed attempts yet"
          description="Finish a practice session or a mock exam and you will be the first name on the board."
        />
      ) : (
        <>
          {podium.length > 0 ? (
            <section aria-label="Top three candidates">
              {podium.length === 3 ? (
                // Podium: first place sits in the middle of the row at every width.
                <ol className="grid grid-cols-3 items-end gap-2 sm:gap-3">
                  {[podium[1]!, podium[0]!, podium[2]!].map((row) => (
                    <li key={row.userId} className="list-none">
                      <PodiumCard row={row} rank={rows.indexOf(row) + 1} you={user?.id === row.userId} />
                    </li>
                  ))}
                </ol>
              ) : (
                // One or two entries: centre them rather than leaving gaps.
                <ol className="flex flex-wrap items-end justify-center gap-2 sm:gap-3">
                  {podium.map((row) => (
                    <li key={row.userId} className="w-[9.5rem] list-none">
                      <PodiumCard row={row} rank={rows.indexOf(row) + 1} you={user?.id === row.userId} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}

          {rest.length > 0 ? (
            <section aria-label="Rankings">
              <ol className="panel divide-y divide-surface-border overflow-hidden">
                {rest.map((row, index) => {
                  const you = user?.id === row.userId;
                  return (
                    <li
                      key={row.userId}
                      className={cn('flex items-center gap-3 px-3.5 py-3 sm:px-4', you && 'bg-accent/[0.06]')}
                    >
                      <span className="numeric w-6 shrink-0 text-center text-sm font-bold text-content-muted">
                        {index + 4}
                      </span>

                      <Avatar name={row.name} src={row.avatarUrl} size={36} />

                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">{row.name}</span>
                          {row.plan === 'premium' ? (
                            <IconStar width={12} height={12} className="shrink-0 text-caution" aria-hidden="true" />
                          ) : null}
                          {you ? <span className="badge badge-accent shrink-0 px-2 py-0">you</span> : null}
                        </p>
                        <p className="caption mt-0.5">
                          {formatNumber(row.attempts)} attempts · {row.accuracy}% accuracy
                          {row.plan === 'premium' ? <span className="sr-only"> · Premium</span> : null}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="numeric text-sm font-bold">{formatNumber(row.correct)}</p>
                        <p className="text-[0.6875rem] text-content-muted">correct</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One of the top three: a raised card with an explicit rank, distinct from the list below. */
function PodiumCard({ row, rank, you }: { row: LeaderboardEntry; rank: number; you: boolean }) {
  const first = rank === 1;

  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center sm:p-4',
        first
          ? 'border-accent/45 bg-gradient-to-b from-accent/[0.1] to-surface-raised pb-4 shadow-glow sm:pb-5'
          : 'border-surface-border bg-surface-raised',
        you && 'ring-2 ring-accent/60',
      )}
    >
      <span
        className={cn(
          'numeric grid h-6 w-6 place-items-center rounded-full text-[0.6875rem] font-black',
          first ? 'bg-accent text-white' : 'bg-surface-overlay text-content-secondary',
        )}
        aria-label={`Rank ${rank}`}
      >
        {rank}
      </span>

      {first ? <IconTrophy width={18} height={18} className="text-caution" aria-hidden="true" /> : null}

      <Avatar name={row.name} src={row.avatarUrl} size={first ? 52 : 40} />

      <p className="flex w-full min-w-0 items-center justify-center gap-1 text-[0.8125rem] font-semibold sm:text-sm">
        <span className="truncate">{you ? 'You' : row.name}</span>
        {row.plan === 'premium' ? (
          <>
            <IconStar width={12} height={12} className="shrink-0 text-caution" aria-hidden="true" />
            <span className="sr-only">Premium</span>
          </>
        ) : null}
      </p>

      <p className="numeric text-lg font-bold leading-none text-content-primary sm:text-xl">
        {formatNumber(row.correct)}
      </p>
      <p className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-content-muted">correct</p>

      <p className="caption hidden sm:block">
        {row.accuracy}% · {formatNumber(row.attempts)} attempts
      </p>
    </div>
  );
}
