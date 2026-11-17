'use client';

import Link from 'next/link';
import { cn, formatNumber } from '@/lib/format';
import { IconChevronRight } from '@/components/icons';
import type { Exam } from '@/lib/types';

/**
 * One of the three identity gradients, picked stably from the provider id so
 * every recommendation is recognisable at a glance without leaving the brand
 * palette (violet → magenta → cyan).
 */
const TINTS = ['from-accent to-accent-2', 'from-accent-2 to-accent-3', 'from-accent-3 to-accent'] as const;

function providerTint(id: string): (typeof TINTS)[number] {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return TINTS[hash % TINTS.length]!;
}

/**
 * A single recommendation row.
 *
 * Layout notes (these are the reason this is a component and not inline JSX):
 * - The row is a two-line stack on the narrowest phones and only switches to a
 *   side-by-side badge once there is genuinely room, so the provider reason is
 *   never truncated to a few characters.
 * - `min-w-0` is repeated on every flex/grid ancestor of the truncating text.
 *   Without it a flex item keeps `min-width: auto` and the ellipsis can never
 *   engage, which is what pushed the row past the viewport.
 */
export function RecommendationCard({
  rec,
  className,
}: {
  rec: { reason: string; exam: Exam };
  className?: string;
}) {
  const tint = providerTint(rec.exam.providerId);
  const href = `/study?provider=${encodeURIComponent(rec.exam.providerId)}&exam=${encodeURIComponent(
    rec.exam.key,
  )}&mode=practice`;

  return (
    <Link
      href={href}
      className={cn(
        'group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-[1.1rem] border border-surface-border',
        'bg-surface-raised p-3.5 pl-4 transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        className,
      )}
    >
      {/* Provider accent rail: a 3px stripe reads as an affordance without
          consuming layout width. */}
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b', tint)} />

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[0.6875rem] font-bold uppercase tracking-wide text-accent">
            {rec.exam.code}
          </span>
          <span className="badge numeric shrink-0 px-1.5 py-0 text-[0.6875rem] text-content-secondary">
            {formatNumber(rec.exam.questionCount)} Q
          </span>
        </span>

        <span className="line-clamp-2 text-sm font-semibold leading-snug text-content-primary">
          {rec.exam.title}
        </span>

        <span className="truncate text-xs text-content-muted">{rec.exam.providerTitle}</span>

        <span className="mt-0.5 inline-flex min-w-0 items-center gap-1.5 text-[0.6875rem] leading-snug text-content-secondary">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
          <span className="truncate">{rec.reason}</span>
        </span>
      </span>

      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-overlay text-content-muted transition-colors group-hover:bg-accent group-hover:text-white"
      >
        <IconChevronRight width={16} height={16} />
      </span>
    </Link>
  );
}
