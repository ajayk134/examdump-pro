'use client';

import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { formatNumber } from '@/lib/format';

interface Stats {
  providers: number;
  exams: number;
  totalQuestions: number;
}

/**
 * Live catalogue counters.
 *
 * Every number comes from `/health/stats`; the placeholders render as em dashes
 * until the request resolves so nothing is invented on screen.
 */
export function LandingStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<Stats>('/health/stats')
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const items = [
    { label: 'Certification providers', value: stats ? formatNumber(stats.providers) : '—' },
    { label: 'Exams covered', value: stats ? formatNumber(stats.exams) : '—' },
    { label: 'Practice questions', value: stats ? formatNumber(stats.totalQuestions) : '—' },
  ];

  return (
    <section aria-label="Catalogue size" className="border-t border-surface-border pt-6">
      <dl className="grid grid-cols-3 divide-x divide-surface-border">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 px-3 first:pl-0 last:pr-0 sm:px-6">
            <dd className="numeric text-2xl font-bold leading-none tracking-[-0.02em] sm:text-4xl">{item.value}</dd>
            <dt className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-content-muted sm:text-xs">
              {item.label}
            </dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
