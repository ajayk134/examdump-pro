'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { get } from '@/lib/api';
import type { AttemptSummary, ExamDetail, Paginated } from '@/lib/types';
import { PracticeConfig } from '@/components/practice-config';
import { MockConfig } from '@/components/mock-config';
import type { SelectedExam } from '@/components/exam-select';
import { useAuth } from '@/components/providers';
import {
  Alert,
  EmptyIcon,
  EmptyState,
  ErrorState,
  PageShell,
  Skeleton,
} from '@/components/ui';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook,
  IconBookmark,
  IconChart,
  IconCheckCircle,
  IconClock,
  IconRefresh,
  IconTrophy,
} from '@/components/icons';
import { cn, formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { examId, pushRecent, toggleExamBookmark } from '@/lib/local-store';

type Tab = 'overview' | 'practice' | 'mock' | 'attempts';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'practice', label: 'Practice' },
  { id: 'mock', label: 'Mock exam' },
  { id: 'attempts', label: 'Attempts' },
];

const FAQS = [
  {
    q: 'How many questions can I try?',
    a: 'Your plan decides the question bank you can open. Free plans include a fixed set per exam; a pass unlocks the full bank, mocks and analytics.',
  },
  {
    q: 'Does my progress save?',
    a: 'Yes. Practice answers are graded on the server and feed your accuracy, weak areas and streak. Mock attempts are stored with their full score report.',
  },
  {
    q: 'What is the difference between practice and a mock?',
    a: 'Practice shows the explanation immediately and lets you filter by type or by what you have missed. A mock hides explanations, runs a timer and scores the whole paper at the end.',
  },
];

