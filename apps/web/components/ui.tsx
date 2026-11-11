'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/format';

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('surface p-4 sm:p-5', className)}>{children}</div>;
}

/** Page shell: consistent gutters and vertical rhythm on every route. */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-7xl', className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="heading-1 truncate-0 text-balance">{title}</h1>
        {description ? <p className="body-text mt-1.5 max-w-2xl text-pretty">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
  as: Tag = 'h2',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div className="mb-3.5 flex items-end justify-between gap-3 sm:mb-4">
      <div className="min-w-0">
        <Tag className="heading-2">{title}</Tag>
        {subtitle ? <p className="caption mt-1">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('divider my-4', className)} role="separator" />;
}

/* ------------------------------------------------------------------ */
/* Feedback states                                                     */
/* ------------------------------------------------------------------ */

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn('flex items-center justify-center gap-3 py-10 text-content-muted', className)}
      role="status"
      aria-live="polite"
    >
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
        aria-hidden="true"
      />
      <span className="text-sm font-medium">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden="true" />;
}

/** Card-shaped skeleton used while list pages load. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('surface p-4', className)} aria-hidden="true">
      <Skeleton className="mb-3 h-5 w-2/5" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('mb-2 h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('surface flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? (
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="heading-2">{title}</h3>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-content-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  className,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('surface flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}
      role="alert"
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-negative/10 text-negative" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5M12 16.2v.1" />
        </svg>
      </div>
      <h3 className="heading-2">{title}</h3>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-content-muted">{description}</p> : null}
      {onRetry ? (
        <button type="button" className="btn-secondary btn-sm mt-1" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const toneClass = {
    info: 'border-brand-400/35 bg-brand-500/[0.08]',
    error: 'border-negative/40 bg-negative/[0.08] text-negative',
    success: 'border-positive/40 bg-positive/[0.08] text-positive',
    warning: 'border-caution/40 bg-caution/[0.1] text-caution',
  }[tone];

  return (
    <div
      className={cn('rounded-xl border px-3.5 py-3 text-sm', toneClass)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">{children}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'brand';
}) {
  const toneClass = {
    default: 'text-content-primary',
    success: 'text-positive',
    warning: 'text-caution',
    brand: 'text-accent',
  }[tone];

  return (
    <div className="surface surface-interactive p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-content-muted">{label}</p>
        {icon ? (
          <span className="text-content-muted" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p className={cn('numeric mt-1.5 text-[1.6rem] font-bold leading-none tracking-tight sm:text-2xl', toneClass)}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs leading-snug text-content-muted">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  className,
  tone = 'accent',
  label,
}: {
  value: number;
  className?: string;
  tone?: 'accent' | 'success' | 'warning';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fill = {
    accent: 'bg-gradient-to-r from-brand-600 to-sky-400',
    success: 'bg-positive',
    warning: 'bg-caution',
  }[tone];

  return (
    <div
      className={cn('progress-track h-1.5', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-smooth', fill)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Circular progress ring used for scores and exam completion. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  children,
  tone = 'accent',
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  tone?: 'accent' | 'success' | 'warning';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = { accent: 'rgb(var(--accent))', success: 'rgb(var(--success))', warning: 'rgb(var(--warning))' }[tone];

  return (
    <div
      className="relative inline-grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${Math.round(clamped)}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--surface-inset))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-smooth"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </div>
  );
}

export function Badge({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'badge',
    accent: 'badge badge-accent',
    success: 'badge badge-success',
    warning: 'badge badge-warning',
    danger: 'badge badge-danger',
  }[tone];
  return <span className={cn(toneClass, className)}>{children}</span>;
}

export function PremiumBadge() {
  return <span className="badge badge-accent">★ Premium</span>;
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function LinkButton({
  href,
  children,
  variant = 'primary',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  const cls = variant === 'primary' ? 'btn-primary' : variant === 'secondary' ? 'btn-secondary' : 'btn-ghost';
  return (
    <Link href={href} className={cn(cls, className)}>
      {children}
    </Link>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const text = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-sky-400 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

/** Segmented control. Scrolls horizontally on narrow screens instead of wrapping ugly. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = 'md',
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn('no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-surface-border bg-surface-overlay p-1', className)}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'shrink-0 rounded-lg font-semibold transition-all duration-150',
            /*
             * The small sizes are right for a pointer, but on a touch screen
             * these tabs were only 32px tall and awkward to hit. Grow the
             * vertical padding only for coarse pointers so the desktop
             * density is unchanged.
             */
            size === 'sm'
              ? 'px-2.5 py-1 text-xs max-sm:py-2'
              : 'px-3 py-1.5 text-[0.8125rem] max-sm:py-2',
            value === tab.id
              ? 'bg-surface-raised text-content-primary shadow-sm'
              : 'text-content-muted hover:text-content-secondary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Filter pill row, horizontally scrollable on touch devices. */
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5', className)}>{children}</div>;
}

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('chip shrink-0', active && 'chip-active', className)}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer / modal sheet                                                */
/* ------------------------------------------------------------------ */

