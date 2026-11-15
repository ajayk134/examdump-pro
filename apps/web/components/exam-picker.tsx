'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated } from '@/lib/types';
import { ExamCard, ExamCardSkeleton, type ExamCardData } from '@/components/exam-card';
import { EmptyIcon, EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { IconBook, IconSearch, IconTrophy, IconX } from '@/components/icons';
import { getRecents } from '@/lib/local-store';

const MODE_META = {
  practice: {
    eyebrow: 'Practice',
    title: 'Start practising',
    description: 'Pick an exam and answer questions with instant explanations and the AI tutor on hand.',
    icon: IconBook,
  },
  mock: {
    eyebrow: 'Mock tests',
    title: 'Start a mock test',
    description: 'Pick an exam to sit a timed mock with a full score report. Choose your exam below.',
    icon: IconTrophy,
  },
} as const;

/**
 * Shown when someone opens Practice or Mock Tests from the tab bar without an
 * exam selected. Keeps them in the flow instead of bouncing them to discovery.
 */
export function ExamPicker({ mode }: { mode: 'practice' | 'mock' }) {
  const [results, setResults] = useState<Exam[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  // `localStorage` does not exist during SSR, so reading recents while
  // rendering produced different HTML on the server ([]) and on the client (a
  // returning visitor's list). React then threw a hydration mismatch and
  // re-rendered the whole picker. Read it after mount instead, like
  // `app/exams/page.tsx` does.
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    setRecents(getRecents());
  }, []);

  const load = useCallback(
    (q: string) => {
      setError('');
      const params = new URLSearchParams({ sort: 'popular', pageSize: '12' });
      if (q.trim().length >= 2) params.set('q', q.trim());
      get<Paginated<Exam>>(`/exams/search?${params.toString()}`)
        .then((data) => setResults(data.items))
        .catch((err) => setError((err as Error).message));
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => load(query), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  const toCard = (exam: Exam): ExamCardData => ({
    providerId: exam.providerId,
    examKey: exam.key,
    code: exam.code,
    title: exam.title,
    providerTitle: exam.providerTitle,
    questionCount: exam.questionCount,
  });

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow={meta.eyebrow}
        title={meta.title}
        description={meta.description}
        actions={
          <span
            className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent"
            aria-hidden="true"
          >
            <ModeIcon className="h-5 w-5" />
          </span>
        }
      />

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          aria-label="Search exams"
          placeholder="Search by exam code or title..."
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

      {recents.length > 0 && !query ? (
        <p className="caption">
          Tip: your recent exams appear first on the{' '}
          <Link href="/exams" className="link">
            discover page
          </Link>
          .
        </p>
      ) : null}

      {error ? (
        <ErrorState title="Could not load exams" description={error} onRetry={() => load(query)} />
      ) : !results ? (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ExamCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="search" />}
          title="No exams matched"
          description="Try a different code, for example 200-301 or SY0-701."
          action={
            <Link href="/exams" className="btn-secondary btn-sm">
              Browse all exams
            </Link>
          }
        />
      ) : (
        <div className="stagger grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((exam) => (
            <ExamCard key={`${exam.providerId}:${exam.key}`} exam={toCard(exam)} />
          ))}
        </div>
      )}
    </div>
  );
}
