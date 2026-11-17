'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import type { AttemptSummary, Paginated, PracticeOptions } from '@/lib/types';
import { ExamSelect, type SelectedExam } from './exam-select';
import { IconAlertCircle, IconCheckCircle, IconClock, IconPlay, IconTrophy } from './icons';
import { Alert, Skeleton } from './ui';
import { cn, formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { useAuth } from './providers';

const COUNT_PRESETS = [10, 20, 40, 60];

const DURATIONS = [
  { id: 'untimed', label: 'Untimed', seconds: null, hint: 'No clock' },
  { id: '30', label: '30 min', seconds: 1800, hint: 'Quick simulation' },
  { id: '60', label: '60 min', seconds: 3600, hint: 'Standard' },
  { id: '90', label: '90 min', seconds: 5400, hint: 'Full length' },
] as const;

type DurationId = (typeof DURATIONS)[number]['id'];

export function MockConfig({
  initialExam = null,
  fixedExam = false,
  compact = false,
}: {
  initialExam?: SelectedExam | null;
  fixedExam?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();

  const [exam, setExam] = useState<SelectedExam | null>(initialExam);
  const [options, setOptions] = useState<PracticeOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [count, setCount] = useState<number>(20);
  const [duration, setDuration] = useState<DurationId>('60');
  const [history, setHistory] = useState<AttemptSummary[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    setExam(initialExam);
  }, [initialExam]);

  useEffect(() => {
    if (!exam) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    setOptions(null);
    setOptionsError('');
    get<PracticeOptions>(
      `/exams/${encodeURIComponent(exam.providerId)}/${encodeURIComponent(exam.examKey)}/practice-options`,
    )
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch((err) => {
        if (!cancelled) setOptionsError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [exam]);

  useEffect(() => {
    if (!exam || !user) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryError('');
    const params = new URLSearchParams({ examKey: exam.examKey, status: 'completed', pageSize: '5' });
    get<Paginated<AttemptSummary>>(`/attempts?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setHistory(data.items);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [exam, user, historyKey]);

  const accessible = options?.accessibleQuestions ?? 0;
  const maxMock = options?.limits.maxMock ?? 60;
  const cap = Math.max(1, Math.min(accessible, maxMock));

  const countOptions = useMemo(() => {
    const presets = COUNT_PRESETS.filter((preset) => preset < cap);
    return [...presets, cap];
  }, [cap]);

  const effectiveCount = Math.min(count, cap);

  /*
   * A 60-minute clock on a five-question sampler reads as a mistake. Until the
   * learner picks a limit themselves, follow the length of the paper instead.
   */
  const durationTouched = useRef(false);
  useEffect(() => {
    if (durationTouched.current || !options) return;
    setDuration(effectiveCount <= 20 ? '30' : effectiveCount <= 45 ? '60' : '90');
  }, [options, effectiveCount]);

  const best = useMemo(() => {
    if (!history || history.length === 0) return null;
    return Math.max(...history.map((attempt) => attempt.scorePercent ?? 0));
  }, [history]);

  const canStart = Boolean(exam && options && accessible > 0);

  function start() {
    if (!exam) return;
    const chosen = DURATIONS.find((entry) => entry.id === duration) ?? DURATIONS[0];
    const params = new URLSearchParams({
      provider: exam.providerId,
      exam: exam.examKey,
      count: String(effectiveCount),
      mode: chosen.seconds ? 'timed' : 'mock',
    });
    if (chosen.seconds) params.set('duration', String(chosen.seconds));
    router.push(`/mock/session?${params.toString()}`);
  }

  return (
    <div className={cn('grid gap-4', compact ? '' : 'lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6')}>
      <div className="flex min-w-0 flex-col gap-3">
        {fixedExam && exam ? (
          <div className="flex items-center gap-3 rounded-[1.25rem] border border-surface-border bg-surface-raised p-3">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[0.8rem] bg-gradient-to-br from-brand-500 to-accent-2 font-display text-xs font-bold text-white"
            >
              {exam.code.slice(0, 3).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-accent">
                {exam.code}
              </p>
              <p className="truncate font-display text-base font-semibold">{exam.title}</p>
            </div>
          </div>
        ) : (
          <section aria-labelledby="mock-step-exam" className="panel p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[0.7rem] font-bold text-white">
                1
              </span>
              <h2 id="mock-step-exam" className="heading-3">
                Choose your exam
              </h2>
            </div>
            <ExamSelect value={exam} onChange={setExam} placeholder="Search exams by code or name" />
          </section>
        )}

        {exam ? (
          optionsError ? (
            <Alert tone="error">{optionsError}</Alert>
          ) : !options ? (
            <section className="panel p-4 sm:p-5" aria-busy="true">
              <Skeleton className="mb-3 h-5 w-40" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-[4rem] rounded-[1rem]" />
                ))}
              </div>
            </section>
          ) : (
            <section aria-labelledby="mock-step-format" className="panel p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[0.7rem] font-bold text-white">
                  2
                </span>
                <h2 id="mock-step-format" className="heading-3">
                  Set the simulator
                </h2>
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-content-muted">
                  Questions
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {countOptions.map((preset, index) => {
                    const isAll = index === countOptions.length - 1;
                    const selected = isAll ? count >= cap : count === preset;
                    return (
                      <button
                        key={`${preset}-${index}`}
                        type="button"
                        onClick={() => setCount(isAll ? cap : preset)}
                        aria-pressed={selected}
                        className={cn(
                          'numeric min-w-[3rem] rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                          selected
                            ? 'border-accent bg-accent text-white'
                            : 'border-surface-border text-content-secondary hover:border-accent/40',
                        )}
                      >
                        {isAll ? `All ${formatNumber(preset)}` : preset}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-content-muted">
                  Time limit
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {DURATIONS.map((entry) => {
                    const selected = duration === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          durationTouched.current = true;
                          setDuration(entry.id);
                        }}
                        aria-pressed={selected}
                        className={cn(
                          'flex flex-col items-start gap-0.5 rounded-[1rem] border p-3 text-left transition-all',
                          selected
                            ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                            : 'border-surface-border hover:border-accent/40 hover:bg-surface-overlay',
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
                          <IconClock className={cn('h-3.5 w-3.5', selected ? 'text-accent' : 'text-content-muted')} />
                          {entry.label}
                        </span>
                        <span className="text-[0.6875rem] text-content-muted">{entry.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-4 rounded-[1rem] border border-surface-border bg-surface-inset/60 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-content-muted">
                  <IconAlertCircle className="h-3.5 w-3.5" /> Before you start
                </p>
                <ul className="flex flex-col gap-1.5 text-[0.8125rem] text-content-secondary">
                  <li className="flex gap-2">
                    <IconCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                    {formatNumber(effectiveCount)} questions drawn at random from your unlocked bank.
                  </li>
                  <li className="flex gap-2">
                    <IconCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                    {duration === 'untimed'
                      ? 'No clock. Take as long as you need.'
                      : 'The timer counts down and submits automatically at zero.'}
                  </li>
                  <li className="flex gap-2">
                    <IconCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                    No explanations until you submit. The full review unlocks straight after.
                  </li>
                  <li className="flex gap-2">
                    <IconCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                    Answers live in this tab until you submit, so sit it in one go.
                  </li>
                  <li className="flex gap-2">
                    <IconCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                    You can submit early from any question, with a confirmation step.
                  </li>
                </ul>
              </div>
            </section>
          )
        ) : null}
      </div>

      <aside className={cn('min-w-0 flex flex-col gap-3', compact ? '' : 'lg:sticky lg:top-20 lg:self-start')}>
        <div className="panel flex flex-col gap-3 p-4 sm:p-5">
          <p className="eyebrow">Simulator</p>
          {exam ? (
            <div className="flex flex-col gap-1">
              <p className="font-display text-base font-semibold leading-tight">{exam.title}</p>
              <p className="text-xs text-content-muted">{exam.providerTitle}</p>
            </div>
          ) : (
            <p className="text-sm text-content-muted">Pick an exam to configure a mock.</p>
          )}

          <dl className="flex flex-col gap-2 border-t border-surface-border pt-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-content-muted">Questions</dt>
              <dd className="numeric font-semibold">{options ? formatNumber(effectiveCount) : '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-content-muted">Time</dt>
              <dd className="font-semibold">
                {DURATIONS.find((entry) => entry.id === duration)?.label ?? '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-content-muted">Explanations</dt>
              <dd className="font-semibold text-content-muted">After submit</dd>
            </div>
            {best !== null ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-content-muted">
                  <IconTrophy className="h-3.5 w-3.5" /> Best
                </dt>
                <dd className="numeric font-semibold text-positive">{best}%</dd>
              </div>
            ) : null}
          </dl>

          <button type="button" onClick={start} disabled={!canStart} className="btn-primary btn-lg btn-block">
            <IconPlay className="h-4 w-4" />
            Start mock exam
          </button>

          {!user ? (
            <p className="text-[0.6875rem] leading-relaxed text-content-muted">
              You’ll be asked to sign in before the timer starts — mock scores are saved to your account.
            </p>
          ) : null}

          {options && options.entitlement.isLimited ? (
            <p className="rounded-xl border border-caution/30 bg-caution/[0.06] px-3 py-2 text-xs text-content-secondary">
              Mock exams are limited on the free plan. {formatNumber(accessible)} questions unlocked.{' '}
              <Link href="/pricing" className="link font-semibold">
                See plans
              </Link>
            </p>
          ) : null}
        </div>

        {exam ? (
          <div className="panel p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="eyebrow">Attempt history</p>
              <button
                type="button"
                onClick={() => setHistoryKey((key) => key + 1)}
                className="text-[0.6875rem] font-semibold text-content-muted hover:text-content-primary"
              >
                Refresh
              </button>
            </div>

            {!user ? (
              <p className="text-xs text-content-muted">
                <Link href="/login" className="link">
                  Sign in
                </Link>{' '}
                to keep a record of every mock.
              </p>
            ) : historyError ? (
              <p className="text-xs text-negative">{historyError}</p>
            ) : history === null ? (
              <div className="flex flex-col gap-1.5" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 rounded-xl" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-content-muted">No attempts yet. Your first score will appear here.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {history.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="flex items-center gap-3 rounded-xl border border-surface-border px-3 py-2"
                  >
                    <span
                      className={cn(
                        'numeric grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold',
                        (attempt.scorePercent ?? 0) >= 70
                          ? 'bg-positive/15 text-positive'
                          : 'bg-caution/15 text-caution',
                      )}
                    >
                      {attempt.scorePercent ?? 0}%
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">
                        {attempt.answeredCount ?? 0}/{attempt.totalQuestions ?? 0} answered
                      </p>
                      <p className="truncate text-[0.6875rem] text-content-muted">
                        {formatDateTime(attempt.completedAt ?? attempt.createdAt)}
                        {attempt.timeSpentMs ? ` · ${formatDuration(attempt.timeSpentMs)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}