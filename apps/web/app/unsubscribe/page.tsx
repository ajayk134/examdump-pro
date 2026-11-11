'use client';

/**
 * Public unsubscribe page.
 *
 * Opened from an email, so there is no session. The signed token in the query
 * string is the authority; the page posts it to the API and shows the result.
 * One click confirms - no login, no extra steps.
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiBase } from '@/lib/api';

function UnsubscribeInner() {
  const params = useSearchParams();
  const e = params.get('e') ?? '';
  const u = params.get('u') ?? '';
  const t = params.get('t') ?? '';

  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const valid = Boolean(e && u && t);

  useEffect(() => {
    if (!valid) {
      setState('error');
      setMessage('This unsubscribe link is incomplete or invalid.');
    }
  }, [valid]);

  async function unsubscribe(scope: 'marketing' | 'all') {
    setState('working');
    try {
      const res = await fetch(`${apiBase()}/email/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e, u, t, scope }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'This link is invalid or has expired.');
      }
      setState('done');
      setMessage(
        scope === 'all'
          ? 'You have been unsubscribed from all ExamDump email.'
          : 'You have been unsubscribed from ExamDump announcements and product updates.',
      );
    } catch (err) {
      setState('error');
      setMessage((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <h1 className="text-xl font-bold tracking-tight">Email preferences</h1>

        {state === 'done' ? (
          <>
            <p className="mt-3 text-sm text-content-muted">{message}</p>
            <p className="mt-3 text-xs text-content-subtle">
              You will still receive essential account email such as verification links, password
              resets and payment receipts.
            </p>
            <Link href="/profile" className="btn btn-primary mt-5 inline-flex">
              Manage all preferences
            </Link>
          </>
        ) : state === 'error' ? (
          <>
            <p className="mt-3 text-sm text-danger-600">{message}</p>
            <p className="mt-3 text-xs text-content-subtle">
              If the link keeps failing, sign in and change your email preferences from your profile.
            </p>
            <Link href="/profile" className="btn mt-5 inline-flex">
              Open profile
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-content-muted">
              Choose what you would like to stop receiving. Essential account email is always sent.
            </p>
            {e ? <p className="mt-2 text-xs text-content-subtle">Address: {e}</p> : null}

            <div className="mt-5 space-y-2">
              <button
                className="btn btn-primary w-full"
                disabled={!valid || state === 'working'}
                onClick={() => void unsubscribe('marketing')}
              >
                Stop announcements and product updates
              </button>
              <button
                className="btn w-full"
                disabled={!valid || state === 'working'}
                onClick={() => void unsubscribe('all')}
              >
                Stop all non-essential email
              </button>
            </div>
            <p className="mt-4 text-xs text-content-subtle">
              Verification links, password resets, security alerts and payment receipts are always
              delivered because they are part of your account.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-4 py-10">Loading…</main>}>
      <UnsubscribeInner />
    </Suspense>
  );
}
