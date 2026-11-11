'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Provider } from '@/lib/types';
import { Alert, EmptyState, Spinner } from '@/components/ui';
import { IconSearch } from '@/components/icons';
import { formatNumber, plural } from '@/lib/format';

export default function ProviderPage() {
  const params = useParams<{ providerId: string }>();
  const providerId = decodeURIComponent(params.providerId);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    get<{ provider: Provider; exams: Exam[] }>(`/exams/${encodeURIComponent(providerId)}`)
      .then((data) => {
        if (cancelled) return;
        setProvider(data.provider);
        setExams(data.exams);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exams;
    return exams.filter((e) => e.code.toLowerCase().includes(q) || e.title.toLowerCase().includes(q));
  }, [exams, query]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!provider) return <Spinner label="Loading provider…" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/browse" className="text-sm text-content-muted hover:text-content-primary">← All providers</Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{provider.title}</h1>
        <p className="text-content-muted">
          {plural(provider.examCount || exams.length, 'exam')}
          {provider.totalQuestions ? ` · ${formatNumber(provider.totalQuestions)} questions` : ''}
        </p>
      </div>

      <div className="relative max-w-md">
        <IconSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          className="input pl-11"
          placeholder="Filter by exam code or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter exams"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No exams found" description="Try a different search term." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((exam) => (
            <div key={exam.key} className="card card-hover flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{exam.code}</h2>
                  <span className="badge">{formatNumber(exam.questionCount)} questions</span>
                </div>
                {exam.title !== exam.code ? <p className="mt-0.5 truncate text-sm text-content-muted">{exam.title}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={`/study?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.key)}&mode=practice`} className="btn-primary !px-3 !py-1.5 text-xs">Practice</Link>
                        <Link href={`/study?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.key)}&mode=mock`} className="btn-ghost !px-3 !py-1.5 text-xs">Mock</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}