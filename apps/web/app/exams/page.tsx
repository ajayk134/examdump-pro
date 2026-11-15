'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated, Provider } from '@/lib/types';
import { ExamCard, ExamCardSkeleton, type ExamCardData } from '@/components/exam-card';
import {
  Chip,
  ChipRow,
  Drawer,
  EmptyState,
  EmptyIcon,
  ErrorState,
  PageHeader,
  SegmentedSort,
  Skeleton,
} from '@/components/ui';
import {
  IconBookmark,
  IconChevronRight,
  IconClock,
  IconFilter,
  IconSearch,
  IconX,
} from '@/components/icons';
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

/** Stable hue per provider so directory tiles are recognisable at a glance. */
function providerHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

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
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  function selectProvider(id: string) {
    setProvider((current) => (current === id ? '' : id));
  }

  const recentExams = useMemo(() => {
    if (!results) return [];
    const keys = new Set(recents);
    return results.filter((e) => keys.has(`${e.providerId}:${e.key}`)).slice(0, 4);
  }, [results, recents]);

  const hasFilters = Boolean(debounced || provider);
  const showRail = !hasFilters && results && results.length > 0;
  const activeProvider = provider ? providers?.find((p) => p.providerId === provider) : undefined;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Find your certification"
        description="Search every provider, filter by exam body, and pick up exactly where you left off."
        actions={
          <Link href="/bookmarks" className="btn-secondary btn-sm">
            <IconBookmark className="h-4 w-4" />
            Saved
          </Link>
        }
      />

      {/* Search — sticky on mobile so it stays reachable while scrolling */}
      <div className="sticky top-14 z-30 -mx-3.5 border-b border-surface-border/60 bg-surface-base/90 px-3.5 py-2.5 backdrop-blur-lg sm:top-16 sm:mx-0 sm:rounded-2xl sm:border sm:border-surface-border sm:px-3 lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Search exams"
              placeholder="Search exams, codes or topics..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-10 pr-12"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
              >
                <IconX className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* Provider filter is inline on wide screens; on phones it opens a sheet. */}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-haspopup="dialog"
            className={cn('btn-secondary shrink-0 lg:hidden', provider && 'border-accent/50 text-accent')}
          >
            <IconFilter className="h-4 w-4" />
            <span className="hidden sm:inline">Filters</span>
            {provider ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.6875rem] font-bold text-white">
                1
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Active provider on phones, where the rail is tucked into the sheet */}
      {provider ? (
        <div className="-mt-2 flex items-center gap-2 lg:hidden">
          <span className="text-xs text-content-muted">Filtering by</span>
          <button type="button" onClick={() => setProvider('')} className="chip chip-active gap-1.5">
            {activeProvider?.title ?? provider}
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Provider rail (wide screens) */}
      <section aria-label="Filter by provider" className="hidden lg:block">
        <ChipRow>
          <Chip active={provider === ''} onClick={() => setProvider('')}>
            All providers
          </Chip>
          {!providers
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-28 shrink-0 rounded-full" />)
            : providers.map((p) => (
                <Chip
                  key={p.providerId}
                  active={provider === p.providerId}
                  onClick={() => selectProvider(p.providerId)}
                >
                  {p.title}
                  {p.examCount ? <span className="ml-0.5 text-[0.6875rem] opacity-60">{p.examCount}</span> : null}
                </Chip>
              ))}
        </ChipRow>
      </section>

      {/* Recently visited */}
      {showRail && recents.length > 0 && recentExams.length > 0 ? (
        <section aria-labelledby="recent-heading" className="section">
          <div className="section-head">
            <div className="min-w-0">
              <h2 id="recent-heading" className="heading-2 inline-flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/10 text-accent" aria-hidden="true">
                  <IconClock className="h-4 w-4" />
                </span>
                Continue where you left off
              </h2>
              <p className="caption mt-1">Your recently opened exams, ready to resume.</p>
            </div>
            <Link href="/history" className="btn-ghost btn-sm shrink-0">
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
      <section aria-label="Sort results" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 text-sm" aria-live="polite">
          <span className="font-semibold">
            {loading && !results ? 'Searching…' : `${total.toLocaleString()} ${total === 1 ? 'exam' : 'exams'}`}
          </span>
          {debounced ? <span className="text-content-muted"> for “{debounced}”</span> : null}
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
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
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
          <div className="stagger grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
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

      {/* Provider directory, shown before any search narrows the list */}
      {!hasFilters && providers && providers.length > 0 ? (
        <section aria-labelledby="providers-heading" className="section">
          <div className="section-head">
            <h2 id="providers-heading" className="heading-2">
              Browse by provider
            </h2>
            <p className="caption">Jump straight into the full catalogue for any provider.</p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {providers.slice(0, 16).map((p) => (
              <Link
                key={p.providerId}
                href={`/exams/${p.providerId}`}
                className="tile tile-interactive group flex items-center gap-3 p-3.5"
              >
                <span
                  aria-hidden="true"
                  className="h-9 w-1.5 shrink-0 rounded-full"
                  style={{ background: `hsl(${providerHue(p.providerId)} 82% 58%)` }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold">{p.title}</span>
                  <span className="block text-[0.6875rem] text-content-muted">{p.examCount || 0} exams</span>
                </span>
                <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {providerError ? (
        <ErrorState title="Providers unavailable" description={providerError} onRetry={loadProviders} />
      ) : null}

      {/* Phone filter sheet */}
      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter exams"
        side="bottom"
        className="lg:hidden"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-surface-border px-4 py-3">
          <span className="heading-3">Filter by provider</span>
          <button type="button" onClick={() => setFiltersOpen(false)} className="icon-btn" aria-label="Close filters">
            <IconX />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!providers ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-28 rounded-full" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Chip active={provider === ''} onClick={() => setProvider('')}>
                All providers
              </Chip>
              {providers.map((p) => (
                <Chip key={p.providerId} active={provider === p.providerId} onClick={() => selectProvider(p.providerId)}>
                  {p.title}
                  {p.examCount ? <span className="ml-0.5 text-[0.6875rem] opacity-60">{p.examCount}</span> : null}
                </Chip>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-surface-border p-3">
          <button
            type="button"
            className="btn-ghost flex-1"
            onClick={() => setProvider('')}
            disabled={!provider}
          >
            Clear
          </button>
          <button type="button" className="btn-primary flex-1" onClick={() => setFiltersOpen(false)}>
            Show results
          </button>
        </div>
      </Drawer>
    </div>
  );
}
