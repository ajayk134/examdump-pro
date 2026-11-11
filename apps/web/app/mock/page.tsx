'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { MockSession } from '@/components/mock-session';
import { ExamPicker } from '@/components/exam-picker';

function MockInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const mode = params.get('mode') === 'timed' ? 'timed' : 'mock';

  if (!provider || !exam) {
    return <ExamPicker mode="mock" />;
  }

  return <MockSession providerId={provider} examKey={exam} mode={mode} />;
}

export default function MockPage() {
  return (
    <Suspense fallback={null}>
      <MockInner />
    </Suspense>
  );
}
