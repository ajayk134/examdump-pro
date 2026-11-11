'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { get } from '@/lib/api';
import type { DashboardData } from '@/lib/types';
import { Alert, EmptyState, PremiumBadge, ProgressBar, Spinner, StatCard } from '@/components/ui';
import { Donut, LineChart, WeakTopicsList } from '@/components/charts';
import {
  IconBook,
  IconBookmark,
  IconChart,
  IconClock,
  IconFlame,
  IconHistory,
  IconSparkles,
  IconTrophy,
} from '@/components/icons';
import { formatDuration, formatNumber, relativeTime, scoreColor } from '@/lib/format';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    get<DashboardData>('/analytics/dashboard')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return <Spinner label="Loading your dashboard…" />;

  if (!user) {
    return (
      <EmptyState
        title="Sign in to see your dashboard"
        description="Track your accuracy, streaks, weak topics and personalised recommendations."
        action={<Link href="/login" className="btn-primary">Sign in</Link>}
        icon={<IconChart width={36} height={36} />}
      />
    );
  }

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Spinner label="Crunching your stats…" />;

  const { stats, performance, weakTopics, recommendations, recentAttempts, progress } = data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back, {user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-content-muted">Here is how your preparation is going.</p>
        </div>
        <div className="flex items-center gap-2">
          {user.premiumActive ? <PremiumBadge /> : <Link href="/pricing" className="btn-primary">Upgrade to Premium</Link>}
        </div>
      </header>

      {!user.emailVerified ? (
        <Alert tone="warning">
          Please verify your email address to unlock subscriptions and keep your account secure.
        </Alert>
      ) : null}

      {/* Quick actions */}
      <section aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link href="/ask" className="card card-hover flex items-center gap-2.5 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-sky-400 text-white">
            <IconSparkles width={16} height={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content-primary">Ask AI</span>
            <span className="block truncate text-[11px] text-content-muted">Clear a doubt</span>
          </span>
        </Link>
        <Link href="/browse" className="card card-hover flex items-center gap-2.5 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
            <IconBook width={16} height={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content-primary">Practice</span>
            <span className="block truncate text-[11px] text-content-muted">Pick an exam</span>
          </span>
        </Link>
        <Link href="/bookmarks" className="card card-hover flex items-center gap-2.5 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <IconBookmark width={16} height={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content-primary">Bookmarks</span>
            <span className="block truncate text-[11px] text-content-muted">Saved questions</span>
          </span>
        </Link>
        <Link href="/history" className="card card-hover flex items-center gap-2.5 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <IconHistory width={16} height={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content-primary">History</span>
            <span className="block truncate text-[11px] text-content-muted">Past attempts</span>
          </span>
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Accuracy" value={`${stats.accuracy}%`} hint={`${formatNumber(stats.totalCorrect)} / ${formatNumber(stats.totalQuestions)} correct`} tone={stats.accuracy >= 80 ? 'success' : 'brand'} icon={<IconChart />} />
        <StatCard label="Current streak" value={`${stats.currentStreak} days`} hint={`Best: ${stats.longestStreak} days`} tone="warning" icon={<IconFlame />} />
        <StatCard label="Questions answered" value={formatNumber(stats.totalQuestions)} hint={`${formatDuration(stats.totalStudyMs)} studied`} icon={<IconClock />} />
        <StatCard label="Mock exams" value={formatNumber(stats.mockTests)} hint="Completed simulations" icon={<IconTrophy />} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Performance</h2>
              <p className="text-sm text-content-muted">Daily accuracy over the last 30 days</p>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <Donut value={stats.accuracy} size={72} />
            </div>
          </div>
          <LineChart data={performance} />
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Weak topics</h2>
          <WeakTopicsList topics={weakTopics} />
          <Link href="/browse" className="btn-secondary mt-4 w-full">Practise weak areas</Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recommended for you</h2>
            <IconSparkles className="text-brand-400" />
          </div>
          {recommendations.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">Browse the catalogue to get recommendations.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recommendations.map((rec) => (
                <li key={`${rec.exam.providerId}-${rec.exam.key}`}>
                  <Link
                    href={`/study?provider=${encodeURIComponent(rec.exam.providerId)}&exam=${encodeURIComponent(rec.exam.key)}&mode=practice`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-brand-400/60 hover:bg-surface-overlay"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{rec.exam.code}</p>
                      <p className="truncate text-xs text-content-muted">{rec.exam.providerTitle} · {rec.reason}</p>
                    </div>
                    <span className="badge shrink-0">{formatNumber(rec.exam.questionCount)} Q</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent attempts</h2>
            <Link href="/history" className="text-sm text-brand-500 hover:underline dark:text-brand-300">View all</Link>
          </div>
          {recentAttempts.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">No attempts yet. Pick an exam and start practising!</p>
          ) : (
            <ul className="flex flex-col divide-y divide-surface-border">
              {recentAttempts.map((attempt) => (
                <li key={attempt.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{attempt.examCode || 'Exam'}</p>
                    <p className="text-xs text-content-muted">{attempt.mode} · {relativeTime(attempt.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    {attempt.status === 'completed' ? (
                      <p className={`text-sm font-bold ${scoreColor(attempt.scorePercent ?? 0)}`}>{attempt.scorePercent ?? 0}%</p>
                    ) : (
                      <span className="badge">{attempt.status.replace('_', ' ')}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {progress.length > 0 ? (
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Your exams</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {progress.map((item) => {
              const accuracy = item.questionsSeen ? Math.round((item.questionsCorrect / item.questionsSeen) * 100) : 0;
              return (
                <div key={item.examKey} className="rounded-xl border border-surface-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{item.examCode || item.examKey}</p>
                    <span className={`text-sm font-bold ${scoreColor(accuracy)}`}>{accuracy}%</span>
                  </div>
                  <ProgressBar value={accuracy} className="mt-2" />
                  <p className="mt-1.5 text-xs text-content-muted">
                    {item.questionsSeen} seen · best {item.bestScore}% · {relativeTime(item.lastStudiedAt)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}