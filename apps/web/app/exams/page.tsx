'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated, Provider } from '@/lib/types';
import { ErrorState, PageShell, Skeleton } from '@/components/ui';
import {
  IconArrowRight,
  IconBookmark,
  IconChevronRight,
  IconSearch,
  IconTrophy,
  IconX,
} from '@/components/icons';
import { cn, formatNumber } from '@/lib/format';
import { getRecentExams, pushRecentExam, type RecentExam } from '@/lib/local-store';

type SortKey = 'popular' | 'title' | 'questions';

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'title', label: 'A–Z' },
  { id: 'questions', label: 'Most questions' },
];

const PAGE_SIZE = 12;

function recentToExam(recent: RecentExam): Exam {
  return {
    providerId: recent.providerId,
    providerTitle: recent.providerTitle,
    providerSlug: '',
    key: recent.examKey,
    code: recent.code,
    title: recent.title,
    slug: '',
    questionCount: recent.questionCount,
  };
}

export default function ExamsPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [items, setItems] = useState<Exam[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [recents, setRecents] = useState<RecentExam[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(getRecentExams());
  }, []);

  useEffect(() => {
    let cancelled = false;
    get<{ providers: Provider[] }>('/exams/providers')
      .then((data) => {
        if (!cancelled) {
          setProviders([...data.providers].sort((a, b) => b.examCount - a.examCount));
        }
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      setError('');
      const params = new URLSearchParams({
        sort,
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
      });
      const trimmed = query.trim();
      if (trimmed.length >= 2) params.set('q', trimmed);
      if (provider) params.set('provider', provider);
      try {
        const data = await get<Paginated<Exam>>(`/exams/search?${params.toString()}`);
        setItems((current) => (append && current ? [...current, ...data.items] : data.items));
        setTotal(data.pagination.total);
        setPage(targetPage);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [provider, query, sort],
  );

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setItems(null);
        void fetchPage(1, false);
      },
      query.trim().length >= 2 ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [fetchPage, query]);

  const topProviders = useMemo(() => (providers ?? []).slice(0, 10), [providers]);
  const activeProvider = providers?.find((entry) => entry.providerId === provider) ?? null;
  const hasMore = items !== null && items.length < total;
  const recentList = query.trim().length === 0 && !provider ? recents.slice(0, 6) : [];

  function openExam(exam: Exam) {
    pushRecentExam({
      providerId: exam.providerId,
      examKey: exam.key,
      code: exam.code,
      title: exam.title,
      providerTitle: exam.providerTitle,
      questionCount: exam.questionCount,
    });
  }

  return (
    <PageShell className="py-5 sm:py-8">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border bg-surface-raised p-5 shadow-sm sm:p-7">
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-16 h-64" />
        <div aria-hidden="true" className="orb -right-16 -top-20 h-56 w-56 bg-accent/20" />
        <div className="relative">
          <p className="eyebrow mb-2">Discover</p>
          <h1 className="display-1 text-balance">Find the exam you’re taking</h1>
          <p className="body-text mt-3 max-w-2xl text-base">
            Search by code or name, filter by certification body, and open a dedicated workspace for the exam.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
              <input
                ref={searchRef}
                type="search"
                inputMode="search"
                autoComplete="off"
                aria-label="Search exams"
                placeholder="Search CISA, 200-301, Security+, PMP…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="input h-12 pl-10 pr-10 text-base"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                  aria-label="Clear search"
                >
                  <IconX className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="flex gap-2">
              <label className="sr-only" htmlFor="provider-filter">
                Certification body
              </label>
              <select
                id="provider-filter"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="select h-12 min-w-0 flex-1 sm:w-48 sm:flex-none"
              >
                <option value="">All providers</option>
                {(providers ?? []).map((entry) => (
                  <option key={entry.providerId} value={entry.providerId}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-content-muted">
              Browse
            </span>
            <button
              type="button"
              onClick={() => setProvider('')}
              aria-pressed={provider === ''}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                provider === ''
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-surface-border text-content-secondary hover:border-accent/40',
              )}
            >
              All
            </button>
            {topProviders.map((entry) => (
              <button
                key={entry.providerId}
                type="button"
                onClick={() => setProvider(entry.providerId)}
                aria-pressed={provider === entry.providerId}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                  provider === entry.providerId
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-surface-border text-content-secondary hover:border-accent/40',
                )}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </div>
      </header>

      {recentList.length > 0 ? (
        <section aria-labelledby="recent-heading" className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="recent-heading" className="eyebrow">
              Continue where you left off
            </h2>
            <Link href="/dashboard" className="text-xs font-semibold text-content-muted hover:text-content-primary">
              Progress
            </Link>
          </div>
          <div className="rail -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {recentList.map((recent) => (
              <Link
                key={`${recent.providerId}:${recent.examKey}`}
                href={`/exams/${encodeURIComponent(recent.providerId)}/${encodeURIComponent(recent.examKey)}`}
                onClick={() => openExam(recentToExam(recent))}
                className="group flex w-56 shrink-0 flex-col gap-1 rounded-[1.1rem] border border-surface-border bg-surface-raised p-3 shadow-xs transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
              >
                <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-accent">
                  {recent.code}
                </span>
                <span className="line-clamp-1 text-sm font-semibold">{recent.title}</span>
                <span className="line-clamp-1 text-[0.6875rem] text-content-muted">{recent.providerTitle}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="results-heading" className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="results-heading" className="heading-3">
            {activeProvider ? activeProvider.title : query.trim().length >= 2 ? 'Search results' : 'Exams'}
            <span className="ml-2 text-sm font-medium text-content-muted">
              {items === null ? '' : `${formatNumber(total)} ${total === 1 ? 'exam' : 'exams'}`}
            </span>
          </h2>

          <div className="flex items-center gap-1.5">
            {activeProvider ? (
              <Link
                href={`/exams/${encodeURIComponent(activeProvider.providerId)}`}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Provider page
              </Link>
            ) : null}
            <div className="flex rounded-full border border-surface-border p-0.5">
              {SORTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSort(entry.id)}
                  aria-pressed={sort === entry.id}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors',
                    sort === entry.id
                      ? 'bg-accent text-white'
                      : 'text-content-muted hover:text-content-primary',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <ErrorState title="Could not load exams" description={error} onRetry={() => void fetchPage(1, false)} />
        ) : items === null ? (
          <div className="flex flex-col gap-1.5" aria-busy="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-[4.6rem] rounded-[1rem]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="panel flex flex-col items-center gap-2 p-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-inset text-content-muted">
              <IconSearch className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">No exams matched your filters</p>
            <p className="max-w-sm text-xs text-content-muted">
              Try a shorter search, a different code (for example 200-301 or SY0-701), or clear the provider filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setProvider('');
              }}
              className="btn-secondary btn-sm mt-1"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {items.map((exam) => (
                <li key={`${exam.providerId}:${exam.key}`}>
                  <div className="group flex flex-col gap-2 rounded-[1rem] border border-surface-border bg-surface-raised p-3 shadow-xs transition-all duration-200 hover:border-accent/40 hover:shadow-sm sm:flex-row sm:items-center sm:gap-3">
                    <Link
                      href={`/exams/${encodeURIComponent(exam.providerId)}/${encodeURIComponent(exam.key)}`}
                      onClick={() => openExam(exam)}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span className="grid h-11 w-16 shrink-0 place-items-center rounded-[0.7rem] border border-surface-border bg-surface-inset font-mono text-[0.62rem] font-bold uppercase tracking-wide text-content-secondary">
                        {exam.code.slice(0, 10)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[0.9375rem] font-semibold leading-tight">
                          {exam.title}
                        </span>
                        <span className="block truncate text-xs text-content-muted">
                          {exam.providerTitle} · {formatNumber(exam.questionCount)} questions
                        </span>
                      </span>
                      <IconChevronRight className="hidden h-4 w-4 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 sm:block" />
                    </Link>

                    <div className="flex shrink-0 gap-1.5 pl-[4.75rem] sm:pl-0">
                      <Link
                        href={`/practice?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.key)}`}
                        onClick={() => openExam(exam)}
                        className="btn-secondary btn-sm flex-1 sm:flex-none"
                      >
                        Practice
                      </Link>
                      <Link
                        href={`/mock?provider=${encodeURIComponent(exam.providerId)}&exam=${encodeURIComponent(exam.key)}`}
                        onClick={() => openExam(exam)}
                        className="btn-ghost btn-sm flex-1 sm:flex-none"
                      >
                        <IconTrophy className="h-3.5 w-3.5" />
                        Mock
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-content-muted">
                Showing {formatNumber(items.length)} of {formatNumber(total)}
              </p>
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => void fetchPage(page + 1, true)}
                  className="btn-secondary btn-sm"
                >
                  Load more
                  <IconArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section aria-label="Shortcuts" className="mt-6 grid gap-2 sm:grid-cols-3">
        <Link href="/practice" className="tile tile-interactive flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
            <IconSearch className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Build a practice session</span>
            <span className="block text-xs text-content-muted">Choose focus and length</span>
          </span>
        </Link>
        <Link href="/mock" className="tile tile-interactive flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
            <IconTrophy className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Sit a mock exam</span>
            <span className="block text-xs text-content-muted">Timed and scored</span>
          </span>
        </Link>
        <Link href="/bookmarks" className="tile tile-interactive flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
            <IconBookmark className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Saved questions</span>
            <span className="block text-xs text-content-muted">Pick up your bookmarks</span>
          </span>
        </Link>
      </section>
    </PageShell>
  );
}