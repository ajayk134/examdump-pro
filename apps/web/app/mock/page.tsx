'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { get } from '@/lib/api';
import type { ExamDetail } from '@/lib/types';
import { MockConfig } from '@/components/mock-config';
import type { SelectedExam } from '@/components/exam-select';
import { PageShell, Skeleton } from '@/components/ui';
import { IconArrowRight, IconCheckCircle, IconClock, IconTrophy } from '@/components/icons';

const HIGHLIGHTS = [
  {
    icon: IconClock,
    title: 'Real timer behaviour',
    body: 'Countdown, auto-submit at zero and a palette to move around like the real interface.',
  },
  {
    icon: IconCheckCircle,
    title: 'No hints mid-exam',
    body: 'Explanations stay locked until you submit, so the score means something.',
  },
  {
    icon: IconTrophy,
    title: 'Attempt history',
    body: 'Every mock is stored with its score and time so you can see the trend.',
  },
];

function MockHub() {
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
        <div aria-hidden="true" className="orb -right-16 -top-20 h-56 w-56 bg-accent-2/20" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow mb-2">Mock exam</p>
            <h1 className="display-1 text-balance">Sit the exam before the exam</h1>
            <p className="body-text mt-3 max-w-2xl text-base">
              Pick an exam, set the length, and get a full score report with a question-by-question review.
            </p>
          </div>
          <Link href="/practice" className="btn-secondary btn-sm shrink-0">
            Practice instead
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="mt-5 sm:mt-6">
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6" aria-busy="true">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-[5.5rem] rounded-[1.25rem]" />
              <Skeleton className="h-[22rem] rounded-[1.5rem]" />
            </div>
            <Skeleton className="h-[18rem] rounded-[1.5rem]" />
          </div>
        ) : (
          <MockConfig initialExam={initial} />
        )}
      </div>

      <section aria-label="How the simulator works" className="mt-6 grid gap-3 sm:grid-cols-3">
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

export default function MockPage() {
  return (
    <Suspense fallback={null}>
      <MockHub />
    </Suspense>
  );
}