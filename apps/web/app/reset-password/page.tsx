'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui';
import { useToast } from '@/components/providers';
import { post } from '@/lib/api';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await post('/auth/reset-password', { token, password });
      toast('Password reset. Please sign in.', 'success');
      router.push('/login');
    } catch (err) {
      setError((err as Error).message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="Make it strong and unique." footer={<Link href="/login" className="link">Back to sign in</Link>}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {!token ? <Alert tone="error">This reset link is missing its token.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label htmlFor="password" className="label">New password</label>
          <input id="password" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label htmlFor="confirm" className="label">Confirm password</label>
          <input id="confirm" type="password" required className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <button type="submit" className="btn-primary w-full py-3" disabled={loading || !token}>
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-content-muted">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}