'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated, Provider } from '@/lib/types';
import { ExamCard, ExamCardSkeleton, type ExamCardData } from '@/components/exam-card';
import {
  Chip,
  ChipRow,
  EmptyState,
  EmptyIcon,
  ErrorState,
  PageHeader,
  SegmentedSort,
  Skeleton,
} from '@/components/ui';
import { IconBookmark, IconChevronRight, IconClock, IconSearch, IconSparkles, IconX } from '@/components/icons';
import { cn } from '@/lib/format';
import { useAuth } from '@/components/providers';
import { getRecents, toggleExamBookmark } from '@/lib/local-store';

type SortKey = 'popular' | 'title' | 'questions' | 'newest';

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'title', label: 'A–Z' },
  { id: 'questions', label: 'Most questions' },
  { id: 'newest', label: 'Newest' },
];

const PAGE_SIZE = 24;

export default function ExamsPage() {
  const { user } = useAuth();

  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerError, setProviderError] = useState('');

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [provider, setProvider] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('popular');

  const [results, setResults] = useState<Exam[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  // Local state that does not need the server.
  useEffect(() => {
    setBookmarks(toggleExamBookmark());
    setRecents(getRecents());
  }, []);

  // Debounce the search box so typing feels instant but does not hammer the API.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const loadProviders = useCallback(() => {
    setProviderError('');
    get<{ providers: Provider[] }>('/exams/providers')
      .then((data) => setProviders(data.providers))
      .catch((err) => setProviderError((err as Error).message));
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // Fetch exam list whenever filters change.
  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setListError('');

    const params = new URLSearchParams({ sort, page: String(page), pageSize: String(PAGE_SIZE) });
    if (debounced) params.set('q', debounced);
    if (provider) params.set('provider', provider);

    get<Paginated<Exam>>(`/exams/search?${params.toString()}`, controller.signal)
      .then((data) => {
        setResults((prev) => (page === 1 ? data.items : [...(prev ?? []), ...data.items]));
        setTotal(data.pagination.total);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setListError((err as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debounced, provider, sort, page]);

  // Reset to page 1 whenever the query changes.
  useEffect(() => {
    setPage(1);
  }, [debounced, provider, sort]);

  const toCard = useCallback(
    (exam: Exam): ExamCardData => ({
      providerId: exam.providerId,
      examKey: exam.key,
      code: exam.code,
      title: exam.title,
      providerTitle: exam.providerTitle,
      questionCount: exam.questionCount,
      bookmarked: bookmarks.includes(exam.providerId + ':' + exam.key),
    }),
    [bookmarks],
  );

  function onToggleBookmark(exam: ExamCardData) {
    const id = `${exam.providerId}:${exam.examKey}`;
    toggleExamBookmark.toggle(id);
    setBookmarks(toggleExamBookmark());
  }

  const recentExams = useMemo(() => {
    if (!results) return [];
    const keys = new Set(recents);
    return results.filter((e) => keys.has(`${e.providerId}:${e.key}`)).slice(0, 4);
  }, [results, recents]);

  const hasFilters = Boolean(debounced || provider);
  const showRail = !hasFilters && results && results.length > 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Discover"
        title="Find your certification"
        description="Search 160+ providers, filter by body, and pick up exactly where you left off."
        actions={
          <Link href="/bookmarks" className="btn-secondary btn-sm">
            <IconBookmark className="h-4 w-4" />
            Saved
          </Link>
        }
      />

      {/* Search — sticky on mobile so it stays reachable while scrolling */}
      <div className="sticky top-14 z-30 -mx-3.5 border-b border-surface-border/60 bg-surface-base/90 px-3.5 py-2.5 backdrop-blur-lg sm:top-16 sm:mx-0 sm:rounded-xl sm:border sm:px-3 lg:static lg:bg-transparent lg:backdrop-blur-none">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label="Search exams"
            placeholder="Search exams, codes or topics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input pl-10 pr-10"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-content-muted hover:bg-surface-overlay hover:text-content-primary"
            >
              <IconX className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Provider filter row */}
      <section aria-label="Filter by provider" className="-mt-1">
        <ChipRow>
          <Chip active={provider === ''} onClick={() => setProvider('')}>
            All providers
          </Chip>
          {!providers
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-28 shrink-0 rounded-full" />)
            : providers.map((p) => (
                <Chip
                  key={p.providerId}
                  active={provider === p.providerId}
                  onClick={() => setProvider(provider === p.providerId ? '' : p.providerId)}
                >
                  {p.title}
                  <span className="ml-0.5 text-[0.6875rem] opacity-60">{p.examCount || ''}</span>
                </Chip>
              ))}
        </ChipRow>
      </section>

      {/* Recently visited */}
      {showRail && recents.length > 0 && recentExams.length > 0 ? (
        <section aria-labelledby="recent-heading">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 id="recent-heading" className="heading-3 inline-flex items-center gap-1.5">
              <IconClock className="h-4 w-4 text-content-muted" />
              Continue where you left off
            </h2>
            <Link href="/history" className="text-xs font-semibold text-accent">
              History
            </Link>
          </div>
          <div className="snap-rail no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            {recentExams.map((exam) => (
              <div key={`${exam.providerId}:${exam.key}`} className="w-[17rem] max-w-[80vw]">
                <ExamCard exam={toCard(exam)} onBookmark={onToggleBookmark} compact />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Sort + count */}
      <section aria-label="Sort results" className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-content-muted">
          {loading && !results ? 'Searching…' : `${total.toLocaleString()} exam${total === 1 ? '' : 's'}`}
          {debounced ? <span className="text-content-secondary"> matching “{debounced}”</span> : null}
        </p>
        <SegmentedSort value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS} />
      </section>

      {/* Results */}
      {listError ? (
        <ErrorState
          title="Could not load exams"
          description={listError}
          onRetry={() => {
            setPage(1);
            setListError('');
            setSort((s) => s);
          }}
        />
      ) : !results && loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ExamCardSkeleton key={i} />
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="search" />}
          title="No exams matched"
          description={
            hasFilters
              ? 'Try a shorter query or a different provider. Codes such as “200-301” or “SY0-701” work well.'
              : 'No exams are indexed yet. Once the dataset syncs they will appear here.'
          }
          action={
            hasFilters ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setQuery('');
                  setProvider('');
                }}
              >
                Clear filters
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results?.map((exam) => (
              <ExamCard key={`${exam.providerId}:${exam.key}`} exam={toCard(exam)} onBookmark={onToggleBookmark} />
            ))}
          </div>

          {results && results.length < total ? (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading}
              >
                {loading ? 'Loading…' : `Load more (${total - results.length} left)`}
              </button>
            </div>
          ) : null}
        </>
      )}

      {/* Provider directory fallback when no search has been made */}
      {!hasFilters && providers && providers.length > 0 ? (
        <section aria-labelledby="providers-heading" className="mt-2">
          <h2 id="providers-heading" className="heading-2 mb-3">
            Browse by provider
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {providers.slice(0, 16).map((p) => (
              <Link
                key={p.providerId}
                href={`/exams/${p.providerId}`}
                className="surface surface-interactive flex items-center justify-between gap-2 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-semibold">{p.title}</p>
                  <p className="text-[0.6875rem] text-content-muted">{p.examCount || 0} exams</p>
                </div>
                <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {providerError ? (
        <ErrorState title="Providers unavailable" description={providerError} onRetry={loadProviders} />
      ) : null}
    </div>
  );
}
