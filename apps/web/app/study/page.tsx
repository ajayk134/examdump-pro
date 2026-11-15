'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { StudySession } from '@/components/study-session';
import { MockSession } from '@/components/mock-session';
import { EmptyIcon, EmptyState, Spinner } from '@/components/ui';

function StudyInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const mode = params.get('mode') ?? 'practice';

  if (!provider || !exam) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon={<EmptyIcon name="search" />}
          title="No exam selected"
          description="Pick a certification from the catalogue to start a practice session."
          action={
            <Link href="/exams" className="btn-primary">
              Browse exams
            </Link>
          }
        />
      </div>
    );
  }

  if (mode === 'mock' || mode === 'timed') {
    return <MockSession providerId={provider} examKey={exam} mode={mode} />;
  }

  const studyMode = mode === 'random' ? 'random' : 'practice';
  return <StudySession providerId={provider} examKey={exam} mode={studyMode} />;
}

export default function StudyPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <StudyInner />
    </Suspense>
  );
}