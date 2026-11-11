'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { StudySession } from '@/components/study-session';
import { ExamPicker } from '@/components/exam-picker';

function PracticeInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const mode = params.get('mode') === 'random' ? 'random' : 'practice';

  if (!provider || !exam) {
    return <ExamPicker mode="practice" />;
  }

  return <StudySession providerId={provider} examKey={exam} mode={mode} />;
}

export default function PracticePage() {
  return (
    <Suspense fallback={null}>
      <PracticeInner />
    </Suspense>
  );
}
