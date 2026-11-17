'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { StudySession } from '@/components/study-session';
import { EmptyIcon, EmptyState, Spinner } from '@/components/ui';

function PracticeSessionInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const focus = params.get('focus') ?? 'all';
  const types = params.get('types') ?? undefined;
  const topic = params.get('topic') ?? undefined;
  const countRaw = Number(params.get('count'));
  const count = Number.isFinite(countRaw) && countRaw > 0 ? countRaw : undefined;
  const random = params.get('random') === '1' || params.get('mode') === 'random';

  if (!provider || !exam) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <EmptyState
          icon={<EmptyIcon name="search" />}
          title="No exam selected"
          description="Build a practice session first — it takes two taps."
          action={
            <Link href="/practice" className="btn-primary">
              Open practice hub
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <StudySession
      providerId={provider}
      examKey={exam}
      mode={random ? 'random' : 'practice'}
      focus={focus}
      types={types}
      topic={topic}
      count={count}
      random={random}
    />
  );
}

export default function PracticeSessionPage() {
  return (
    <Suspense fallback={<Spinner label="Preparing your session..." />}>
      <PracticeSessionInner />
    </Suspense>
  );
}