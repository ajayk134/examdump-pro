'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { StudySession } from '@/components/study-session';
import { MockSession } from '@/components/mock-session';
import { Alert, Spinner } from '@/components/ui';

function StudyInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const mode = params.get('mode') ?? 'practice';

  if (!provider || !exam) {
    return (
      <div className="mx-auto max-w-lg">
        <Alert tone="warning">No exam selected. Pick one from the catalogue.</Alert>
        <Link href="/exams" className="btn-primary mt-4">Browse exams</Link>
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