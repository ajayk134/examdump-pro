'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { ExamDetail } from '@/lib/types';
import { ErrorState, ProgressRing, Skeleton } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import {
  IconArrowLeft,
  IconBookmark,
  IconCheckCircle,
  IconChevronDown,
  IconChevronRight,
  IconLightning,
  IconMessage,
  IconNote,
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
    accent: 'from-brand-500 to-brand-600',
    cta: 'Start practice',
  },
  {
    id: 'mock',
    title: 'Mock test',
    blurb: 'Exam conditions. Timer, no hints, full score report at the end.',
    icon: IconTrophy,
    accent: 'from-accent-2 to-brand-500',
    cta: 'Start mock test',
  },
  {
    id: 'random',
    title: 'Quick drill',
    blurb: 'Ten questions pulled at random across the whole bank.',
    icon: IconLightning,
    accent: 'from-aqua-400 to-aqua-600',
    cta: 'Start drill',
  },
];

/** Platform capabilities, not exam-specific claims. */
const RESOURCES = [
  { icon: IconPlay, title: 'Practice mode', body: 'Answer at your own pace and read an explanation after every question.' },
  { icon: IconTrophy, title: 'Timed mock', body: 'Sit a full simulation with a countdown and a graded score report.' },
  { icon: IconMessage, title: 'AI tutor', body: 'Ask why an answer is right, or open a chat about any topic.' },
  { icon: IconNote, title: 'Notes & bookmarks', body: 'Save questions and build a personal revision guide as you go.' },
];

