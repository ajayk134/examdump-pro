'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam } from '@/lib/types';
import { ExamCard, ExamCardSkeleton, type ExamCardData } from '@/components/exam-card';
import { EmptyIcon, EmptyState, ErrorState, PageShell, SegmentedSort, Skeleton } from '@/components/ui';
import { IconArrowLeft, IconSearch, IconX } from '@/components/icons';
import { examId, toggleExamBookmark } from '@/lib/local-store';

interface ProviderResponse {
  provider: { providerId: string; title: string; slug: string; examCount: number; totalQuestions: number };
  exams: Exam[];
}

const SORTS: Array<{ id: 'popular' | 'title' | 'questions'; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'title', label: 'A–Z' },
  { id: 'questions', label: 'Most questions' },
];

/** Stable hue per provider so the header accent matches its cards. */
function providerHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

export default function ProviderPage() {
  const params = useParams<{ providerId: string }>();
  const providerId = decodeURIComponent(params.providerId);

  const [data, setData] = useState<ProviderResponse | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'popular' | 'title' | 'questions'>('popular');
  const [bookmarks, setBookmarks] = useState<string[]>([]);

  const load = useCallback(() => {
    setError('');
    get<ProviderResponse>(`/exams/${encodeURIComponent(providerId)}`)
      .then((res) => setData(res))
      .catch((err) => setError((err as Error).message));
  }, [providerId]);

  useEffect(() => {
    load();
    setBookmarks(toggleExamBookmark());
  }, [load]);

  const exams = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? data.exams.filter(
          (e) => e.title.toLowerCase().includes(q) || e.code.toLowerCase().includes(q),
        )
      : data.exams;

    const sorted = [...filtered];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'questions') sorted.sort((a, b) => b.questionCount - a.questionCount);
    return sorted;
  }, [data, query, sort]);

  const toCard = (exam: Exam): ExamCardData => ({
    providerId: exam.providerId,
    examKey: exam.key,
    code: exam.code,
    title: exam.title,
    providerTitle: exam.providerTitle,
    questionCount: exam.questionCount,
    bookmarked: bookmarks.includes(examId(exam.providerId, exam.key)),
  });

  const hue = providerHue(providerId);

  return (
    <PageShell className="flex flex-col gap-4 sm:gap-5">
      <Link
        href="/exams"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-content-muted transition-colors hover:text-content-primary"
      >
        <IconArrowLeft className="h-4 w-4" />
        All exams
      </Link>

      {error ? (
        <ErrorState title="Provider unavailable" description={error} onRetry={load} />
      ) : !data ? (
        <>
          <div className="panel-lg p-5">
            <Skeleton className="mb-3 h-3 w-28" />
            <Skeleton className="mb-3 h-7 w-3/5" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ExamCardSkeleton key={i} />
            ))}
          </div>
        </>
      ) : (
        <>
          <header className="panel-lg relative overflow-hidden p-5 sm:p-6">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1.5"
              style={{ background: `linear-gradient(180deg, hsl(${hue} 82% 58%), hsl(${(hue + 40) % 360} 86% 62%))` }}
            />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-content-muted">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ background: `hsl(${hue} 82% 58%)` }}
                  />
                  Certification provider
                </p>
                <h1 className="display-2 mt-2 text-balance">{data.provider.title}</h1>
                <p className="body-text mt-2 max-w-xl">
                  Browse every exam from this provider and open one to start practising or sit a mock test.
                </p>
              </div>

              <dl className="flex shrink-0 gap-7">
                <div>
                  <dt className="metric-label">Exams</dt>
                  <dd className="metric-value mt-1">{data.exams.length.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="metric-label">Questions</dt>
                  <dd className="metric-value mt-1">{data.provider.totalQuestions.toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          </header>

          <section
            aria-label="Filter and sort exams"
            className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
          >
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
              <input
                type="search"
                inputMode="search"
                autoComplete="off"
                aria-label={`Search ${data.provider.title} exams`}
                placeholder="Filter exams by code or title..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input pl-10 pr-12"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear filter"
                  className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                >
                  <IconX className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="shrink-0">
              <SegmentedSort value={sort} onChange={(v) => setSort(v as typeof sort)} options={SORTS} />
            </div>
          </section>

          <p className="caption -mt-1" aria-live="polite">
            Showing {exams.length.toLocaleString()} of {data.exams.length.toLocaleString()} exam
            {data.exams.length === 1 ? '' : 's'}
            {query ? ` matching “${query.trim()}”` : ''}
          </p>

          {exams.length === 0 ? (
            <EmptyState
              icon={<EmptyIcon name="search" />}
              title="No exams matched"
              description="Try a different code or clear the filter."
              action={
                <button type="button" className="btn-secondary btn-sm" onClick={() => setQuery('')}>
                  Clear filter
                </button>
              }
            />
          ) : (
            <div className="stagger grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {exams.map((exam) => (
                <ExamCard
                  key={exam.key}
                  exam={toCard(exam)}
                  onBookmark={(e) => {
                    toggleExamBookmark.toggle(examId(e.providerId, e.examKey));
                    setBookmarks(toggleExamBookmark());
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
