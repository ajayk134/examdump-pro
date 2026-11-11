'use client';

import Link from 'next/link';
import { cn } from '@/lib/format';
import { IconBookmark, IconChevronRight, IconPlay, IconSparkles } from '@/components/icons';
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
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="badge badge-accent font-mono text-[0.6875rem] uppercase tracking-wide">{exam.code}</span>
            {exam.lastScore != null ? (
              <span className={cn('badge', exam.lastScore >= 80 ? 'badge-success' : 'badge-warning')}>
                {Math.round(exam.lastScore)}%
              </span>
            ) : null}
          </div>
          <h3 className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em]">
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
              'icon-btn -mr-1 -mt-1 shrink-0',
              exam.bookmarked ? 'text-accent' : 'text-content-muted',
            )}
          >
            <IconBookmark className={exam.bookmarked ? 'fill-current' : undefined} />
          </button>
        ) : null}
      </div>

      {started ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[0.6875rem] font-medium text-content-muted">
            <span>{exam.attempted ?? 0} answered</span>
            <span className="numeric">{Math.round(exam.progress ?? 0)}%</span>
          </div>
          <ProgressBar value={exam.progress ?? 0} />
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 pt-0.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-content-muted">
          <IconSparkles className="h-3.5 w-3.5" />
          {exam.questionCount.toLocaleString()} questions
        </span>

        <div className="flex items-center gap-1.5">
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
    <div className="surface p-4" aria-hidden="true">
      <div className="skeleton mb-2 h-4 w-16" />
      <div className="skeleton mb-2 h-4 w-4/5" />
      <div className="skeleton mb-4 h-3 w-2/5" />
      <div className="flex justify-between">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-7 w-24" />
      </div>
    </div>
  );
}
