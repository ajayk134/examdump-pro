'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/format';
import type { QuestionStatus, PageSize } from '@/lib/question-session';
import { PageSizePicker } from '@/components/question-session-controls';
import { IconArrowRight, IconCheck, IconFlag, IconX } from '../icons';

export interface MapItem {
  id: string;
  /** Absolute zero-based index in the session. */
  index: number;
  label: string;
  status: QuestionStatus;
  current: boolean;
}

type Filter = 'all' | 'unanswered' | 'flagged';

function cellClass(item: MapItem) {
  if (item.current) return 'bg-accent text-[rgb(var(--accent-contrast))] shadow-sm';
  switch (item.status) {
    case 'answered':
      return 'bg-positive/[0.12] text-positive hover:bg-positive/[0.18]';
    case 'flagged':
      return 'bg-caution/[0.12] text-caution hover:bg-caution/[0.18]';
    case 'answered-flagged':
      return 'bg-positive/[0.1] text-positive hover:bg-positive/[0.16]';
    default:
      return 'bg-surface-overlay/60 text-content-muted hover:bg-surface-overlay hover:text-content-secondary';
  }
}

/**
 * Session map used in the desktop rail and the phone sheet.
 *
 * The filter changes which cells are listed but never changes the underlying
 * question order, so a jump always lands on the true session position.
 */
export function QuestionMap({
  items,
  answered,
  flagged,
  pageSize,
  onPageSize,
  onJump,
  onClose,
  variant = 'rail',
}: {
  items: MapItem[];
  answered: number;
  flagged: number;
  pageSize: PageSize;
  onPageSize: (size: PageSize) => void;
  onJump: (index: number) => void;
  onClose?: () => void;
  variant?: 'rail' | 'sheet';
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    if (filter === 'unanswered') return items.filter((item) => item.status === 'flagged' || item.status === 'unanswered');
    if (filter === 'flagged') {
      return items.filter((item) => item.status === 'flagged' || item.status === 'answered-flagged');
    }
    return items;
  }, [items, filter]);

  const left = items.length - answered;
  const firstUnanswered = items.find((item) => item.status === 'unanswered' || item.status === 'flagged');
  const firstFlagged = items.find(
    (item) => item.status === 'flagged' || item.status === 'answered-flagged',
  );

  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: items.length },
    { id: 'unanswered', label: 'Open', count: left },
    { id: 'flagged', label: 'Flagged', count: flagged },
  ];

  return (
    <section
      aria-label="Session map"
      className={cn('flex h-full min-h-0 flex-col', variant === 'sheet' && 'bg-surface-raised')}
    >
      <div className={cn('flex items-start justify-between gap-2', variant === 'sheet' && 'px-4 pt-4')}>
        <div>
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-content-muted">
            Session map
          </p>
          <p className="mt-1 text-[0.9375rem] font-semibold text-content-primary">
            {answered}
            <span className="text-content-muted"> of {items.length} answered</span>
          </p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close session map">
            <IconX />
          </button>
        ) : null}
      </div>

      <div className={cn('mt-3 flex items-center gap-1', variant === 'sheet' && 'px-4')}>
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            aria-pressed={filter === item.id}
            className={cn(
              'inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[0.6875rem] font-bold transition-colors',
              filter === item.id
                ? 'bg-content-primary text-surface-base'
                : 'text-content-muted hover:bg-surface-overlay hover:text-content-secondary',
            )}
          >
            {item.label}
            <span className="numeric opacity-65">{item.count}</span>
          </button>
        ))}
      </div>

      <div
        className={cn(
          'scroll-thin mt-3 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto',
          variant === 'sheet'
            ? 'grid-cols-[repeat(auto-fill,minmax(2.4rem,1fr))] px-4 pb-4'
            : 'grid-cols-[repeat(auto-fill,minmax(2rem,1fr))]',
        )}
      >
        {visible.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-content-muted">
            Nothing matches this filter.
          </p>
        ) : (
          visible.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onJump(item.index)}
              aria-current={item.current ? 'step' : undefined}
              aria-label={`Question ${item.label}, ${item.status.replace('-', ', ')}`}
              className={cn(
                'numeric relative grid aspect-square min-h-8 place-items-center rounded-lg text-[0.6875rem] font-bold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                cellClass(item),
              )}
            >
              {item.label}
              {item.status === 'flagged' || item.status === 'answered-flagged' ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute right-1 top-1 h-1 w-1 rounded-full',
                    item.current ? 'bg-[rgb(var(--accent-contrast))]' : 'bg-caution',
                  )}
                />
              ) : null}
            </button>
          ))
        )}
      </div>

      <div className={cn('mt-3 border-t border-surface-border/70 pt-3', variant === 'sheet' && 'px-4 pb-4')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] text-content-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-accent" /> Current
          </span>
          <span className="inline-flex items-center gap-1">
            <IconCheck width={11} height={11} className="text-positive" /> Answered
          </span>
          <span className="inline-flex items-center gap-1">
            <IconFlag width={11} height={11} className="text-caution" /> Flagged
          </span>
        </div>

        <div
          className={cn(
            'mt-3 flex items-center justify-between gap-2',
            variant === 'rail' && 'flex-col items-stretch gap-1',
          )}
        >
          <span className="text-[0.6875rem] font-semibold text-content-secondary">Per page</span>
          <PageSizePicker
            value={pageSize}
            total={items.length}
            onChange={onPageSize}
            className={variant === 'rail' ? 'w-full justify-between' : undefined}
          />
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => firstUnanswered && onJump(firstUnanswered.index)}
            disabled={!firstUnanswered}
            className="flex min-h-9 items-center justify-between rounded-lg px-2 text-left text-[0.75rem] font-semibold text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary disabled:opacity-45"
          >
            First unanswered
            <IconArrowRight width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => firstFlagged && onJump(firstFlagged.index)}
            disabled={!firstFlagged}
            className="flex min-h-9 items-center justify-between rounded-lg px-2 text-left text-[0.75rem] font-semibold text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary disabled:opacity-45"
          >
            First flagged
            <IconArrowRight width={14} height={14} />
          </button>
        </div>
      </div>
    </section>
  );
}