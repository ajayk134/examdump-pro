'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { get } from '@/lib/api';
import type { ExamDetail } from '@/lib/types';
import { PracticeConfig } from '@/components/practice-config';
import type { SelectedExam } from '@/components/exam-select';
import { PageShell, Skeleton } from '@/components/ui';
import { IconArrowRight, IconBook, IconChart, IconTrophy } from '@/components/icons';

const HIGHLIGHTS = [
  {
    icon: IconBook,
    title: 'Target, don’t scroll',
    body: 'Filter by question type and what you have missed, then start in one tap.',
  },
  {
    icon: IconChart,
    title: 'Progress that counts',
    body: 'Every answer is graded on the server and feeds your accuracy and weak spots.',
  },
  {
    icon: IconTrophy,
    title: 'Ready for the real thing',
    body: 'Finished a set? A timed mock is one click away from the same exam.',
  },
];

function PracticeHub() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const examKey = params.get('exam');
  const [initial, setInitial] = useState<SelectedExam | null>(null);
  const [loading, setLoading] = useState(Boolean(provider && examKey));

  useEffect(() => {
    if (!provider || !examKey) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    get<ExamDetail>(`/exams/${encodeURIComponent(provider)}/${encodeURIComponent(examKey)}`)
      .then((data) => {
        if (cancelled) return;
        setInitial({
          providerId: data.exam.providerId,
          examKey: data.exam.key,
          code: data.exam.code,
          title: data.exam.title,
          providerTitle: data.exam.providerTitle,
          questionCount: data.exam.questionCount,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, examKey]);

  return (
    <PageShell className="py-5 sm:py-8">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border bg-surface-raised p-5 shadow-sm sm:p-7">
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-16 h-64" />
        <div aria-hidden="true" className="orb -right-16 -top-20 h-56 w-56 bg-accent/20" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow mb-2">Practice</p>
            <h1 className="display-1 text-balance">Build a session in seconds</h1>
            <p className="body-text mt-3 max-w-2xl text-base">
              Choose an exam, set the focus, and start. No long lists — just the questions you need next.
            </p>
          </div>
          <Link href="/mock" className="btn-secondary btn-sm shrink-0">
            Mock simulator
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="mt-5 sm:mt-6">
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6" aria-busy="true">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-[5.5rem] rounded-[1.25rem]" />
              <Skeleton className="h-[19rem] rounded-[1.5rem]" />
            </div>
            <Skeleton className="h-[16rem] rounded-[1.5rem]" />
          </div>
        ) : (
          <PracticeConfig initialExam={initial} />
        )}
      </div>

      <section aria-label="Why practice here" className="mt-6 grid gap-3 sm:grid-cols-3">
        {HIGHLIGHTS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="panel flex flex-col gap-2 p-4">
              <span className="grid h-9 w-9 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
                <Icon className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-xs leading-relaxed text-content-muted">{item.body}</p>
            </div>
          );
        })}
      </section>
    </PageShell>
  );
}

export default function PracticePage() {
  return (
    <Suspense fallback={null}>
      <PracticeHub />
    </Suspense>
  );
}