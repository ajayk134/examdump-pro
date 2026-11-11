'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type { Invoice, Payment } from '@/lib/types';
import { Alert, Spinner } from '@/components/ui';
import { IconCheck, IconX } from '@/components/icons';
import { formatMoneyMinor } from '@/lib/format';

interface VerifyResponse {
  status: 'succeeded' | 'failed' | 'pending' | 'ignored';
  payment?: Payment;
  invoice?: Invoice | null;
  subscriptionId?: string | null;
}

const POLL_MS = 3000;
const MAX_ATTEMPTS = 20;

export default function CheckoutReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl py-12">
          <Spinner label="Preparing checkout…" />
        </div>
      }
    >
      <CheckoutReturn />
    </Suspense>
  );
}

function CheckoutReturn() {
  const params = useSearchParams();
  const { user, loading, refresh } = useAuth();
  const { toast } = useToast();

  const gatewayPaymentId = params.get('payment') ?? params.get('payment_id') ?? '';
  const localPaymentId = params.get('id') ?? '';

  const [state, setState] = useState<'idle' | 'verifying' | 'succeeded' | 'failed' | 'pending' | 'error'>('idle');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [message, setMessage] = useState('');
  const attempts = useRef(0);
  const stopped = useRef(false);

  const resolveLocalPayment = useCallback(async (): Promise<string | null> => {
    if (localPaymentId) return localPaymentId;
    // Webhook/redirect may only carry the gateway reference: look it up.
    const list = await get<{ payments: Payment[] }>('/payments');
    const match = list.payments.find(
      (p) =>
        (gatewayPaymentId && (p.providerPaymentId === gatewayPaymentId || p.providerRef === gatewayPaymentId)) ||
        p.status === 'pending',
    );
    return match?.id ?? null;
  }, [gatewayPaymentId, localPaymentId]);

  const verify = useCallback(async () => {
    if (!user) return;
    setState((prev) => (prev === 'succeeded' ? prev : 'verifying'));
    try {
      const id = await resolveLocalPayment();
      if (!id) {
        setState('error');
        setMessage('We could not find that payment on your account.');
        return;
      }
      const result = await post<VerifyResponse>(`/payments/${id}/verify`);
      setPayment(result.payment ?? null);
      setInvoice(result.invoice ?? null);

      if (result.status === 'succeeded') {
        stopped.current = true;
        setState('succeeded');
        void refresh();
        return;
      }
      if (result.status === 'failed') {
        stopped.current = true;
        setState('failed');
        setMessage(result.payment?.failureReason ?? 'The payment was declined or cancelled.');
        return;
      }
      attempts.current += 1;
      if (attempts.current >= MAX_ATTEMPTS) {
        stopped.current = true;
        setState('pending');
        setMessage(
          'Your bank has not confirmed the payment yet. We will unlock access automatically as soon as it clears — you can safely close this page.',
        );
        return;
      }
      setState('pending');
    } catch (err) {
      setState('error');
      setMessage((err as Error).message);
    }
  }, [resolveLocalPayment, refresh, user]);

  useEffect(() => {
    if (loading || !user || stopped.current) return;
    void verify();
    const timer = setInterval(() => {
      if (stopped.current) {
        clearInterval(timer);
        return;
      }
      void verify();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loading, user, verify]);

  return (
    <div className="mx-auto max-w-xl py-12">
      <div className="card-elevated p-8 text-center">
        {state === 'succeeded' ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <IconCheck className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Payment successful</h1>
            <p className="mt-2 text-sm text-content-secondary">
              Your pass is active. Full question banks, mocks and AI explanations are unlocked.
            </p>
            {payment ? (
              <p className="mt-4 text-sm text-content-muted">
                {formatMoneyMinor(payment.amountMinor, payment.currency)} · {payment.description}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard" className="btn-primary">
                Go to dashboard
              </Link>
              <Link href="/browse" className="btn-secondary">
                Start practising
              </Link>
              {invoice ? (
                <Link href={`/invoices/${invoice.id}`} className="btn-ghost">
                  View invoice
                </Link>
              ) : null}
            </div>
          </>
        ) : state === 'failed' ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <IconX className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Payment did not go through</h1>
            <p className="mt-2 text-sm text-content-secondary">{message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/pricing" className="btn-primary">
                Try again
              </Link>
              <Link href="/support" className="btn-secondary">
                Contact support
              </Link>
            </div>
          </>
        ) : state === 'error' ? (
          <>
            <h1 className="text-2xl font-bold">We could not confirm the payment</h1>
            <Alert tone="error">{message}</Alert>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button type="button" className="btn-primary" onClick={() => void verify()}>
                Retry
              </button>
              <Link href="/support" className="btn-secondary">
                Contact support
              </Link>
            </div>
          </>
        ) : state === 'pending' ? (
          <>
            <Spinner label="Waiting for the bank to confirm…" />
            <h1 className="text-xl font-semibold">Confirming your payment</h1>
            <p className="mt-2 text-sm text-content-secondary">{message}</p>
            {gatewayPaymentId ? (
              <p className="mt-3 font-mono text-xs text-content-muted">Ref: {gatewayPaymentId}</p>
            ) : null}
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/profile" className="btn-secondary">
                Back to profile
              </Link>
            </div>
          </>
        ) : (
          <>
            <Spinner label={loading ? 'Checking your session…' : 'Checking payment status…'} />
            <p className="mt-3 text-sm text-content-muted">
              This usually takes a few seconds. Please do not close the page.
            </p>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-content-muted">
        Need help?{' '}
        <Link href="/support" className="link">
          Open a support ticket
        </Link>{' '}
        with the payment reference above.
      </p>
    </div>
  );
}