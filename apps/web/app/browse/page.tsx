'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated, Provider } from '@/lib/types';
import { Alert, EmptyState, Spinner } from '@/components/ui';
import { IconSearch, IconBook } from '@/components/icons';
import { formatNumber, plural } from '@/lib/format';

export default function BrowsePage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [examQuery, setExamQuery] = useState('');
  const [examResults, setExamResults] = useState<Exam[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    get<{ providers: Provider[] }>('/exams/providers')
      .then((data) => {
        if (!cancelled) setProviders(data.providers);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = examQuery.trim();
    if (q.length < 2) {
      setExamResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      get<Paginated<Exam>>(`/exams/search?q=${encodeURIComponent(q)}&pageSize=30`)
        .then((data) => setExamResults(data.items))
        .catch(() => setExamResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [examQuery]);

  const filteredProviders = useMemo(() => {
    if (!providers) return [];
    const q = providerFilter.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter((p) => p.title.toLowerCase().includes(q) || p.providerId.includes(q));
  }, [providers, providerFilter]);

  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Browse exams</h1>
        <p className="text-content-muted">Search by exam code or title, or explore a certification provider.</p>
      </header>

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          type="search"
          className="input py-3 pl-11 text-base"
          placeholder="Search 1,800+ exams — e.g. 200-301, Security+, AWS Solutions Architect…"
          value={examQuery}
          onChange={(e) => setExamQuery(e.target.value)}
          aria-label="Search exams"
        />
      </div>

      {examQuery.trim().length >= 2 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Exam results</h2>
            {searching ? <span className="text-sm text-content-muted">Searching…</span> : null}
          </div>
          {examResults === null ? (
            <Spinner label="Searching exams…" />
          ) : examResults.length === 0 ? (
            <EmptyState title="No exams matched" description="Try a different code, title or provider." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {examResults.map((exam) => (
                <ExamResultCard key={`${exam.providerId}-${exam.key}`} exam={exam} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Providers</h2>
          <input
            className="input max-w-xs"
            placeholder="Filter providers…"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label="Filter providers"
          />
        </div>

        {!providers ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="card p-5"><div className="skeleton h-5 w-2/3" /><div className="skeleton mt-3 h-4 w-1/3" /></div>
            ))}
          </div>
        ) : filteredProviders.length === 0 ? (
          <EmptyState title="No providers found" description="Try a broader search term." icon={<IconBook />} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProviders.map((provider) => (
              <Link key={provider.providerId} href={`/providers/${encodeURIComponent(provider.providerId)}`} className="card card-hover flex flex-col gap-2 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{provider.title}</h3>
                  <span className="badge shrink-0">{provider.examCount || '—'}</span>
                </div>
                <p className="text-sm text-content-muted">
                  {provider.examCount ? plural(provider.examCount, 'exam') : 'Exams loading'}
                  {provider.totalQuestions ? ` · ${formatNumber(provider.totalQuestions)} questions` : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ExamResultCard({ exam }: { exam: Exam }) {
  return (
    <div className="card card-hover flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-500 dark:text-brand-300">{exam.providerTitle}</p>
          <h3 className="mt-0.5 font-semibold leading-snug">{exam.code}</h3>
          {exam.title !== exam.code ? <p className="text-sm text-content-muted">{exam.title}</p> : null}
        </div>
        <span className="badge shrink-0">{formatNumber(exam.questionCount)} Q</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        <Link href={`/study?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.key)}&mode=practice`} className="btn-primary !px-3 !py-1.5 text-xs">Practice</Link>
        <Link href={`/study?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.key)}&mode=mock`} className="btn-ghost !px-3 !py-1.5 text-xs">Mock</Link>
      </div>
    </div>
  );
}