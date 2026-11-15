'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type { Invoice, Payment } from '@/lib/types';
import { Alert, Spinner } from '@/components/ui';
import { IconAlertCircle, IconCheck, IconClock, IconX } from '@/components/icons';
import { formatMoneyMinor } from '@/lib/format';

interface VerifyResponse {
  status: 'succeeded' | 'failed' | 'pending' | 'ignored';
  payment?: Payment;
  invoice?: Invoice | null;
  subscriptionId?: string | null;
}

const POLL_MS = 3000;
const MAX_ATTEMPTS = 20;

/** Rounded status mark shared by every terminal state. */
function StatusMark({ tone, children }: { tone: 'positive' | 'negative' | 'accent'; children: ReactNode }) {
  const toneClass = {
    positive: 'bg-positive/10 text-positive',
    negative: 'bg-negative/10 text-negative',
    accent: 'bg-accent/10 text-accent',
  }[tone];
  return <span className={`grid h-14 w-14 place-items-center rounded-2xl ${toneClass}`}>{children}</span>;
}

export default function CheckoutReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl py-12">
          <Spinner label="Preparing checkout..." />
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
  const orderRef = params.get('ref') ?? params.get('orderRef') ?? '';

  const [state, setState] = useState<'idle' | 'verifying' | 'succeeded' | 'failed' | 'pending' | 'error'>('idle');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [message, setMessage] = useState('');
  const attempts = useRef(0);
  const stopped = useRef(false);

  const resolveLocalPayment = useCallback(async (): Promise<string | null> => {
    if (localPaymentId) return localPaymentId;
    // The gateway may return only our order reference; some older links carry a
    // literal placeholder or the gateway id. Payments are newest-first, so the
    // final fallback is the user's most recent payment.
    const list = await get<{ payments: Payment[] }>('/payments');
    const match =
      list.payments.find((p) => orderRef && p.orderRef === orderRef) ??
      list.payments.find(
        (p) =>
          gatewayPaymentId &&
          gatewayPaymentId !== '{payment_id}' &&
          (p.providerPaymentId === gatewayPaymentId || p.providerRef === gatewayPaymentId),
      ) ??
      list.payments.find((p) => p.status === 'pending') ??
      list.payments[0];
    return match?.id ?? null;
  }, [gatewayPaymentId, localPaymentId, orderRef]);

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
    <div className="mx-auto w-full max-w-xl py-8 sm:py-12">
      <div className="panel-lg overflow-hidden">
        <div className="flex flex-col items-center px-5 py-8 text-center sm:px-8 sm:py-10">
          {state === 'succeeded' ? (
            <>
              <StatusMark tone="positive">
                <IconCheck width={28} height={28} />
              </StatusMark>
              <h1 className="heading-1 mt-4">Payment successful</h1>
              <p className="body-text mx-auto mt-2 max-w-sm">
                Your pass is active. Full question banks, mocks and AI explanations are unlocked.
              </p>
              {payment ? (
                <p className="caption mt-4">
                  {formatMoneyMinor(payment.amountMinor, payment.currency)} · {payment.description}
                </p>
              ) : null}
              <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">
                <Link href="/dashboard" className="btn-primary">
                  Go to dashboard
                </Link>
                <Link href="/exams" className="btn-secondary">
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
              <StatusMark tone="negative">
                <IconX width={28} height={28} />
              </StatusMark>
              <h1 className="heading-1 mt-4">Payment did not go through</h1>
              <p className="body-text mx-auto mt-2 max-w-sm">{message}</p>
              <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">
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
              <StatusMark tone="negative">
                <IconAlertCircle width={28} height={28} />
              </StatusMark>
              <h1 className="heading-1 mt-4">We could not confirm the payment</h1>
              <div className="mt-4 w-full">
                <Alert tone="error">{message}</Alert>
              </div>
              <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">
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
              <StatusMark tone="accent">
                <IconClock width={28} height={28} />
              </StatusMark>
              <h1 className="heading-1 mt-4">Confirming your payment</h1>
              <p className="body-text mx-auto mt-2 max-w-sm">{message}</p>
              {gatewayPaymentId ? (
                <p className="mt-3 font-mono text-xs text-content-muted">Ref: {gatewayPaymentId}</p>
              ) : null}
              <Spinner label="Waiting for the bank to confirm..." />
              <div className="flex justify-center">
                <Link href="/profile" className="btn-secondary">
                  Back to profile
                </Link>
              </div>
            </>
          ) : (
            <>
              <Spinner label={loading ? 'Checking your session...' : 'Checking payment status...'} />
              <p className="mt-3 text-sm text-content-muted">
                This usually takes a few seconds. Please do not close the page.
              </p>
            </>
          )}
        </div>
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
