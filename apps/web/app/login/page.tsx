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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading, refresh } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Never show the sign-in form to an already authenticated visitor; send them
  // on to wherever they were headed instead.
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(params.get('next') || '/dashboard');
    }
  }, [authLoading, user, router, params]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await post<{ user: User }>('/auth/login', { email, password });
      await refresh();
      toast('Welcome back!', 'success');
      router.push(params.get('next') || '/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue your exam preparation."
      footer={
        <>
          New here?{' '}
          <Link href="/register" className="link">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="label">Password</label>
            <Link href="/forgot-password" className="mb-1.5 text-xs text-brand-500 hover:underline dark:text-brand-300">
              Forgot password?
            </Link>
          </div>
          <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <button type="submit" className="btn-primary mt-1 w-full py-3" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <GoogleButton />
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-content-muted">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}