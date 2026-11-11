'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { GoogleButton } from '@/components/google-button';
import { Alert } from '@/components/ui';
import { useAuth, useToast } from '@/components/providers';
import { post } from '@/lib/api';
import type { User } from '@/lib/types';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const { user, loading: authLoading, refresh } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', referralCode: '', acceptTerms: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devVerify, setDevVerify] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const ref = params.get('ref');
    if (ref) setForm((prev) => ({ ...prev, referralCode: ref.toUpperCase() }));
  }, [params]);

  // Someone who already has a session has no business on the sign-up form:
  // submitting it with their own email only produces "account already exists".
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(params.get('next') || '/dashboard');
    }
  }, [authLoading, user, router, params]);

  const update = (key: keyof typeof form) => (value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.acceptTerms) {
      setError('Please accept the terms to continue.');
      return;
    }
    setLoading(true);
    try {
      const result = await post<{ user: User; devVerificationUrl?: string }>('/auth/register', {
        name: form.name,
        email: form.email,
        password: form.password,
        referralCode: form.referralCode || undefined,
        acceptTerms: true,
      });
      // Registration signs the account in, so the session is already live.
      await refresh();
      setDone(true);
      setDevVerify(result.devVerificationUrl ?? '');
      toast('Account created. You are signed in.', 'success');
    } catch (err) {
      setError((err as Error).message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Check your inbox" subtitle="We sent you a verification link.">
        <div className="flex flex-col gap-4 text-sm text-content-secondary">
          <Alert tone="success">Your account is created. Verify your email to unlock everything.</Alert>
          {devVerify ? (
            <Alert tone="info">
              Development mode: no email provider configured.{' '}
              <a className="link break-all" href={devVerify}>Open verification link</a>
            </Alert>
          ) : null}
          <button onClick={() => router.push('/dashboard')} className="btn-primary w-full py-3">
            Go to your dashboard
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start with 5 free questions on every exam."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="link">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input id="name" required className="input" value={form.name} onChange={(e) => update('name')(e.target.value)} placeholder="Alex Chen" autoComplete="name" />
        </div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" required className="input" value={form.email} onChange={(e) => update('email')(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" required className="input" value={form.password} onChange={(e) => update('password')(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          <p className="mt-1 text-xs text-content-muted">Use 8+ characters with upper, lower and a number.</p>
        </div>
        <div>
          <label htmlFor="referralCode" className="label">Referral code <span className="text-content-muted">(optional)</span></label>
          <input id="referralCode" className="input" value={form.referralCode} onChange={(e) => update('referralCode')(e.target.value.toUpperCase())} placeholder="SAVE10" />
        </div>
        <label className="flex items-start gap-2 text-sm text-content-secondary">
          <input type="checkbox" className="mt-1 h-4 w-4 rounded border-surface-border" checked={form.acceptTerms} onChange={(e) => update('acceptTerms')(e.target.checked)} />
          <span>
            I agree to the <Link href="/terms" className="link">terms</Link> and <Link href="/privacy" className="link">privacy policy</Link>.
          </span>
        </label>
        <button type="submit" className="btn-primary mt-1 w-full py-3" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
        <GoogleButton label="Sign up with Google" />
      </form>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-content-muted">Loading…</div>}>
      <RegisterForm />
    </Suspense>
  );
}