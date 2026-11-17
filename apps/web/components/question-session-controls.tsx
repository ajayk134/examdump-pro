'use client';

import { cn } from '@/lib/format';
import { pageSizeChoices, type PageSize } from '@/lib/question-session';

/**
 * Segmented "questions per page" control.
 *
 * It lives in the session map on every breakpoint, so the reader can change the
 * worksheet density without leaving the question they are on. Only sizes the
 * paper can fill are offered; `pageSizeChoices` folds the rest into `All`.
 */
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
            data-page-size={size}
            onClick={() => onChange(size)}
            aria-pressed={active}
            title={size === 'all' ? 'Show every question on one page' : `${size} per page`}
            className={cn(
              'min-h-8 shrink-0 rounded-full px-2 text-[0.6875rem] font-bold transition-colors sm:px-2.5',
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
      <span className="sr-only" aria-live="polite">
        {value === 'all'
          ? `Showing all ${total} questions on one page`
          : `Showing ${Math.min(value, total)} questions per page`}
      </span>
    </div>
  );
}