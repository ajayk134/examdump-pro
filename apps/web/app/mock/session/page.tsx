'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MockSession } from '@/components/mock-session';
import { EmptyIcon, EmptyState, Spinner } from '@/components/ui';

function MockSessionInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const mode = params.get('mode') === 'timed' ? 'timed' : 'mock';
  const durationRaw = Number(params.get('duration'));
  const duration = Number.isFinite(durationRaw) && durationRaw >= 30 ? durationRaw : undefined;
  const countRaw = Number(params.get('count'));
  const count = Number.isFinite(countRaw) && countRaw > 0 ? countRaw : undefined;

  if (!provider || !exam) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <EmptyState
          icon={<EmptyIcon name="book" />}
          title="No exam selected"
          description="Configure a mock in the simulator first."
          action={
            <Link href="/mock" className="btn-primary">
              Open mock simulator
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <MockSession
      providerId={provider}
      examKey={exam}
      mode={mode}
      count={count}
      durationSeconds={duration}
    />
  );
}

export default function MockSessionPage() {
  return (
    <Suspense fallback={<Spinner label="Preparing your exam..." />}>
      <MockSessionInner />
    </Suspense>
  );
}