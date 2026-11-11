'use client';

import Link from 'next/link';
import { cn } from '@/lib/format';
import { IconChevronRight } from '@/components/icons';
import { formatNumber } from '@/lib/format';
import type { Exam } from '@/lib/types';

/** Stable hue per provider so each recommendation is recognisable at a glance. */
function providerHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
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
 * - The badge moved out of the flex row on small screens and sits under the
 *   title instead, so it cannot steal width from the text.
 */
export function RecommendationCard({
  rec,
  className,
}: {
  rec: { reason: string; exam: Exam };
  className?: string;
}) {
  const hue = providerHue(rec.exam.providerId);
  const href = `/study?provider=${encodeURIComponent(rec.exam.providerId)}&exam=${encodeURIComponent(
    rec.exam.key,
  )}&mode=practice`;

  return (
    <Link
      href={href}
      className={cn(
        'group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-surface-border',
        'bg-surface-raised p-3 transition-colors',
        'hover:border-accent/50 hover:bg-surface-overlay',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        className,
      )}
    >
      {/* Provider accent rail: a 3px stripe reads as an affordance without
          consuming layout width. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, hsl(${hue} 82% 58%), hsl(${(hue + 40) % 360} 86% 62%))` }}
      />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-content-primary">{rec.exam.code}</span>
          <span className="badge numeric shrink-0 px-1.5 py-0 text-[11px] text-content-secondary">
            {formatNumber(rec.exam.questionCount)} Q
          </span>
        </span>
        <span className="truncate text-xs text-content-secondary">{rec.exam.title}</span>
        <span className="truncate text-[11px] text-content-muted">
          {rec.exam.providerTitle} · {rec.reason}
        </span>
      </span>

      <IconChevronRight
        width={16}
        height={16}
        className="shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
      />
    </Link>
  );
}
