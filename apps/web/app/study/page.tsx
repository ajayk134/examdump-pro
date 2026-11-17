'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/ui';

/**
 * Compatibility route.
 *
 * `/study` was the old single entry point for both practice and mocks. The
 * product now separates them into a hub plus a runner, so this keeps every
 * existing bookmark and notification working by forwarding to the right place.
 */
function StudyRedirect() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const provider = params.get('provider');
    const exam = params.get('exam');
    const mode = params.get('mode') ?? 'practice';

    if (!provider || !exam) {
      router.replace('/practice');
      return;
    }
    if (mode === 'mock' || mode === 'timed') {
      router.replace(`/mock/session?${new URLSearchParams({ provider, exam, mode }).toString()}`);
    } else {
      router.replace(
        `/practice/session?${new URLSearchParams({
          provider,
          exam,
          mode: mode === 'random' ? 'random' : 'practice',
        }).toString()}`,
      );
    }
  }, [params, router]);

  return <Spinner label="Opening your session..." />;
}

export default function StudyPage() {
  return (
    <Suspense fallback={<Spinner label="Opening your session..." />}>
      <StudyRedirect />
    </Suspense>
  );
}