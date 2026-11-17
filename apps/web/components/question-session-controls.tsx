'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/format';
import type { QuestionStatus } from '@/lib/question-session';
import { pageSizeChoices, rangeLabel, type PageSize } from '@/lib/question-session';
import { IconArrowLeft, IconArrowRight, IconCheck, IconFlag } from './icons';

/* ------------------------------------------------------------------ */
/* Page size                                                           */
/* ------------------------------------------------------------------ */

/** Segmented "questions per page" control used by both runners. */
export function PageSizePicker({
  value,
  total,
  onChange,
  label = 'Questions per page',
  className,
}: {
  value: PageSize;
  total: number;
  onChange: (size: PageSize) => void;
  label?: string;
  className?: string;
}) {
  const choices = pageSizeChoices(total);
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full border border-surface-border bg-surface-inset/70 p-0.5',
        className,
      )}
    >
      {choices.map((size) => {
        const active = value === size;
        const text = size === 'all' ? 'All' : String(size);
        return (
          <button
            key={text}
            type="button"
            onClick={() => onChange(size)}
            aria-pressed={active}
            title={size === 'all' ? 'Show every question on one page' : `${size} per page`}
            className={cn(
              'min-h-8 rounded-full px-2.5 text-[0.6875rem] font-bold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              active
                ? 'bg-surface-raised text-content-primary shadow-xs'
                : 'text-content-muted hover:text-content-secondary',
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pager                                                               */
/* ------------------------------------------------------------------ */

/**
 * Page navigation that also works as question navigation at one-per-page.
 * Rendered under the question list and inside the mobile session bar.
 */
export function QuestionPager({
  page,
  pages,
  start,
  end,
  total,
  onPage,
  className,
  size = 'default',
}: {
  page: number;
  pages: number;
  start: number;
  end: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
  size?: 'default' | 'compact';
}) {
  const atStart = page <= 0;
  const atEnd = page >= pages - 1;
  const single = pages <= 1;
  const button = size === 'compact' ? 'btn-secondary btn-sm' : 'btn-secondary';

  return (
    <nav
      aria-label="Question navigation"
      className={cn(
        'flex items-center justify-between gap-2 rounded-[1.25rem] border border-surface-border bg-surface-raised/85 p-2 shadow-sm backdrop-blur-md',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={atStart}
        className={cn(button, 'shrink-0')}
        aria-label="Previous questions"
      >
        <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span className={cn(size === 'compact' && 'sr-only')}>Previous</span>
      </button>

      <div className="min-w-0 text-center">
        <p className="numeric truncate text-[0.75rem] font-semibold text-content-primary">
          {rangeLabel(start, end, total)}
        </p>
        <p className="caption truncate text-[0.6875rem]">
          {single ? 'All on one page' : `Page ${page + 1} of ${pages}`}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={atEnd}
        className={cn(button, 'shrink-0')}
        aria-label="Next questions"
      >
        <span className={cn(size === 'compact' && 'sr-only')}>Next</span>
        <IconArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export interface PaletteItem {
  id: string;
  /** Displayed number. */
  label: string;
  status: QuestionStatus;
  current: boolean;
}

/** Cell styling per status; current wins visually but keeps its status dot. */
function paletteClass(item: PaletteItem): string {
  if (item.current) return 'bg-accent text-[rgb(var(--accent-contrast))] shadow-glow-sm ring-2 ring-accent/30';
  switch (item.status) {
    case 'answered':
      return 'border border-positive/45 bg-positive/10 text-positive hover:bg-positive/15';
    case 'flagged':
      return 'border border-caution/55 bg-caution/10 text-caution hover:bg-caution/15';
    case 'answered-flagged':
      return 'border border-caution/55 bg-positive/10 text-positive hover:bg-positive/15';
    default:
      return 'border border-surface-border bg-surface-inset text-content-secondary hover:border-accent/50 hover:text-content-primary';
  }
}

/**
 * Question navigator. Shows every question in the session with its state so a
 * learner can jump instead of paging blindly.
 */
export function QuestionPalette({
  items,
  onJump,
  className,
  columns = 'auto',
}: {
  items: PaletteItem[];
  onJump: (index: number) => void;
  className?: string;
  columns?: 'auto' | 'fixed';
}) {
  const answered = items.filter((item) => item.status === 'answered' || item.status === 'answered-flagged').length;
  const flagged = items.filter((item) => item.status === 'flagged' || item.status === 'answered-flagged').length;
  const left = items.length - answered;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="grid grid-cols-3 gap-2">
        <PaletteStat label="Answered" value={answered} tone="positive" icon={<IconCheck width={13} height={13} />} />
        <PaletteStat label="Flagged" value={flagged} tone="caution" icon={<IconFlag width={13} height={13} />} />
        <PaletteStat label="Left" value={left} tone="muted" />
      </div>

      <div
        className={cn(
          'scroll-thin mt-3 grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto pr-0.5',
          columns === 'auto' ? 'grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))]' : 'grid-cols-7 sm:grid-cols-10',
        )}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onJump(index)}
            aria-current={item.current ? 'true' : undefined}
            aria-label={`Question ${item.label}, ${statusText(item.status)}`}
            className={cn(
              'numeric relative grid aspect-square min-h-10 place-items-center rounded-[0.7rem] text-xs font-bold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              paletteClass(item),
            )}
          >
            {item.label}
            {item.status === 'answered-flagged' || item.status === 'flagged' ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute right-1 top-1 h-1.5 w-1.5 rounded-full',
                  item.current ? 'bg-[rgb(var(--accent-contrast))]' : 'bg-caution',
                )}
              />
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-surface-border pt-2.5 text-[0.6875rem] text-content-muted">
        <Legend swatch="bg-accent" label="Current" />
        <Legend swatch="bg-positive/70" label="Answered" />
        <Legend swatch="bg-caution/70" label="Flagged" />
        <Legend swatch="border border-surface-border bg-surface-inset" label="Unanswered" />
      </div>
    </div>
  );
}

function statusText(status: QuestionStatus): string {
  switch (status) {
    case 'answered':
      return 'answered';
    case 'answered-flagged':
      return 'answered, marked for review';
    case 'flagged':
      return 'marked for review';
    default:
      return 'not answered';
  }
}

function PaletteStat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'positive' | 'caution' | 'muted';
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[0.9rem] border border-surface-border bg-surface-inset/60 px-2 py-1.5 text-center">
      <p
        className={cn(
          'numeric flex items-center justify-center gap-1 text-sm font-bold',
          tone === 'positive' && 'text-positive',
          tone === 'caution' && 'text-caution',
          tone === 'muted' && 'text-content-secondary',
        )}
      >
        {icon}
        {value}
      </p>
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-content-muted">{label}</p>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2.5 w-2.5 rounded-[0.2rem]', swatch)} aria-hidden="true" />
      {label}
    </span>
  );
}