/**
 * Accessible overlay panel used for the AI tutor and mobile menus.
 *
 * - Traps focus inside the panel while open
 * - Closes on Escape and backdrop click
 * - Locks background scroll
 * - Bottom sheet on phones, right-hand panel from `sm` up
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: 'right' | 'bottom';
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /**
   * Height of the area the user can actually see.
   *
   * `dvh` units are unreliable here: on pages taller than the screen the
   * dynamic viewport reports the document height rather than the visible
   * height, which made the sheet taller than the screen and pushed it above
   * y=0. The visual viewport is the only value that stays correct while the
   * on-screen keyboard is open, so it is measured directly and applied as an
   * inline height.
   */
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const vv = window.visualViewport;
      const visible = vv ? vv.height : window.innerHeight;
      // Ignore implausible values (some embedded browsers report 0 mid-resize).
      if (visible > 120) setViewportHeight(visible);
    };
    sync();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Lock the document, not just <body>: `overflow:hidden` on body alone
    // leaves <html> scrollable, so the page behind the sheet still moved.
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    const raf = requestAnimationFrame(() => focusables()[0]?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.overscrollBehavior = originalOverscroll;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120]" role="presentation">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={
          side === 'bottom'
            ? viewportHeight
              ? // A definite height is what lets the flex children below
                // compute their own heights; with `max-height` alone the
                // transcript falls back to content height and pushes the
                // composer past the bottom of the screen.
                { height: `${Math.round(viewportHeight)}px`, maxHeight: `${Math.round(viewportHeight)}px` }
              : undefined
            : undefined
        }
        className={cn(
          'absolute flex flex-col overflow-hidden border-surface-border bg-surface-raised shadow-2xl',
          side === 'right'
            ? 'inset-y-0 right-0 w-full animate-slide-in border-l sm:max-w-lg'
            : 'inset-x-0 bottom-0 animate-sheet rounded-t-2xl border-t',
          className,
        )}
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {side === 'bottom' ? (
          <div
            aria-hidden="true"
            className="flex shrink-0 justify-center pt-2 pb-1"
          >
            <span className="h-1 w-9 rounded-full bg-surface-border-strong" />
          </div>
        ) : null}
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={
            side === 'bottom'
              ? { paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty-state icon set (kept local so pages stay terse)               */
/* ------------------------------------------------------------------ */

export function EmptyIcon({ name }: { name: 'search' | 'book' | 'spark' | 'chart' | 'inbox' }) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
        <path d="M4 5.5v16" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <circle cx="12" cy="12" r="3.2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 13h4l1.5 3h5L16 13h4" />
        <path d="M4 13 6.5 5h11L20 13v6H4z" />
      </>
    ),
  };

  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Compact sort selector that stays usable on a phone. */
export function SegmentedSort({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div
      className="no-scrollbar flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-surface-border bg-surface-overlay p-0.5"
      role="group"
      aria-label="Sort by"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          aria-pressed={value === opt.id}
          className={cn(
            'inline-flex min-h-9 shrink-0 items-center rounded-[0.4rem] px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors',
            value === opt.id
              ? 'bg-surface-raised text-content-primary shadow-sm'
              : 'text-content-muted hover:text-content-secondary',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
