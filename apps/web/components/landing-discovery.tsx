'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated, Provider } from '@/lib/types';
import { IconArrowRight, IconChevronRight, IconSearch } from '@/components/icons';
import { formatNumber } from '@/lib/format';

/** Stable hue per provider so the strip is recognisable at a glance. */
function providerHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * Public discovery preview.
 *
 * Providers and exams are read from the live catalogue — nothing here is
 * authored sample data. While the request is in flight the layout holds its
 * shape with skeletons so the page never reflows on load.
 */
export function LandingDiscovery() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ providers: Provider[] }>('/exams/providers')
      .then((data) => {
        if (!cancelled) setProviders(data.providers);
      })
      .catch(() => setProviders([]));
    get<Paginated<Exam>>('/exams/search?sort=popular&pageSize=6')
      .then((data) => {
        if (!cancelled) setExams(data.items);
      })
      .catch(() => setExams([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-10">
      {/* Provider strip */}
      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h3 className="heading-3 text-content-secondary">Certification providers</h3>
          <Link href="/exams" className="inline-flex items-center gap-1 text-xs font-semibold text-accent touch:min-h-11">
            All providers
            <IconChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="snap-rail no-scrollbar -mx-1 px-1">
          {providers === null
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton h-[4.25rem] w-40 shrink-0 rounded-2xl" />
              ))
            : providers.slice(0, 14).map((p) => {
                const hue = providerHue(p.providerId);
                return (
                  <Link
                    key={p.providerId}
                    href={`/exams/${encodeURIComponent(p.providerId)}`}
                    className="group flex w-40 shrink-0 flex-col justify-between rounded-2xl border border-surface-border bg-surface-raised p-3 transition-colors hover:border-accent/40 hover:bg-surface-overlay"
                  >
                    <span
                      aria-hidden="true"
                      className="mb-2 h-1.5 w-8 rounded-full"
                      style={{ background: `hsl(${hue} 82% 58%)` }}
                    />
                    <span className="line-clamp-2 text-[0.8125rem] font-semibold leading-snug">{p.title}</span>
                    <span className="mt-1 text-[0.6875rem] text-content-muted">
                      {formatNumber(p.examCount)} exams
                    </span>
                  </Link>
                );
              })}
        </div>
      </div>

      {/* Popular exams */}
      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h3 className="heading-3 text-content-secondary">Popular right now</h3>
          <Link href="/exams" className="inline-flex items-center gap-1 text-xs font-semibold text-accent touch:min-h-11">
            Browse all
            <IconChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {exams === null
            ? Array.from({ length: 6 }).map((_, i) => <li key={i} className="skeleton h-[4.5rem] rounded-2xl" />)
            : exams.map((exam) => {
                const hue = providerHue(exam.providerId);
                return (
                  <li key={`${exam.providerId}:${exam.key}`}>
                    <Link
                      href={`/exams/${encodeURIComponent(exam.providerId)}/${encodeURIComponent(exam.key)}`}
                      className="group relative flex h-full items-center gap-3 overflow-hidden rounded-2xl border border-surface-border bg-surface-raised p-3.5 transition-colors hover:border-accent/40 hover:bg-surface-overlay"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-3 left-0 w-[3px] rounded-full"
                        style={{ background: `hsl(${hue} 82% 58%)` }}
                      />
                      <div className="min-w-0 flex-1 pl-1">
                        <p className="truncate font-mono text-[0.6875rem] font-bold uppercase tracking-wide text-accent">
                          {exam.code}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-sm font-semibold leading-snug">{exam.title}</p>
                        <p className="mt-0.5 truncate text-[0.6875rem] text-content-muted">
                          {exam.providerTitle} · {formatNumber(exam.questionCount)} questions
                        </p>
                      </div>
                      <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </Link>
                  </li>
                );
              })}
          {exams && exams.length === 0 ? (
            <li className="col-span-full flex items-center gap-3 rounded-2xl border border-dashed border-surface-border-strong p-4 text-sm text-content-muted">
              <IconSearch className="h-5 w-5 shrink-0" />
              The catalogue is syncing. Browse all exams to see what is available.
              <Link href="/exams" className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-accent">
                Browse
                <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
