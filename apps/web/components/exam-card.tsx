'use client';

import Link from 'next/link';
import { cn } from '@/lib/format';
import { IconBook, IconBookmark, IconChevronRight, IconPlay } from '@/components/icons';
import { ProgressBar } from '@/components/ui';

export interface ExamCardData {
  providerId: string;
  examKey: string;
  code: string;
  title: string;
  providerTitle: string;
  questionCount: number;
  /** 0–100, present when the learner has started this exam. */
  progress?: number;
  attempted?: number;
  bookmarked?: boolean;
  lastScore?: number | null;
}

/** Stable hue per provider so cards are visually distinguishable at a glance. */
function providerHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * Exam summary card.
 *
 * Information-light by design: code, title, provider, question count and — once
 * started — progress, alongside bookmark and the two ways in (practice, mock).
 * The footer is pushed to the bottom so a grid of unequal titles still lines up.
 */
export function ExamCard({
  exam,
  onBookmark,
  compact,
  className,
}: {
  exam: ExamCardData;
  onBookmark?: (exam: ExamCardData) => void;
  compact?: boolean;
  className?: string;
}) {
  const hue = providerHue(exam.providerId);
  const started = typeof exam.progress === 'number' && exam.progress > 0;
  const href = `/exams/${exam.providerId}/${encodeURIComponent(exam.examKey)}`;

  return (
    <article
      className={cn(
        'surface surface-interactive group relative flex flex-col overflow-hidden',
        'focus-within:border-accent/60',
        compact ? 'p-3.5' : 'p-4',
        className,
      )}
    >
      {/* Provider accent strip */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, hsl(${hue} 82% 58%), hsl(${(hue + 40) % 360} 86% 62%))` }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="badge badge-accent font-mono text-[0.6875rem] uppercase tracking-wide">{exam.code}</span>
            {exam.lastScore != null ? (
              <span className={cn('badge', exam.lastScore >= 80 ? 'badge-success' : 'badge-warning')}>
                {Math.round(exam.lastScore)}%
              </span>
            ) : null}
          </div>
          <h3 className="mt-1.5 line-clamp-2 text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em]">
            {exam.title}
          </h3>
          <p className="mt-1 truncate text-xs text-content-muted">{exam.providerTitle}</p>
        </div>

        {onBookmark ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onBookmark(exam);
            }}
            aria-label={exam.bookmarked ? 'Remove bookmark' : 'Bookmark this exam'}
            aria-pressed={Boolean(exam.bookmarked)}
            className={cn(
              'icon-btn -mr-1.5 -mt-1.5 shrink-0',
              exam.bookmarked ? 'text-accent' : 'text-content-muted',
            )}
          >
            <IconBookmark className={exam.bookmarked ? 'fill-current' : undefined} />
          </button>
        ) : null}
      </div>

      {started ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[0.6875rem] font-medium text-content-muted">
            <span>{exam.attempted ?? 0} answered</span>
            <span className="numeric">{Math.round(exam.progress ?? 0)}%</span>
          </div>
          <ProgressBar value={exam.progress ?? 0} label={`${exam.code} progress`} />
        </div>
      ) : null}

      {/* Grows so the action row sits at the bottom of a stretched card. */}
      <div aria-hidden="true" className="min-h-3.5 flex-1" />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-surface-border pt-3.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-content-muted">
          <IconBook className="h-3.5 w-3.5 shrink-0" />
          {exam.questionCount.toLocaleString()} questions
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href={`/mock?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.examKey)}`}
            className="btn-secondary btn-sm"
            aria-label={`Start a mock test for ${exam.code}`}
          >
            <IconPlay className="h-3.5 w-3.5" />
            Mock
          </Link>
          <Link href={href} className="btn-primary btn-sm" aria-label={`Open ${exam.code}`}>
            {started ? 'Resume' : 'Start'}
            <IconChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function ExamCardSkeleton() {
  return (
    <div className="surface flex flex-col p-4" aria-hidden="true">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="skeleton mb-2 h-4 w-16 rounded-full" />
          <div className="skeleton mb-2 h-4 w-4/5" />
          <div className="skeleton h-3 w-2/5" />
        </div>
        <div className="skeleton h-8 w-8 rounded-xl" />
      </div>
      <div className="min-h-3.5 flex-1" />
      <div className="flex items-center justify-between gap-3 border-t border-surface-border pt-3.5">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-28 rounded-lg" />
      </div>
    </div>
  );
}
