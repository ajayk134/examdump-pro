'use client';

import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/types';
import { Avatar, Alert, Spinner, Tabs } from '@/components/ui';
import { useAuth } from '@/components/providers';
import { IconTrophy } from '@/components/icons';
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

  const medal = (index: number) =>
    index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><IconTrophy className="text-amber-400" /> Leaderboard</h1>
          <p className="mt-1 text-content-muted">Top learners by correct answers.</p>
        </div>
        <Tabs tabs={[{ id: 'all', label: 'All time' }, { id: 'month', label: 'This month' }]} value={period} onChange={setPeriod} />
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {!rows ? (
        <Spinner label="Loading leaderboard…" />
      ) : rows.length === 0 ? (
        <Alert tone="info">No completed attempts yet. Be the first on the board!</Alert>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-surface-border">
            {rows.map((row, index) => (
              <li
                key={row.userId}
                className={cn('flex items-center gap-3 px-4 py-3', user?.id === row.userId && 'bg-brand-500/5')}
              >
                <span className="w-8 text-center text-sm font-bold text-content-muted">{medal(index)}</span>
                <Avatar name={row.name} src={row.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {row.name}
                    {row.plan === 'premium' ? <span className="ml-2 text-xs text-amber-400">★</span> : null}
                    {user?.id === row.userId ? <span className="ml-2 text-xs text-brand-400">you</span> : null}
                  </p>
                  <p className="text-xs text-content-muted">{row.attempts} attempts · {row.accuracy}% accuracy</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{formatNumber(row.correct)}</p>
                  <p className="text-[11px] text-content-muted">correct</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}