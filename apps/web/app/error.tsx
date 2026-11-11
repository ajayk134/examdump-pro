'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { IconAlertCircle } from '@/components/icons';

/**
 * Route-level error boundary. Keeps the shell (nav, theme) intact so a single
 * failing page never leaves the app blank.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest so it can be matched against server logs.
    console.error('Route error', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center sm:py-24">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-negative/10 text-negative">
        <IconAlertCircle className="h-6 w-6" />
      </span>
      <div>
        <h1 className="heading-1">Something went wrong</h1>
        <p className="body-text mt-2">
          This page hit an unexpected error. Your saved progress is not affected.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[0.6875rem] text-content-muted">Reference: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
