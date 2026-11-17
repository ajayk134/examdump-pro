'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { get } from '@/lib/api';
import type { DashboardData } from '@/lib/types';
import {
  Alert,
  EmptyState,
  PageHeader,
  PremiumBadge,
  ProgressBar,
  ProgressRing,
  Skeleton,
  Spinner,
  StatStrip,
} from '@/components/ui';
import { Donut, LineChart, WeakTopicsList } from '@/components/charts';
import { Reveal } from '@/components/reveal';
import {
  IconArrowRight,
  IconBook,
  IconBookmark,
  IconChart,
  IconChevronRight,
  IconHistory,
  IconPlay,
  IconSparkles,
  IconTrophy,
} from '@/components/icons';
import { formatDuration, formatNumber, relativeTime } from '@/lib/format';
import { RecommendationCard } from '@/components/recommendation-card';

/** Accuracy banding that holds in both themes (uses design tokens, not raw hues). */
function accuracyTone(accuracy: number): 'positive' | 'caution' | 'negative' {
  if (accuracy >= 80) return 'positive';
  if (accuracy >= 60) return 'caution';
  return 'negative';
}

const TONE_TEXT = {
  positive: 'text-positive',
  caution: 'text-caution',
  negative: 'text-negative',
} as const;

const TONE_BAR = { positive: 'success', caution: 'warning', negative: 'accent' } as const;

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

  if (loading) return <Spinner label="Loading your dashboard..." />;

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
  if (!data) return <DashboardSkeleton />;

  const { stats, performance, weakTopics, recommendations, recentAttempts, progress } = data;

  const firstName = user.name.trim().split(/\s+/)[0] || 'there';
  const contextLine =
    stats.currentStreak > 0
      ? `You are on a ${stats.currentStreak}-day streak. Keep the momentum going.`
      : stats.totalQuestions > 0
        ? 'Pick up where you left off and protect the progress you have already made.'
        : 'Answer a few practice questions and your analytics will build themselves.';

  // The thing to resume: the most recently studied exam, falling back to the
  // newest attempt when progress rows have not been recorded yet.
  const latestProgress = progress[0];
  const latestAttempt = recentAttempts[0];
  const focus = latestProgress
    ? {
        providerId: latestProgress.providerId,
        examKey: latestProgress.examKey,
        code: latestProgress.examCode || latestProgress.examKey,
        accuracy: latestProgress.questionsSeen
          ? Math.round((latestProgress.questionsCorrect / latestProgress.questionsSeen) * 100)
          : 0,
        seen: latestProgress.questionsSeen,
        best: latestProgress.bestScore,
        at: latestProgress.lastStudiedAt,
      }
    : latestAttempt
      ? {
          providerId: latestAttempt.providerId,
          examKey: latestAttempt.examKey,
          code: latestAttempt.examCode || latestAttempt.examKey,
          accuracy: latestAttempt.scorePercent ?? 0,
          seen: latestAttempt.answeredCount ?? 0,
          best: latestAttempt.scorePercent ?? 0,
          at: latestAttempt.createdAt,
        }
      : null;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <Reveal>
        <PageHeader
          eyebrow="Dashboard"
          title={`Welcome back, ${firstName}`}
          description={contextLine}
          actions={
            user.premiumActive ? <PremiumBadge /> : <Link href="/pricing" className="btn-primary btn-sm">Upgrade</Link>
          }
        />
      </Reveal>

      {!user.emailVerified ? (
        <Alert tone="warning">
          Verify your email address to unlock subscriptions and keep your account secure.
        </Alert>
      ) : null}

      {/* Continue practising — the primary action on the page, so it gets its own
          raised surface with a completion ring rather than competing with the
          metrics below. */}
      <Reveal>
        <section aria-labelledby="continue-heading" className="grid gap-3 lg:grid-cols-3">
          <div className="panel-lg ring-gradient relative isolate min-w-0 overflow-hidden p-5 sm:p-6 lg:col-span-2">
            <div aria-hidden="true" className="orb -right-16 -top-20 h-56 w-56 bg-accent/20" />
            <div aria-hidden="true" className="orb -bottom-24 -left-12 h-48 w-48 bg-accent-2/[0.14]" />

            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="eyebrow mb-2 inline-flex items-center gap-1.5">
                  <IconPlay width={13} height={13} className="text-accent" />
                  {focus ? 'Continue where you left off' : 'Start practising'}
                </p>

                <h2 id="continue-heading" className="display-2 break-words">
                  {focus ? focus.code : 'Pick your first exam'}
                </h2>

                {focus ? (
                  <p className="caption mt-2">
                    {formatNumber(focus.seen)} questions seen · best {focus.best}% · {relativeTime(focus.at)}
                  </p>
                ) : (
                  <p className="caption mt-2">
                    Choose from 160+ certification providers and start with five free questions.
                  </p>
                )}
              </div>

              {focus ? (
                <ProgressRing
                  value={focus.accuracy}
                  size={84}
                  stroke={8}
                  label={`${focus.accuracy}% accuracy on ${focus.code}`}
                >
                  <span className="flex flex-col items-center leading-none">
                    <span className="numeric text-lg font-bold">{focus.accuracy}%</span>
                    <span className="mt-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide text-content-muted">
                      accuracy
                    </span>
                  </span>
                </ProgressRing>
              ) : (
                <span
                  aria-hidden="true"
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-[1.25rem] bg-gradient-to-br from-brand-500 to-accent-2 text-white shadow-glow-sm"
                >
                  <IconBook width={26} height={26} />
                </span>
              )}
            </div>

            <div className="relative mt-5 flex flex-wrap gap-2">
              {focus ? (
                <>
                  <Link
                    href={`/study?provider=${encodeURIComponent(focus.providerId)}&exam=${encodeURIComponent(focus.examKey)}&mode=practice`}
                    className="btn-primary"
                  >
                    Resume practice
                    <IconArrowRight width={16} height={16} />
                  </Link>
                  <Link
                    href={`/mock?provider=${encodeURIComponent(focus.providerId)}&exam=${encodeURIComponent(focus.examKey)}`}
                    className="btn-secondary"
                  >
                    <IconTrophy width={16} height={16} />
                    Sit a mock
                  </Link>
                </>
              ) : (
                <Link href="/exams" className="btn-primary">
                  Browse exams
                  <IconArrowRight width={16} height={16} />
                </Link>
              )}
            </div>
          </div>

          {/* Quick actions: borderless tiles, deliberately lighter than the panels. */}
          <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {[
              { href: '/ask', label: 'Ask AI', hint: 'Clear a doubt', icon: IconSparkles, tone: 'text-accent' },
              { href: '/exams', label: 'Practice', hint: 'Pick an exam', icon: IconBook, tone: 'text-accent' },
              { href: '/bookmarks', label: 'Bookmarks', hint: 'Saved questions', icon: IconBookmark, tone: 'text-caution' },
              { href: '/history', label: 'History', hint: 'Past attempts', icon: IconHistory, tone: 'text-positive' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="tile tile-interactive group flex min-w-0 items-center gap-2.5 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-raised ${action.tone}`}>
                    <Icon width={16} height={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-content-primary">{action.label}</span>
                    <span className="block truncate text-[0.6875rem] text-content-muted">{action.hint}</span>
                  </span>
                  <IconChevronRight
                    width={14}
                    height={14}
                    className="hidden shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 lg:block"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </nav>
        </section>
      </Reveal>

      {/* Headline numbers, grouped on one surface instead of four equal cards. */}
      <Reveal>
        <section aria-label="Your numbers" className="panel overflow-hidden">
          <StatStrip
            items={[
              {
                label: 'Accuracy',
                value: `${stats.accuracy}%`,
                hint: `${formatNumber(stats.totalCorrect)} / ${formatNumber(stats.totalQuestions)} correct`,
                tone: stats.accuracy >= 80 ? 'success' : 'brand',
              },
              {
                label: 'Current streak',
                value: `${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'}`,
                hint: `Best ${stats.longestStreak} ${stats.longestStreak === 1 ? 'day' : 'days'}`,
                tone: 'warning',
              },
              {
                label: 'Questions answered',
                value: formatNumber(stats.totalQuestions),
                hint: `${formatDuration(stats.totalStudyMs)} studied`,
              },
              {
                label: 'Mock exams',
                value: formatNumber(stats.mockTests),
                hint: 'Completed simulations',
              },
            ]}
          />
        </section>
      </Reveal>

      {/* Trend + the piece of analysis that tells you what to do next. */}
      <Reveal>
        <section aria-label="Performance" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="panel min-w-0 p-4 sm:p-5 lg:col-span-2">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow mb-1">Insights</p>
                <h2 className="heading-1">Performance</h2>
                <p className="caption mt-1">Daily accuracy over the last 30 days</p>
              </div>
              <div className="flex shrink-0 flex-col items-center">
                <Donut value={stats.accuracy} size={76} />
                <p className="metric-label mt-1.5">Overall</p>
              </div>
            </div>
            <LineChart data={performance} />
          </div>

          <div className="panel-sunken min-w-0 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="heading-2">Weak topics</h2>
              {weakTopics.length > 0 ? (
                <span className="badge badge-warning shrink-0">{weakTopics.length} to review</span>
              ) : null}
            </div>
            <WeakTopicsList topics={weakTopics} />
            <Link href="/exams" className="btn-secondary mt-4 w-full">
              Practise weak areas
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section aria-label="Recommendations and recent activity" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="panel min-w-0 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="heading-2 inline-flex items-center gap-1.5">
                <IconSparkles className="shrink-0 text-accent" width={18} height={18} aria-hidden="true" />
                Recommended for you
              </h2>
              {recommendations.length > 0 ? (
                <Link href="/exams" className="link text-xs">
                  Browse all
                </Link>
              ) : null}
            </div>
            {recommendations.length === 0 ? (
              <p className="py-6 text-center text-sm text-content-muted">Browse the catalogue to get recommendations.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {recommendations.map((rec) => (
                  <li key={`${rec.exam.providerId}-${rec.exam.key}`} className="min-w-0">
                    <RecommendationCard rec={rec} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel min-w-0 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="heading-2">Recent attempts</h2>
              <Link href="/history" className="link text-sm">
                View all
              </Link>
            </div>

            {recentAttempts.length === 0 ? (
              <p className="py-6 text-center text-sm text-content-muted">
                No attempts yet. Pick an exam and start practising.
              </p>
            ) : (
              <>
                {/* Stacked rows on a phone, a dense table once there is room. */}
                <ul className="flex flex-col divide-y divide-surface-border sm:hidden">
                  {recentAttempts.map((attempt) => (
                    <li key={attempt.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{attempt.examCode || attempt.examKey}</p>
                        <p className="caption capitalize">
                          {attempt.mode} · {relativeTime(attempt.createdAt)}
                        </p>
                      </div>
                      <AttemptScore status={attempt.status} score={attempt.scorePercent} />
                    </li>
                  ))}
                </ul>

                <table className="hidden w-full border-collapse text-sm sm:table">
                  <caption className="sr-only">Your most recent attempts</caption>
                  <thead>
                    <tr className="border-b border-surface-border">
                      <th scope="col" className="pb-2 text-left text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-content-muted">
                        Exam
                      </th>
                      <th scope="col" className="pb-2 pl-3 text-left text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-content-muted">
                        When
                      </th>
                      <th scope="col" className="pb-2 pl-3 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-content-muted">
                        Score
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAttempts.map((attempt) => (
                      <tr key={attempt.id} className="border-b border-surface-border/60 last:border-0">
                        <th scope="row" className="py-2.5 pr-3 text-left align-middle font-medium">
                          <span className="block truncate">{attempt.examCode || attempt.examKey}</span>
                          <span className="caption block capitalize">{attempt.mode}</span>
                        </th>
                        <td className="px-3 py-2.5 align-middle text-xs text-content-muted">
                          {relativeTime(attempt.createdAt)}
                        </td>
                        <td className="py-2.5 pl-3 text-right align-middle">
                          <AttemptScore status={attempt.status} score={attempt.scorePercent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </section>
      </Reveal>

      {progress.length > 0 ? (
        <Reveal>
          <section aria-labelledby="exams-heading" className="panel min-w-0 p-4 sm:p-5">
            <div className="mb-1 flex items-end justify-between gap-3">
              <div>
                <h2 id="exams-heading" className="heading-2">
                  Your exams
                </h2>
                <p className="caption mt-1">Accuracy per exam, most recently studied first</p>
              </div>
              <Link href="/exams" className="hidden shrink-0 text-xs font-semibold text-accent hover:underline sm:inline">
                Find more
              </Link>
            </div>

            <ul className="divide-y divide-surface-border">
              {progress.map((item) => {
                const accuracy = item.questionsSeen
                  ? Math.round((item.questionsCorrect / item.questionsSeen) * 100)
                  : 0;
                const tone = accuracyTone(accuracy);
                return (
                  <li key={item.examKey} className="min-w-0">
                    <Link
                      href={`/study?provider=${encodeURIComponent(item.providerId)}&exam=${encodeURIComponent(item.examKey)}&mode=practice`}
                      className="flex flex-col gap-1.5 rounded-xl py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 hover:bg-surface-overlay/50"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-semibold text-content-primary">
                          {item.examCode || item.examKey}
                        </span>
                        <span className={`numeric shrink-0 text-sm font-bold ${TONE_TEXT[tone]}`}>{accuracy}%</span>
                      </span>
                      <ProgressBar value={accuracy} tone={TONE_BAR[tone]} label={`${item.examCode || item.examKey} accuracy`} />
                      <span className="caption block">
                        {formatNumber(item.questionsSeen)} seen · best {item.bestScore}% · {relativeTime(item.lastStudiedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </Reveal>
      ) : null}
    </div>
  );
}

/** Score cell shared by the recent-attempts list and table. */
function AttemptScore({ status, score }: { status: string; score?: number }) {
  if (status === 'completed') {
    const value = score ?? 0;
    return <span className={`numeric text-sm font-bold ${TONE_TEXT[accuracyTone(value)]}`}>{value}%</span>;
  }
  return <span className="badge capitalize">{status.replace('_', ' ')}</span>;
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-52 rounded-[2rem] lg:col-span-2" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-[1.1rem]" />
          ))}
        </div>
      </div>
      <Skeleton className="h-24 rounded-[1.5rem]" />
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-60 rounded-[1.5rem] lg:col-span-2" />
        <Skeleton className="h-60 rounded-[1.5rem]" />
      </div>
    </div>
  );
}
