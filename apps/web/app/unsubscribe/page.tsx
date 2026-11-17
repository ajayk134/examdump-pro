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
import { AuthShell } from '@/components/auth-shell';
import { Spinner } from '@/components/ui';
import { apiBase } from '@/lib/api';
import { IconCheckCircle, IconAlertCircle } from '@/components/icons';

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

  const subtitle =
    state === 'done'
      ? 'Your preference has been saved.'
      : state === 'error'
        ? 'We could not change your preferences.'
        : 'Choose what you would like to stop receiving.';

  return (
    <AuthShell title="Email preferences" subtitle={subtitle}>
      {state === 'done' ? (
        <div className="flex flex-col gap-4">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-positive/10 text-positive ring-1 ring-inset ring-positive/20">
            <IconCheckCircle width={22} height={22} />
          </span>
          <p className="body-text text-center">{message}</p>
          <p className="caption text-center">
            You will still receive essential account email such as verification links, password resets and payment
            receipts.
          </p>
          <Link href="/profile" className="btn-primary w-full">
            Manage all preferences
          </Link>
        </div>
      ) : state === 'error' ? (
        <div className="flex flex-col gap-4">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-negative/10 text-negative ring-1 ring-inset ring-negative/20">
            <IconAlertCircle width={22} height={22} />
          </span>
          <p className="text-center text-sm text-negative">{message}</p>
          <p className="caption text-center">
            If the link keeps failing, sign in and change your email preferences from your profile.
          </p>
          <Link href="/profile" className="btn-secondary w-full">
            Open profile
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="body-text">
            Essential account email is always sent. Choose below if you would also like to stop announcements and
            product updates.
          </p>
          {e ? <p className="caption break-all">Address: {e}</p> : null}

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              className="btn-primary w-full whitespace-normal text-center leading-tight"
              disabled={!valid || state === 'working'}
              onClick={() => void unsubscribe('marketing')}
            >
              Stop announcements and product updates
            </button>
            <button
              type="button"
              className="btn-secondary w-full whitespace-normal text-center leading-tight"
              disabled={!valid || state === 'working'}
              onClick={() => void unsubscribe('all')}
            >
              Stop all non-essential email
            </button>
          </div>

          {state === 'working' ? <Spinner label="Saving your preference..." /> : null}

          <p className="caption">
            Verification links, password resets, security alerts and payment receipts are always delivered because
            they are part of your account.
          </p>
        </div>
      )}
    </AuthShell>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<Spinner label="Loading..." />}>
      <UnsubscribeInner />
    </Suspense>
  );
}