const FAQ = [
  {
    q: 'How many questions can I try for free?',
    a: 'Every exam includes a free preview of five questions, on any plan. No card is needed to start.',
  },
  {
    q: 'Does my progress save?',
    a: 'Yes. Progress is saved automatically as you answer, and your bookmarks, notes and attempt history are kept.',
  },
  {
    q: 'What is the difference between practice and a mock test?',
    a: 'Practice is untimed with explanations after every answer. A mock test runs under exam conditions with a timer and no hints, then grades your attempt.',
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
      <div className="mx-auto max-w-3xl">
        <ErrorState title="Exam not available" description={error} onRetry={load} />
        <div className="mt-4 flex justify-center">
          <Link href="/exams" className="btn-secondary btn-sm">
            Back to discover
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-40 rounded-full" />
        <Skeleton className="h-56 w-full rounded-[2rem]" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-[1.5rem]" />
          ))}
        </div>
      </div>
    );
  }

  const { exam, entitlement } = data;
  const accessible = entitlement.accessibleQuestions;
  const total = entitlement.totalQuestions;
  const limited = entitlement.isLimited;
  const estHours = Math.max(1, Math.round((total * 1.2) / 60));

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <Link
        href={`/exams/${encodeURIComponent(providerId)}`}
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-content-muted transition-colors hover:text-content-primary"
      >
        <IconArrowLeft className="h-4 w-4" />
        {data.provider.title}
      </Link>

      {/* ---------------- Hero ---------------- */}
      <section className="mesh relative isolate overflow-hidden rounded-[2rem] border border-surface-border p-6 text-white sm:p-9">
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-brand-700/85 via-brand-600/80 to-accent-2/70" />
        <div aria-hidden="true" className="orb -right-10 -top-16 h-56 w-56 bg-aqua-400/30" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs font-bold uppercase tracking-[0.1em] backdrop-blur">
                {exam.code}
              </span>
              {limited ? (
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
                  Free preview · {accessible} unlocked
                </span>
              ) : (
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">Full access</span>
              )}
            </div>

            <h1 className="display-1 mt-5 text-balance">{exam.title}</h1>
            <p className="mt-3 text-sm text-white/80">
              <Link href={`/exams/${encodeURIComponent(providerId)}`} className="font-semibold underline underline-offset-4">
                {data.provider.title}
              </Link>
              <span aria-hidden="true" className="mx-2 text-white/50">
                ·
              </span>
              {total.toLocaleString()} questions in the bank
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => start('practice')} className="btn bg-white px-6 text-brand-700 hover:bg-white/90">
                <IconPlay width={16} height={16} />
                Start practice
              </button>
              <button
                type="button"
                onClick={() => start('mock')}
                className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                <IconTrophy width={15} height={15} />
                Start mock test
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:flex-col lg:items-end">
            <div className="rounded-[1.5rem] bg-white/10 p-4 backdrop-blur">
              <ProgressRing value={limited ? (accessible / Math.max(total, 1)) * 100 : 100} size={96} label="Access">
                <span className="numeric text-lg font-bold">{accessible}</span>
                <span className="text-[0.6rem] uppercase tracking-wide opacity-80">of {total.toLocaleString()}</span>
              </ProgressRing>
            </div>
            <button
              type="button"
              onClick={() => {
                toggleExamBookmark.toggle(examId(providerId, examKey));
                setBookmarked(toggleExamBookmark.has(examId(providerId, examKey)));
              }}
              aria-pressed={bookmarked}
              className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              <IconBookmark className={cn('h-4 w-4', bookmarked && 'fill-current')} />
              {bookmarked ? 'Saved' : 'Save exam'}
            </button>
          </div>
        </div>
      </section>

      {/* ---------------- How to study ---------------- */}
      <Reveal>
        <section aria-labelledby="modes-heading" className="section">
          <div className="section-head">
            <div>
              <p className="eyebrow mb-2">Get started</p>
              <h2 id="modes-heading" className="display-2">
                Choose how to study
              </h2>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {MODES.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => start(mode.id)}
                  className="group relative flex flex-col items-start overflow-hidden rounded-[1.5rem] border border-surface-border bg-surface-raised p-5 text-left shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-md"
                >
                  <span
                    className={cn('grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-glow-sm', mode.accent)}
                    aria-hidden="true"
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="mt-4 font-display text-lg font-semibold">{mode.title}</span>
                  <span className="mt-1.5 text-[0.8125rem] leading-relaxed text-content-muted">{mode.blurb}</span>
                  <span className="mt-4 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-accent">
                    {mode.cta}
                    <IconChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </Reveal>

      {/* ---------------- Format + resources ---------------- */}
      <Reveal>
        <section aria-labelledby="overview-heading" className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-5 sm:p-6">
            <p className="eyebrow mb-4">At a glance</p>
            <h2 id="overview-heading" className="sr-only">
              At a glance
            </h2>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Questions" value={total.toLocaleString()} />
              <Stat label="Free preview" value={`${accessible}`} tone={limited ? 'warning' : 'success'} />
              <Stat label="Est. study time" value={`${estHours}h`} hint="~1.2 min / question" />
              <Stat label="Provider" value={data.provider.title} />
            </dl>
          </div>

          <div className="panel p-5 sm:p-6">
            <p className="eyebrow mb-4">What is included</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {RESOURCES.map((r) => {
                const Icon = r.icon;
                return (
                  <li key={r.title} className="tile flex items-start gap-3 p-3.5">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                      <Icon width={18} height={18} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{r.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-content-muted">{r.body}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </Reveal>

      {/* ---------------- Access / upgrade ---------------- */}
      {limited ? (
        <Reveal>
          <div className="relative overflow-hidden rounded-[1.75rem] border border-accent/30 bg-surface-raised p-5 shadow-sm sm:p-6">
            <div aria-hidden="true" className="orb -right-10 -top-10 h-44 w-44 bg-brand-500/20" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-2 text-white shadow-glow-sm">
                  <IconSparkles className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold">You have {accessible} questions unlocked</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-content-muted">
                    Unlock all {total.toLocaleString()} to get the full mock bank, weak-topic analytics and unlimited AI
                    explanations.
                  </p>
                </div>
              </div>
              <Link href="/pricing" className="btn-primary shrink-0">
                See plans
              </Link>
            </div>
          </div>
        </Reveal>
      ) : null}

      {/* ---------------- FAQ ---------------- */}
      <Reveal>
        <section aria-labelledby="exam-faq-heading" className="section">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow mb-2">Good to know</p>
            <h2 id="exam-faq-heading" className="display-2">
              Questions about {exam.code}
            </h2>
          </div>
          <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-surface-border bg-surface-raised shadow-sm">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-t border-surface-border first:border-t-0">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-content-primary transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <IconChevronDown width={18} height={18} className="shrink-0 text-content-muted transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-4 text-sm leading-relaxed text-content-secondary">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </Reveal>

      {/* ---------------- Footer note ---------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="caption flex items-center gap-1.5">
          <IconCheckCircle className="h-4 w-4 text-positive" />
          Progress is saved automatically as you answer.
        </p>
        <button type="button" onClick={load} className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-accent touch:min-h-11">
          <IconRefresh className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* ---------------- Sticky mobile start bar ---------------- */}
      <div
        className="pointer-events-none sticky z-20 flex justify-center lg:hidden"
        style={{ bottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        <button type="button" onClick={() => start('practice')} className="btn-primary pointer-events-auto w-full max-w-sm shadow-lg">
          <IconPlay className="h-4 w-4" />
          Start practice
        </button>
      </div>
    </div>
  );
}

function Stat({
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
    <div className="rounded-[1.1rem] bg-surface-overlay p-3.5">
      <dt className="metric-label">{label}</dt>
      <dd
        className={cn(
          'numeric mt-1.5 truncate font-display text-lg font-bold',
          tone === 'success' && 'text-positive',
          tone === 'warning' && 'text-caution',
        )}
        title={value}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-[0.6875rem] text-content-muted">{hint}</p> : null}
    </div>
  );
}
