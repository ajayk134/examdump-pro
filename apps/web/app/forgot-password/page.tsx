'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui';
import { post } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await post<{ devResetUrl?: string }>('/auth/forgot-password', { email });
      setDevUrl(result.devResetUrl ?? '');
      setSent(true);
    } catch (err) {
      setError((err as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link."
      footer={<Link href="/login" className="link">Back to sign in</Link>}
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">If an account exists for that email, a reset link is on its way.</Alert>
          {devUrl ? (
            <Alert tone="info">
              Development mode:{' '}
              <a className="link break-all" href={devUrl}>Open reset link</a>
            </Alert>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>
          <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}