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
  IconChart,
  IconHistory,
  IconPlay,
  IconRefresh,
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

/** Practice hub for one exam, preselected so the learner only has to start. */
function practiceHrefFor(providerId: string, examKey: string): string {
  return `/practice?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`;
}

/** Mock hub for the same exam. */
function mockHrefFor(providerId: string, examKey: string): string {
  return `/mock?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`;
}

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

  if (loading) return <Spinner label="Loading your progress..." />;

  if (!user) {
    return (
      <EmptyState
        title="Sign in to see your progress"
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

  const hasHistory = stats.totalQuestions > 0 || recentAttempts.length > 0 || progress.length > 0;
  const weakest = weakTopics[0] ?? null;

  const practiceHref = focus ? practiceHrefFor(focus.providerId, focus.examKey) : '/practice';
  const mockHref = focus ? mockHrefFor(focus.providerId, focus.examKey) : '/mock';

  // One next best action, derived only from what the API returned. Order of
  // preference: resume a known exam, then the weakest measured topic, then a
  // first-run call to action. No exam or score is ever invented.
  const nextAction = focus
    ? focus.seen > 0
      ? {
          eyebrow: 'Continue where you left off',
          icon: IconPlay,
          title: `Continue ${focus.code}`,
          caption: `${formatNumber(focus.seen)} questions seen · best ${focus.best}% · ${relativeTime(focus.at)}`,
          primary: { href: practiceHref, label: 'Continue practice' },
          secondary: { href: mockHref, label: 'Sit a mock' },
          ring: focus.accuracy,
          ringLabel: `${focus.accuracy}% accuracy on ${focus.code}`,
        }
      : {
          // An attempt row can exist before a single answer does. Reporting
          // "0% accuracy" there would read as a failed exam, so ask for a start
          // instead of a resumption.
          eyebrow: 'Pick up where you left off',
          icon: IconPlay,
          title: `Start with ${focus.code}`,
          caption: `Your last session has no answers yet · ${relativeTime(focus.at)}. A short set is the quickest way back in.`,
          primary: { href: practiceHref, label: 'Start practice' },
          secondary: { href: mockHref, label: 'Sit a mock' },
          ring: null as number | null,
          ringLabel: '',
        }
    : hasHistory && weakest
      ? {
          eyebrow: 'Your next best move',
          icon: IconChart,
          title: 'Practise your weakest area',
          caption: `${weakest.topic} is your weakest area at ${weakest.accuracy}% (${weakest.correct} of ${formatNumber(weakest.attempts)} answers correct).`,
          primary: { href: '/practice', label: 'Practise weak areas' },
          secondary: { href: '/exams', label: 'Browse exams' },
          ring: weakest.accuracy,
          ringLabel: `${weakest.accuracy}% accuracy on ${weakest.topic}`,
        }
      : hasHistory
        ? {
            eyebrow: 'Your next best move',
            icon: IconChart,
            title: 'Practise a new exam',
            caption:
              'Your history is in, but no single area stands out yet. Answer a few more questions to sharpen the picture.',
            primary: { href: '/practice', label: 'Start practising' },
            secondary: { href: '/exams', label: 'Browse exams' },
            ring: null as number | null,
            ringLabel: '',
          }
        : {
            eyebrow: 'Start here',
            icon: IconSparkles,
            title: 'Start your first session',
            caption: 'Answer a few questions and your accuracy, weak areas and streak will build themselves.',
            primary: { href: '/practice', label: 'Start practising' },
            secondary: { href: '/exams', label: 'Browse exams' },
            ring: null as number | null,
            ringLabel: '',
          };

  const NextIcon = nextAction.icon;

  const quickActions = [
    {
      href: practiceHref,
      label: 'Practice',
      hint: focus ? `Questions from ${focus.code}` : 'Pick an exam and start',
      icon: IconBook,
      tone: 'bg-accent/10 text-accent',
    },
    {
      href: mockHref,
      label: 'Mock exam',
      hint: focus ? `A timed set for ${focus.code}` : 'Simulate exam day',
      icon: IconTrophy,
      tone: 'bg-accent-2/10 text-accent-2',
    },
    {
      href: '/ask',
      label: 'Ask the AI tutor',
      hint: 'Get a clear explanation',
      icon: IconSparkles,
      tone: 'bg-accent-3/15 text-accent',
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-7">
      <Reveal>
        <PageHeader
          eyebrow="Progress"
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

      {/* The single most important thing on the page: what to do next. */}
      <Reveal>
        <section
          aria-labelledby="next-action-heading"
          className="panel-lg ring-gradient relative isolate overflow-hidden p-5 sm:p-6"
        >
          <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-24 h-64" />
          <div aria-hidden="true" className="orb -right-16 -top-20 h-56 w-56 bg-accent/20" />
          <div aria-hidden="true" className="orb -bottom-24 -left-12 h-48 w-48 bg-accent-2/[0.14]" />

          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="eyebrow mb-2 inline-flex items-center gap-1.5">
                  <NextIcon width={13} height={13} className="shrink-0" aria-hidden="true" />
                  {nextAction.eyebrow}
                </p>
                <h2 id="next-action-heading" className="display-2 break-words text-balance">
                  {nextAction.title}
                </h2>
                <p className="body-text mt-2 max-w-xl text-pretty">{nextAction.caption}</p>
              </div>

              <div className="shrink-0">
                {nextAction.ring !== null ? (
                  <ProgressRing value={nextAction.ring} size={76} stroke={7} label={nextAction.ringLabel}>
                    <span className="flex flex-col items-center leading-none">
                      <span className="numeric text-base font-bold">{nextAction.ring}%</span>
                      <span className="mt-0.5 text-[0.5rem] font-semibold uppercase tracking-wide text-content-muted">
                        accuracy
                      </span>
                    </span>
                  </ProgressRing>
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid h-14 w-14 place-items-center rounded-[1.15rem] bg-gradient-to-br from-accent to-accent-2 text-white shadow-glow-sm"
                  >
                    <NextIcon width={24} height={24} />
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={nextAction.primary.href} className="btn-primary">
                {nextAction.primary.label}
                <IconArrowRight width={16} height={16} aria-hidden="true" />
              </Link>
              <Link href={nextAction.secondary.href} className="btn-secondary">
                {nextAction.secondary.label}
              </Link>
            </div>
          </div>
        </section>
      </Reveal>

      {/* Three one-tap starts, always in the same order. */}
      <Reveal>
        <nav aria-label="Quick start" className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href + action.label}
                href={action.href}
                className="tile tile-interactive group flex min-w-0 flex-col gap-2 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:flex-row sm:items-center sm:gap-3 sm:p-3.5"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[0.7rem] ${action.tone}`}>
                  <Icon width={17} height={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-semibold leading-snug text-content-primary">
                    {action.label}
                  </span>
                  <span className="mt-0.5 hidden text-[0.6875rem] leading-snug text-content-muted sm:block">
                    {action.hint}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </Reveal>

      {/* Headline numbers, grouped on one surface instead of four equal cards. */}
      <Reveal>
        <section aria-label="Your numbers" className="panel min-w-0 overflow-hidden">
          <StatStrip
            items={[
              {
                label: 'Accuracy',
                value: stats.totalQuestions > 0 ? `${stats.accuracy}%` : '—',
                hint:
                  stats.totalQuestions > 0
                    ? `${formatNumber(stats.totalCorrect)} / ${formatNumber(stats.totalQuestions)} correct`
                    : 'Answer questions to measure this',
                tone: stats.accuracy >= 80 ? 'success' : 'brand',
              },
              {
                label: 'Current streak',
                value: `${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'}`,
                hint:
                  stats.currentStreak > 0
                    ? `Best ${stats.longestStreak} ${stats.longestStreak === 1 ? 'day' : 'days'}`
                    : 'Answer today to start a streak',
                tone: 'warning',
              },
              {
                label: 'Questions answered',
                value: formatNumber(stats.totalQuestions),
                hint: stats.totalStudyMs > 0 ? `${formatDuration(stats.totalStudyMs)} studied` : 'No study time yet',
              },
              {
                label: 'Mock exams',
                value: formatNumber(stats.mockTests),
                hint: 'Completed mock exams',
              },
            ]}
          />
        </section>
      </Reveal>

      {/* Trend + the piece of analysis that tells you what to do next. */}
      <Reveal>
        <section aria-label="Performance" className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
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
            {performance.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-[1.1rem] bg-surface-sunken/70 p-4">
                <p className="text-sm leading-relaxed text-content-muted">
                  Your trend appears after your first answered questions. One short session is enough to plot the first point.
                </p>
                <Link href={practiceHref} className="btn-secondary btn-sm">
                  Start practising
                </Link>
              </div>
            ) : (
              <LineChart data={performance} />
            )}
          </div>

          <div className="panel-sunken min-w-0 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="heading-2">Weak topics</h2>
              {weakTopics.length > 0 ? (
                <span className="badge badge-warning shrink-0">{weakTopics.length} to review</span>
              ) : null}
            </div>

            {weakTopics.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-[1.1rem] bg-surface-raised/70 p-4">
                <p className="text-sm leading-relaxed text-content-muted">
                  Answer a few questions and we will rank the topics you miss most, so you know exactly what to revise.
                </p>
                <Link href={practiceHref} className="btn-secondary btn-sm">
                  Start a practice session
                </Link>
              </div>
            ) : (
              <>
                <WeakTopicsList topics={weakTopics} />
                <Link href={practiceHref} className="btn-secondary mt-4 w-full">
                  Practise weak areas
                </Link>
              </>
            )}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section aria-label="Recommendations and recent activity" className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="panel min-w-0 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="heading-2 inline-flex items-center gap-1.5">
                <IconSparkles className="shrink-0 text-accent" width={18} height={18} aria-hidden="true" />
                Recommended for you
              </h2>
              {recommendations.length > 0 ? (
                <Link href="/exams" className="link shrink-0 text-xs">
                  Browse all
                </Link>
              ) : null}
            </div>
            {recommendations.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-[1.1rem] bg-surface-sunken/70 p-4">
                <p className="text-sm leading-relaxed text-content-muted">
                  Recommendations are matched to the exams you practise. Browse the catalogue and answer a few questions in an exam to get yours.
                </p>
                <Link href="/exams" className="btn-secondary btn-sm">
                  Browse exams
                </Link>
              </div>
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
              <h2 className="heading-2 inline-flex items-center gap-1.5">
                <IconHistory className="shrink-0 text-content-muted" width={18} height={18} aria-hidden="true" />
                Recent attempts
              </h2>
              <Link href="/history" className="link shrink-0 text-xs">
                View all
              </Link>
            </div>

            {recentAttempts.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-[1.1rem] bg-surface-sunken/70 p-4">
                <p className="text-sm leading-relaxed text-content-muted">
                  No attempts yet. Start a practice session and your scores will show up here, ready to retake.
                </p>
                <Link href={practiceHref} className="btn-secondary btn-sm">
                  Start practising
                </Link>
              </div>
            ) : (
              <>
                {/* Stacked rows on a phone, a dense table once there is room. */}
                <ul className="flex flex-col divide-y divide-surface-border md:hidden">
                  {recentAttempts.map((attempt) => {
                    const code = attempt.examCode || attempt.examKey;
                    return (
                      <li key={attempt.id} className="flex min-w-0 items-center gap-2 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{code}</p>
                          <p className="caption capitalize">
                            {attempt.mode} · {relativeTime(attempt.createdAt)}
                          </p>
                        </div>
                        <AttemptScore status={attempt.status} score={attempt.scorePercent} />
                        <Link
                          href={practiceHrefFor(attempt.providerId, attempt.examKey)}
                          className="btn-ghost btn-sm shrink-0 gap-1 px-2 text-xs"
                          aria-label={`Retake ${code}`}
                        >
                          <IconRefresh width={14} height={14} aria-hidden="true" />
                          Retake
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                <table className="hidden w-full border-collapse text-sm md:table">
                  <caption className="sr-only">Your most recent attempts, with a link to retake each one</caption>
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
                      <th scope="col" className="pb-2 pl-3 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-content-muted">
                        <span className="sr-only">Retake</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAttempts.map((attempt) => {
                      const code = attempt.examCode || attempt.examKey;
                      return (
                        <tr key={attempt.id} className="border-b border-surface-border/60 last:border-0">
                          <th scope="row" className="max-w-[9rem] py-2.5 pr-3 text-left align-middle font-medium">
                            <span className="block truncate">{code}</span>
                            <span className="caption block capitalize">{attempt.mode}</span>
                          </th>
                          <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs text-content-muted">
                            {relativeTime(attempt.createdAt)}
                          </td>
                          <td className="py-2.5 pl-3 text-right align-middle">
                            <AttemptScore status={attempt.status} score={attempt.scorePercent} />
                          </td>
                          <td className="py-2.5 pl-3 text-right align-middle">
                            <Link
                              href={practiceHrefFor(attempt.providerId, attempt.examKey)}
                              className="btn-ghost btn-sm gap-1 whitespace-nowrap px-2 text-xs"
                              aria-label={`Retake ${code}`}
                            >
                              <IconRefresh width={14} height={14} aria-hidden="true" />
                              Retake
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
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
              <div className="min-w-0">
                <h2 id="exams-heading" className="heading-2">
                  Your exams
                </h2>
                <p className="caption mt-1">Accuracy per exam, most recently studied first</p>
              </div>
              <Link href="/exams" className="link hidden shrink-0 text-xs sm:inline">
                Find more
              </Link>
            </div>

            <ul className="divide-y divide-surface-border">
              {progress.map((item) => {
                const accuracy = item.questionsSeen
                  ? Math.round((item.questionsCorrect / item.questionsSeen) * 100)
                  : 0;
                const tone = accuracyTone(accuracy);
                const code = item.examCode || item.examKey;
                return (
                  <li key={`${item.providerId}-${item.examKey}`} className="min-w-0">
                    <Link
                      href={practiceHrefFor(item.providerId, item.examKey)}
                      className="flex min-w-0 flex-col gap-1.5 rounded-xl py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 hover:bg-surface-overlay/50"
                    >
                      <span className="flex min-w-0 items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-semibold text-content-primary">{code}</span>
                        <span className={`numeric shrink-0 text-sm font-bold ${TONE_TEXT[tone]}`}>{accuracy}%</span>
                      </span>
                      <ProgressBar value={accuracy} tone={TONE_BAR[tone]} label={`${code} accuracy`} />
                      <span className="caption block">
                        {formatNumber(item.questionsSeen)} seen · best {item.bestScore}% · {relativeTime(item.lastStudiedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Link href="/exams" className="btn-secondary mt-3 w-full sm:hidden">
              Find more exams
            </Link>
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
    return <span className={`numeric shrink-0 text-sm font-bold ${TONE_TEXT[accuracyTone(value)]}`}>{value}%</span>;
  }
  return <span className="badge shrink-0 whitespace-nowrap capitalize">{status.replace('_', ' ')}</span>;
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5 sm:gap-7" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3.5 w-full max-w-md" />
      </div>
      <Skeleton className="h-56 rounded-[2rem]" />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-[1.1rem]" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-[1.5rem]" />
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-[1.5rem] lg:col-span-2" />
        <Skeleton className="h-64 rounded-[1.5rem]" />
      </div>
    </div>
  );
}