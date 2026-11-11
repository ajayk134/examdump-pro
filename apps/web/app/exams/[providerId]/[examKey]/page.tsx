'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { ExamDetail } from '@/lib/types';
import {
  Badge,
  ErrorState,
  PageShell,
  ProgressRing,
  Skeleton,
} from '@/components/ui';
import {
  IconArrowLeft,
  IconBookmark,
  IconChevronRight,
  IconClock,
  IconLightning,
  IconPlay,
  IconRefresh,
  IconSparkles,
  IconTrophy,
} from '@/components/icons';
import { cn } from '@/lib/format';
import { examId, pushRecent, toggleExamBookmark } from '@/lib/local-store';

type Mode = 'practice' | 'mock' | 'random';

interface ModeSpec {
  id: Mode;
  title: string;
  blurb: string;
  icon: typeof IconPlay;
  accent: string;
  cta: string;
}

const MODES: ModeSpec[] = [
  {
    id: 'practice',
    title: 'Practice',
    blurb: 'Untimed. Instant explanations and Ask AI after every answer.',
    icon: IconSparkles,
    accent: 'from-brand-600 to-sky-400',
    cta: 'Start practice',
  },
  {
    id: 'mock',
    title: 'Mock test',
    blurb: 'Exam conditions. Timer, no hints, full score report at the end.',
    icon: IconTrophy,
    accent: 'from-violet-600 to-fuchsia-500',
    cta: 'Start mock test',
  },
  {
    id: 'random',
    title: 'Quick drill',
    blurb: 'Ten questions pulled at random across the whole bank.',
    icon: IconLightning,
    accent: 'from-amber-500 to-orange-500',
    cta: 'Start drill',
  },
];

export default function ExamDetailPage() {
  const params = useParams<{ providerId: string; examKey: string }>();
  const router = useRouter();
  const providerId = decodeURIComponent(params.providerId);
  const examKey = decodeURIComponent(params.examKey);

  const [data, setData] = useState<ExamDetail | null>(null);
  const [error, setError] = useState('');
  const [bookmarked, setBookmarked] = useState(false);

  const load = useCallback(() => {
    setError('');
    get<ExamDetail>(`/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}`)
      .then((res) => setData(res))
      .catch((err) => setError((err as Error).message));
  }, [providerId, examKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    pushRecent(providerId, examKey);
    setBookmarked(toggleExamBookmark.has(examId(providerId, examKey)));
  }, [providerId, examKey]);

  function start(mode: Mode) {
    if (mode === 'mock') {
      router.push(`/mock?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`);
      return;
    }
    router.push(`/practice?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=${mode}`);
  }

  if (error) {
    return (
      <PageShell>
        <ErrorState title="Exam not available" description={error} onRetry={load} />
        <div className="mt-4 flex justify-center">
          <Link href="/exams" className="btn-secondary btn-sm">
            Back to discover
          </Link>
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell>
        <div className="mb-4">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="surface mb-4 p-5">
          <Skeleton className="mb-3 h-5 w-24" />
          <Skeleton className="mb-2 h-7 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </PageShell>
    );
  }

  const { exam, entitlement } = data;
  const accessible = entitlement.accessibleQuestions;
  const total = entitlement.totalQuestions;
  const limited = entitlement.isLimited;

  return (
    <PageShell className="flex flex-col gap-4 sm:gap-5">
      <Link
        href={`/exams/${encodeURIComponent(providerId)}`}
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-content-muted transition-colors hover:text-content-primary"
      >
        <IconArrowLeft className="h-4 w-4" />
        {data.provider.title}
      </Link>

      {/* Hero */}
      <section className="surface relative overflow-hidden p-4 sm:p-6">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 via-sky-400 to-violet-500"
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="accent" className="font-mono uppercase">
                {exam.code}
              </Badge>
              {limited ? <Badge tone="warning">Preview · {accessible} free</Badge> : <Badge tone="success">Full access</Badge>}
            </div>
            <h1 className="display-2 text-balance">{exam.title}</h1>
            <p className="body-text mt-1.5">
              {data.provider.title} · {total.toLocaleString()} questions
            </p>
          </div>

          <div className="flex items-center gap-2 sm:flex-col sm:items-end">
            <ProgressRing value={limited ? (accessible / Math.max(total, 1)) * 100 : 100} size={62} label="Access">
              <span className="numeric text-[0.8125rem] font-bold">{accessible}</span>
            </ProgressRing>
            <button
              type="button"
              onClick={() => {
                toggleExamBookmark.toggle(examId(providerId, examKey));
                setBookmarked(toggleExamBookmark.has(examId(providerId, examKey)));
              }}
              aria-pressed={bookmarked}
              className={cn('btn-secondary btn-sm', bookmarked && 'text-accent')}
            >
              <IconBookmark className={cn('h-4 w-4', bookmarked && 'fill-current')} />
              {bookmarked ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </section>

      {/* Modes */}
      <section aria-labelledby="modes-heading">
        <h2 id="modes-heading" className="sr-only">
          Study modes
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => start(mode.id)}
                className="surface surface-interactive group flex flex-col items-start p-4 text-left"
              >
                <span
                  className={cn(
                    'mb-3 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm',
                    mode.accent,
                  )}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="heading-3">{mode.title}</span>
                <span className="mt-1 text-xs leading-relaxed text-content-muted">{mode.blurb}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-accent">
                  {mode.cta}
                  <IconChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Quick facts */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Fact label="Questions" value={total.toLocaleString()} />
        <Fact label="Unlocked" value={accessible.toLocaleString()} tone={limited ? 'warning' : 'success'} />
        <Fact label="Est. practice" value={`${Math.max(1, Math.round(total * 1.2 / 60))}h`} hint="~1.2 min / question" />
        <Fact label="Provider" value={data.provider.title} />
      </section>

      {limited ? (
        <div className="surface flex flex-col gap-3 border-caution/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-caution/15 text-caution">
              <IconSparkles className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="heading-3">You have {accessible} questions unlocked</p>
              <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
                Unlock all {total.toLocaleString()} to get the full mock bank, weak-topic analytics and unlimited AI explanations.
              </p>
            </div>
          </div>
          <Link href="/pricing" className="btn-primary btn-sm shrink-0">
            See plans
          </Link>
        </div>
      ) : null}

      {/* Sticky mobile start bar */}
      <div
        className="pointer-events-none sticky z-20 flex justify-center lg:hidden"
        style={{ bottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
      >
        <button
          type="button"
          onClick={() => start('practice')}
          className="btn-primary pointer-events-auto w-full max-w-sm shadow-lg"
        >
          <IconPlay className="h-4 w-4" />
          Start practice
        </button>
      </div>

      <p className="caption flex items-center gap-1.5">
        <IconClock className="h-3.5 w-3.5" />
        Progress is saved automatically as you answer.
        <button type="button" onClick={load} className="ml-auto inline-flex items-center gap-1 text-accent">
          <IconRefresh className="h-3.5 w-3.5" />
          Refresh
        </button>
      </p>
    </PageShell>
  );
}

function Fact({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <div className="surface p-3">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-content-muted">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-sm font-bold',
          tone === 'success' && 'text-positive',
          tone === 'warning' && 'text-caution',
        )}
        title={value}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[0.625rem] text-content-muted">{hint}</p> : null}
    </div>
  );
}
