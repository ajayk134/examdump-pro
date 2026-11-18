'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { PracticeFocus, PracticeOptions } from '@/lib/types';
import { ExamSelect, type SelectedExam } from './exam-select';
import { DownloadQuestionBank } from './download-question-bank';
import {
  IconAlertCircle,
  IconBookmark,
  IconCheckCircle,
  IconLightning,
  IconSparkles,
} from './icons';
import { Alert, Skeleton } from './ui';
import { cn, formatNumber } from '@/lib/format';
import { useAuth } from './providers';

const FOCUS_META: Array<{
  id: PracticeFocus;
  label: string;
  hint: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;
}> = [
  { id: 'all', label: 'Any question', hint: 'Mix everything', icon: IconLightning },
  { id: 'unseen', label: 'Not seen yet', hint: 'Fresh questions', icon: IconSparkles },
  { id: 'missed', label: 'Tricky for you', hint: 'You missed these', icon: IconAlertCircle },
  { id: 'mastered', label: 'Locked in', hint: 'You got these right', icon: IconCheckCircle },
  { id: 'bookmarked', label: 'Bookmarked', hint: 'Saved for later', icon: IconBookmark },
];

const COUNT_PRESETS = [10, 20, 40];

export function PracticeConfig({
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
  const [focus, setFocus] = useState<PracticeFocus>('all');
  const [count, setCount] = useState<number | 'all'>('all');

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
    setFocus('all');
    setCount('all');
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

  const facets = options?.facets;
  const accessible = options?.accessibleQuestions ?? 0;

  /** How many questions the current focus will actually draw. */
  const matching = useMemo(
    () => facets?.focus.find((entry) => entry.id === focus)?.count ?? 0,
    [facets, focus],
  );

  const cap = Math.max(1, matching);

  const countOptions = useMemo(() => {
    const presets = COUNT_PRESETS.filter((preset) => preset < cap);
    return [...presets, cap];
  }, [cap]);

  const effectiveCount = count === 'all' ? cap : Math.min(count, cap);

  function start() {
    if (!exam) return;
    const params = new URLSearchParams({
      provider: exam.providerId,
      exam: exam.examKey,
      mode: 'practice',
      focus,
      count: String(effectiveCount),
    });
    router.push(`/practice/session?${params.toString()}`);
  }

  const canStart = Boolean(exam && options && matching > 0);

  return (
    <div className={cn('grid gap-4', compact ? '' : 'lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6')}>
      <div className="flex min-w-0 flex-col gap-3">
        {/* Step 1 — exam */}
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
          <section aria-labelledby="practice-step-exam" className="panel p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[0.7rem] font-bold text-white">
                1
              </span>
              <h2 id="practice-step-exam" className="heading-3">
                Choose your exam
              </h2>
            </div>
            <ExamSelect value={exam} onChange={setExam} placeholder="Search exams by code or name" />
          </section>
        )}

        {/* Step 2 — focus */}
        {exam ? (
          optionsError ? (
            <Alert tone="error">{optionsError}</Alert>
          ) : !options ? (
            <section className="panel p-4 sm:p-5" aria-busy="true">
              <Skeleton className="mb-3 h-5 w-40" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-[4.2rem] rounded-[1rem]" />
                ))}
              </div>
            </section>
          ) : (
            <section aria-labelledby="practice-step-focus" className="panel p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[0.7rem] font-bold text-white">
                    2
                  </span>
                  <h2 id="practice-step-focus" className="heading-3">
                    Focus your session
                  </h2>
                </div>
                <span className="text-xs font-semibold text-content-muted">
                  {formatNumber(accessible)} unlocked
                </span>
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-content-muted">
                  Difficulty for you
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {FOCUS_META.map((entry) => {
                    const Icon = entry.icon;
                    const entryCount = facets?.focus.find((item) => item.id === entry.id)?.count ?? 0;
                    const disabled = entryCount === 0;
                    const selected = focus === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setFocus(entry.id);
                          setCount('all');
                        }}
                        disabled={disabled}
                        aria-pressed={selected}
                        className={cn(
                          'flex flex-col items-start gap-1 rounded-[1rem] border p-3 text-left transition-all duration-200',
                          selected
                            ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                            : 'border-surface-border hover:border-accent/40 hover:bg-surface-overlay',
                          disabled && 'cursor-not-allowed opacity-45',
                        )}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <Icon className={cn('h-4 w-4', selected ? 'text-accent' : 'text-content-muted')} />
                          <span className="numeric text-[0.68rem] font-bold text-content-muted">
                            {formatNumber(entryCount)}
                          </span>
                        </span>
                        <span className="text-[0.8125rem] font-semibold leading-tight">{entry.label}</span>
                        <span className="text-[0.6875rem] leading-tight text-content-muted">{entry.hint}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[0.6875rem] text-content-muted">
                  Difficulty is based on your own answer history, not a static label.
                </p>
              </fieldset>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-content-muted">
                  Questions
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {countOptions.map((preset, index) => {
                    const isAll = index === countOptions.length - 1;
                    const selected = isAll ? count === 'all' : count === preset;
                    return (
                      <button
                        key={`${preset}-${index}`}
                        type="button"
                        onClick={() => setCount(isAll ? 'all' : preset)}
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
              </div>
            </section>
          )
        ) : null}
      </div>

      {/* Rail / summary */}
      <aside className={cn('min-w-0', compact ? '' : 'lg:sticky lg:top-20 lg:self-start')}>
        <div className="panel flex flex-col gap-3 p-4 sm:p-5">
          <p className="eyebrow">Session</p>
          {exam ? (
            <div className="flex flex-col gap-1">
              <p className="font-display text-base font-semibold leading-tight">{exam.title}</p>
              <p className="text-xs text-content-muted">{exam.providerTitle}</p>
            </div>
          ) : (
            <p className="text-sm text-content-muted">Pick an exam to see what this session will include.</p>
          )}

          <dl className="flex flex-col gap-2 border-t border-surface-border pt-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-content-muted">Questions</dt>
              <dd className="numeric font-semibold">{exam && options ? formatNumber(effectiveCount) : '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-content-muted">Focus</dt>
              <dd className="font-semibold">{FOCUS_META.find((entry) => entry.id === focus)?.label}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-content-muted">Hints</dt>
              <dd className="font-semibold text-positive">On</dd>
            </div>
          </dl>

          <button type="button" onClick={start} disabled={!canStart} className="btn-primary btn-lg btn-block">
            Start practice
          </button>

          {exam && options && !options.entitlement.isLimited ? (
            <DownloadQuestionBank
              providerId={exam.providerId}
              examKey={exam.examKey}
              examCode={exam.code}
              block
            />
          ) : null}

          {exam && options && options.entitlement.isLimited ? (
            <p className="rounded-xl border border-caution/30 bg-caution/[0.06] px-3 py-2 text-xs text-content-secondary">
              Your plan unlocks {formatNumber(accessible)} of {formatNumber(options.totalQuestions)} questions.{' '}
              <Link href="/pricing" className="link font-semibold">
                See plans
              </Link>
            </p>
          ) : null}

          {!user ? (
            <p className="text-[0.6875rem] leading-relaxed text-content-muted">
              Practice works without an account, but answers are only saved to your progress when you{' '}
              <Link href="/login" className="link">
                sign in
              </Link>
              .
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}