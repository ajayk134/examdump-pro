'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { IconAlertCircle, IconRefresh } from '@/components/icons';

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
    <div className="relative isolate mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center py-16 text-center sm:py-24">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />

      <div className="relative flex flex-col items-center gap-5">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-negative/10 text-negative">
          <IconAlertCircle width={26} height={26} />
        </span>

        <div>
          <h1 className="heading-1 text-balance">Something went wrong</h1>
          <p className="body-text mx-auto mt-2 max-w-sm text-pretty">
            This page hit an unexpected error. Your saved progress is not affected.
          </p>
          {error.digest ? (
            <p className="mt-3 font-mono text-[0.6875rem] text-content-muted">Reference: {error.digest}</p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <button type="button" onClick={reset} className="btn-primary">
            <IconRefresh width={16} height={16} />
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
