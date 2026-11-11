'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated } from '@/lib/types';
import { ExamCard, ExamCardSkeleton, type ExamCardData } from '@/components/exam-card';
import { EmptyIcon, EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { IconSearch } from '@/components/icons';
import { getRecents } from '@/lib/local-store';

/**
 * Shown when someone opens Practice or Mock Tests from the tab bar without an
 * exam selected. Keeps them in the flow instead of bouncing them to discovery.
 */
export function ExamPicker({ mode }: { mode: 'practice' | 'mock' }) {
  const [results, setResults] = useState<Exam[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

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

  const recents = getRecents();

  const toCard = (exam: Exam): ExamCardData => ({
    providerId: exam.providerId,
    examKey: exam.key,
    code: exam.code,
    title: exam.title,
    providerTitle: exam.providerTitle,
    questionCount: exam.questionCount,
  });

  const title = mode === 'mock' ? 'Start a mock test' : 'Start practising';
  const description =
    mode === 'mock'
      ? 'Pick an exam to sit a timed mock with a full score report. Choose your exam below.'
      : 'Pick an exam and answer questions with instant explanations and the AI tutor on hand.';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow={mode === 'mock' ? 'Mock tests' : 'Practice'} title={title} description={description} />

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
        <input
          type="search"
          aria-label="Search exams"
          placeholder="Search by exam code or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input pl-10"
        />
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((exam) => (
            <ExamCard key={`${exam.providerId}:${exam.key}`} exam={toCard(exam)} />
          ))}
        </div>
      )}
    </div>
  );
}
