'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam } from '@/lib/types';
import { ExamCard, ExamCardSkeleton, type ExamCardData } from '@/components/exam-card';
import { Chip, ChipRow, EmptyState, EmptyIcon, ErrorState, PageShell, Skeleton } from '@/components/ui';
import { IconArrowLeft, IconSearch, IconX } from '@/components/icons';
import { examId, toggleExamBookmark } from '@/lib/local-store';

interface ProviderResponse {
  provider: { providerId: string; title: string; slug: string; examCount: number; totalQuestions: number };
  exams: Exam[];
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
          <Skeleton className="h-7 w-2/5" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ExamCardSkeleton key={i} />
            ))}
          </div>
        </>
      ) : (
        <>
          <header>
            <h1 className="heading-1 text-balance">{data.provider.title}</h1>
            <p className="body-text mt-1">
              {data.exams.length.toLocaleString()} exams ·{' '}
              {data.provider.totalQuestions.toLocaleString()} questions
            </p>
          </header>

          <div className="sticky top-14 z-30 -mx-3.5 border-b border-surface-border/60 bg-surface-base/90 px-3.5 py-2.5 backdrop-blur-lg sm:top-16 sm:mx-0 sm:rounded-xl sm:border sm:px-3 lg:static lg:bg-transparent lg:backdrop-blur-none">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
              <input
                type="search"
                aria-label={`Search ${data.provider.title} exams`}
                placeholder="Filter exams…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input pl-10 pr-10"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-content-muted hover:bg-surface-overlay"
                >
                  <IconX className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <ChipRow>
            {(
              [
                ['popular', 'Popular'],
                ['title', 'A–Z'],
                ['questions', 'Most questions'],
              ] as const
            ).map(([id, label]) => (
              <Chip key={id} active={sort === id} onClick={() => setSort(id)}>
                {label}
              </Chip>
            ))}
          </ChipRow>

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
            <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
