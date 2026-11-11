'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card p-5', className)}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-content-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-content-muted" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
      {icon ? <div className="text-brand-400">{icon}</div> : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="max-w-md text-sm text-content-muted">{description}</p> : null}
      {action}
    </div>
  );
}

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
  const toneClass =
    tone === 'success'
      ? 'text-emerald-500'
      : tone === 'warning'
        ? 'text-amber-500'
        : tone === 'brand'
          ? 'text-brand-400'
          : 'text-content-primary';
  return (
    <div className="card card-hover p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        {icon ? <span className="text-content-muted">{icon}</span> : null}
      </div>
      <p className={cn('mt-2 text-2xl font-bold tracking-tight', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-content-muted">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-overlay', className)} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-600 to-sky-400 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('badge', className)}>{children}</span>;
}

export function PremiumBadge() {
  return <span className="badge-premium">★ Premium</span>;
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
  const styles = {
    info: 'border-brand-400/30 bg-brand-500/10 text-content-secondary',
    error: 'border-rose-400/40 bg-rose-500/10 text-rose-600 dark:text-rose-300',
    success: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warning: 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  }[tone];
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm', styles)} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>{children}</div>
        {action}
      </div>
    </div>
  );
}

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
    return <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-sky-400 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {text}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-surface-border bg-surface-overlay/60 p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === tab.id ? 'bg-brand-500 text-white shadow' : 'text-content-secondary hover:text-content-primary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}