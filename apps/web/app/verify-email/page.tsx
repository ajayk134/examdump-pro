'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Spinner } from '@/components/ui';
import { useAuth } from '@/components/providers';
import { post } from '@/lib/api';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAuth();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('This verification link is missing its token.');
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    post('/auth/verify-email', { token })
      .then(async () => {
        await refresh();
        setStatus('success');
      })
      .catch((err) => {
        setStatus('error');
        setMessage((err as Error).message || 'Verification failed.');
      });
  }, [token, refresh]);

  return (
    <AuthShell title="Email verification" subtitle="Confirming your email address.">
      {status === 'loading' ? <Spinner label="Verifying…" /> : null}
      {status === 'success' ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">Your email is verified. You are all set!</Alert>
          <Link href="/dashboard" className="btn-primary w-full py-3">Go to dashboard</Link>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="flex flex-col gap-4">
          <Alert tone="error">{message}</Alert>
          <Link href="/login" className="btn-secondary w-full py-3">Back to sign in</Link>
        </div>
      ) : null}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-content-muted">Loading…</div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}