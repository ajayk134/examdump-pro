'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import type { QuestionsResponse } from '@/lib/types';
import { QuestionCard } from './question-card';
import { Alert, Spinner } from './ui';
import { IconArrowRight, IconSparkles } from './icons';
import { formatNumber } from '@/lib/format';

const PAGE_SIZE = 10;

export function StudySession({
  providerId,
  examKey,
  mode,
}: {
  providerId: string;
  examKey: string;
  mode: 'practice' | 'reading' | 'random';
}) {
  const [data, setData] = useState<QuestionsResponse | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    get<QuestionsResponse>(
      `/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}/questions?limit=200&mode=${mode}&includeAnswer=true`,
    )
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, mode]);

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.questions.length / PAGE_SIZE)) : 1), [data]);
  const visible = data ? data.questions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];

  if (error) {
    return (
      <Alert tone="error">
        {error}{' '}
        <Link href="/browse" className="link">Back to browse</Link>
      </Alert>
    );
  }

  if (!data) return <Spinner label="Loading questions…" />;

  const limited = data.entitlement.isLimited;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/providers/${encodeURIComponent(providerId)}`} className="text-sm text-content-muted hover:text-content-primary">
            ← {data.provider.title}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{data.exam.code}</h1>
          <p className="text-sm text-content-muted">
            {formatNumber(data.entitlement.totalQuestions)} questions · showing{' '}
            {formatNumber(data.entitlement.accessibleQuestions)} · {mode} mode
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=practice`} className={mode === 'practice' ? 'btn-primary' : 'btn-secondary'}>Practice</Link>
          <Link href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=reading`} className={mode === 'reading' ? 'btn-primary' : 'btn-secondary'}>Reading</Link>
        </div>
      </div>

      {limited ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-300">Free preview: first {data.entitlement.accessibleQuestions} questions</p>
            <p className="text-xs text-content-muted">
              {formatNumber(data.entitlement.lockedQuestions)} more questions are locked. Premium unlocks the full exam, mock tests and AI explanations.
            </p>
          </div>
          <Link href="/pricing" className="btn-primary">
            Unlock everything <IconArrowRight width={16} height={16} />
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {visible.map((question, i) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={(page - 1) * PAGE_SIZE + i + 1}
            providerId={providerId}
            examKey={examKey}
            initiallyRevealed={mode === 'reading'}
            allowPractice={mode !== 'reading'}
          />
        ))}
      </div>

      {data.questions.length === 0 ? <Alert tone="warning">No questions are available for this exam yet.</Alert> : null}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised/60 px-4 py-3">
          <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </button>
          <span className="text-sm text-content-muted">Page {page} of {totalPages}</span>
          <button className="btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-400/30 bg-brand-500/5 p-4">
        <p className="flex items-center gap-2 text-sm text-content-secondary">
          <IconSparkles width={18} height={18} className="text-brand-400" />
          Want a realistic simulation? Take a timed mock exam.
        </p>
        <Link href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=mock`} className="btn-primary">
          Start mock exam
        </Link>
      </div>
    </div>
  );
}