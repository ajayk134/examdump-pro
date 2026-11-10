'use client';

import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { formatNumber } from '@/lib/format';

interface Stats {
  providers: number;
  exams: number;
  totalQuestions: number;
}

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
    { label: 'Certification providers', value: stats ? `${stats.providers}+` : '—' },
    { label: 'Exams covered', value: stats ? formatNumber(stats.exams) : '—' },
    { label: 'Practice questions', value: stats ? formatNumber(stats.totalQuestions) : '—' },
    { label: 'Uptime target', value: '99.9%' },
  ];

  return (
    <section className="grid grid-cols-2 gap-4 rounded-2xl border border-surface-border bg-surface-raised/50 p-6 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <p className="text-2xl font-black tracking-tight sm:text-3xl">{item.value}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-content-muted">{item.label}</p>
        </div>
      ))}
    </section>
  );
}