export default function ExamWorkspacePage() {
  const routeParams = useParams<{ providerId: string; examKey: string }>();
  const providerId = decodeURIComponent(routeParams.providerId ?? '');
  const examKey = decodeURIComponent(routeParams.examKey ?? '');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'overview';
  const [tab, setTab] = useState<Tab>(TABS.some((entry) => entry.id === initialTab) ? initialTab : 'overview');
  const [data, setData] = useState<ExamDetail | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [attemptsError, setAttemptsError] = useState('');

  useEffect(() => {
    setSaved(toggleExamBookmark().includes(examId(providerId, examKey)));
  }, [providerId, examKey]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    get<ExamDetail>(`/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}`)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey]);

  useEffect(() => {
    if (tab !== 'attempts' || !user) return;
    let cancelled = false;
    setAttempts(null);
    setAttemptsError('');
    const query = new URLSearchParams({ examKey, status: 'completed', pageSize: '20' });
    get<Paginated<AttemptSummary>>(`/attempts?${query.toString()}`)
      .then((response) => {
        if (!cancelled) setAttempts(response.items);
      })
      .catch((err) => {
        if (!cancelled) setAttemptsError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, user, examKey]);

  const selected: SelectedExam | null = data
    ? {
        providerId: data.exam.providerId,
        examKey: data.exam.key,
        code: data.exam.code,
        title: data.exam.title,
        providerTitle: data.exam.providerTitle,
        questionCount: data.exam.questionCount,
      }
    : null;

  useEffect(() => {
    if (data) pushRecent(data.exam.providerId, data.exam.key);
  }, [data]);

  function toggleSaved() {
    const next = toggleExamBookmark.toggle(examId(providerId, examKey));
    setSaved(next.includes(examId(providerId, examKey)));
  }

  function openTab(next: Tab) {
    setTab(next);
    router.replace(`?tab=${next}`, { scroll: false });
  }

  if (error) {
    return (
      <PageShell className="py-8">
        <ErrorState title="Could not load this exam" description={error} onRetry={() => router.refresh()} />
        <div className="mt-4 flex justify-center">
          <Link href="/exams" className="btn-secondary btn-sm">
            <IconArrowLeft className="h-4 w-4" /> Discover exams
          </Link>
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell className="py-5 sm:py-8" >
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-44 rounded-[2rem]" />
          <Skeleton className="h-12 w-72 rounded-full" />
          <Skeleton className="h-56 rounded-[1.5rem]" />
        </div>
      </PageShell>
    );
  }

  const limited = data.entitlement.isLimited;
  const accessible = data.entitlement.accessibleQuestions;
  const total = data.entitlement.totalQuestions;

  return (
    <PageShell className="py-4 sm:py-6">
      <Link
        href="/exams"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-content-muted hover:text-content-primary"
      >
        <IconArrowLeft className="h-3.5 w-3.5" />
        All exams
      </Link>

      {/* Hero */}
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border bg-surface-raised shadow-sm">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.2]"
          style={{
            background:
              'radial-gradient(40rem 20rem at 0% 0%, rgb(var(--accent) / 0.55), transparent 62%), radial-gradient(32rem 18rem at 100% 0%, rgb(var(--accent-2) / 0.5), transparent 60%)',
          }}
        />
        <div className="relative flex flex-col gap-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-surface-border bg-surface-raised/70 px-2.5 py-1 font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-accent backdrop-blur">
              {data.exam.code}
            </span>
            <Link
              href={`/exams/${encodeURIComponent(providerId)}`}
              className="rounded-full border border-surface-border bg-surface-raised/70 px-2.5 py-1 text-[0.66rem] font-semibold text-content-secondary backdrop-blur hover:text-content-primary"
            >
              {data.exam.providerTitle}
            </Link>
            {limited ? (
              <span className="rounded-full border border-caution/40 bg-caution/10 px-2.5 py-1 text-[0.66rem] font-semibold text-caution">
                {formatNumber(accessible)} of {formatNumber(total)} unlocked
              </span>
            ) : (
              <span className="rounded-full border border-positive/40 bg-positive/10 px-2.5 py-1 text-[0.66rem] font-semibold text-positive">
                Full bank unlocked
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="display-1 text-balance">{data.exam.title}</h1>
              <p className="body-text mt-2 max-w-xl text-sm sm:text-base">
                {formatNumber(total)} questions in the bank. Build a focused practice set or sit a timed mock.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleSaved}
                aria-pressed={saved}
                className={cn('btn-secondary btn-sm', saved && 'text-accent')}
              >
                <IconBookmark className="h-4 w-4" />
                {saved ? 'Saved' : 'Save exam'}
              </button>
              <button type="button" onClick={() => openTab('practice')} className="btn-primary btn-sm">
                Start practice
                <IconArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {limited ? (
        <div className="mt-3">
          <Alert tone="info">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Your plan unlocks {formatNumber(accessible)} of {formatNumber(total)} questions for this exam.
              </span>
              <Link href="/pricing" className="btn-primary btn-sm shrink-0">
                See plans
              </Link>
            </div>
          </Alert>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="sticky top-14 z-30 -mx-3.5 mt-3 px-3.5 py-2 sm:top-16 sm:mx-0 sm:px-0">
        <div
          role="tablist"
          aria-label="Exam workspace"
          className="glass no-scrollbar flex gap-1 overflow-x-auto rounded-full border border-surface-border/70 p-1 shadow-sm"
        >
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => openTab(entry.id)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-2 text-[0.8125rem] font-semibold transition-colors',
                  active ? 'bg-accent text-white shadow-glow-sm' : 'text-content-secondary hover:text-content-primary',
                )}
              >
                {entry.label}
                {entry.id === 'attempts' && attempts && attempts.length > 0 ? (
                  <span className="ml-1.5 numeric text-[0.66rem] opacity-80">{attempts.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        {tab === 'overview' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6">
            <div className="flex min-w-0 flex-col gap-3">
              <section className="panel p-4 sm:p-5">
                <h2 className="heading-3 mb-3">At a glance</h2>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Questions', value: formatNumber(total) },
                    { label: 'Unlocked', value: formatNumber(accessible) },
                    { label: 'Provider', value: data.exam.providerTitle },
                    { label: 'Exam code', value: data.exam.code },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[0.9rem] border border-surface-border bg-surface-inset/50 p-3">
                      <dt className="metric-label">{item.label}</dt>
                      <dd className="mt-1 truncate font-display text-sm font-semibold">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="panel p-4 sm:p-5">
                <h2 className="heading-3 mb-3">Choose how to study</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => openTab('practice')}
                    className="tile tile-interactive flex flex-col items-start gap-1.5 p-4 text-left"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
                      <IconBook className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold">Focused practice</span>
                    <span className="text-xs text-content-muted">
                      Filter by question type or by what you have missed, then start in one tap.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openTab('mock')}
                    className="tile tile-interactive flex flex-col items-start gap-1.5 p-4 text-left"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
                      <IconTrophy className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold">Mock exam</span>
                    <span className="text-xs text-content-muted">
                      Set the length and timer, then get a full score report with a question review.
                    </span>
                  </button>
                </div>
              </section>

              <section className="panel p-4 sm:p-5">
                <h2 className="heading-3 mb-3">Questions about {data.exam.code}</h2>
                <div className="flex flex-col divide-y divide-surface-border">
                  {FAQS.map((faq) => (
                    <details key={faq.q} className="group py-3 first:pt-0 last:pb-0">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                        {faq.q}
                        <span className="text-content-muted transition-transform group-open:rotate-45" aria-hidden="true">
                          +
                        </span>
                      </summary>
                      <p className="mt-1.5 text-sm leading-relaxed text-content-muted">{faq.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-3">
              <div className="panel flex flex-col gap-3 p-4 sm:p-5">
                <p className="eyebrow">Quick actions</p>
                <button type="button" onClick={() => openTab('practice')} className="btn-primary btn-block">
                  <IconBook className="h-4 w-4" /> Start practice
                </button>
                <button type="button" onClick={() => openTab('mock')} className="btn-secondary btn-block">
                  <IconTrophy className="h-4 w-4" /> Start mock
                </button>
                <Link
                  href={`/ask?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}`}
                  className="btn-ghost btn-block"
                >
                  Ask the AI tutor
                </Link>
              </div>

              <div className="panel flex flex-col gap-2 p-4">
                <p className="eyebrow">Progress</p>
                <p className="text-sm text-content-muted">
                  Your accuracy, weak areas and every attempt live on the progress page.
                </p>
                <Link href="/dashboard" className="btn-secondary btn-sm">
                  <IconChart className="h-4 w-4" /> Open progress
                </Link>
              </div>
            </aside>
          </div>
        ) : null}

        {tab === 'practice' && selected ? (
          <PracticeConfig initialExam={selected} fixedExam />
        ) : null}

        {tab === 'mock' && selected ? <MockConfig initialExam={selected} fixedExam /> : null}

        {tab === 'attempts' ? (
          <div className="flex flex-col gap-3">
            {!user ? (
              <EmptyState
                icon={<EmptyIcon name="chart" />}
                title="Sign in to see attempts"
                description="Mock scores and practice history are stored with your account."
                action={
                  <Link href="/login" className="btn-primary btn-sm">
                    Sign in
                  </Link>
                }
              />
            ) : attemptsError ? (
              <Alert tone="error">{attemptsError}</Alert>
            ) : attempts === null ? (
              <div className="flex flex-col gap-1.5" aria-busy="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 rounded-[1rem]" />
                ))}
              </div>
            ) : attempts.length === 0 ? (
              <EmptyState
                icon={<EmptyIcon name="chart" />}
                title="No attempts yet"
                description="Sit a mock to create your first score report for this exam."
                action={
                  <button type="button" onClick={() => openTab('mock')} className="btn-primary btn-sm">
                    Start a mock
                  </button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {attempts.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="flex flex-wrap items-center gap-3 rounded-[1rem] border border-surface-border bg-surface-raised p-3 shadow-xs"
                  >
                    <span
                      className={cn(
                        'numeric grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold',
                        (attempt.scorePercent ?? 0) >= 70
                          ? 'bg-positive/15 text-positive'
                          : 'bg-caution/15 text-caution',
                      )}
                    >
                      {attempt.scorePercent ?? 0}%
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {attempt.mode === 'timed' ? 'Timed mock' : attempt.mode === 'mock' ? 'Mock exam' : 'Attempt'}
                        <span className="ml-2 font-normal text-content-muted">
                          {attempt.correctCount ?? 0}/{attempt.totalQuestions ?? 0} correct
                        </span>
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-content-muted">
                        <span>{formatDateTime(attempt.completedAt ?? attempt.createdAt)}</span>
                        {attempt.timeSpentMs ? (
                          <span className="inline-flex items-center gap-1">
                            <IconClock className="h-3 w-3" /> {formatDuration(attempt.timeSpentMs)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openTab('mock')}
                      className="btn-secondary btn-sm shrink-0"
                    >
                      <IconRefresh className="h-3.5 w-3.5" /> Retake
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

    </PageShell>
  );
}