'use client';

/**
 * UPI checkout.
 *
 * The QR and every intent link are rendered by the server from the frozen
 * `upiUri` on the order; this page only displays them. That means a tampered
 * client cannot redirect the money: the payee and amount are decided server-side
 * and re-read on every poll.
 *
 * The page polls the order until it settles, expires, or is cancelled. It never
 * decides that a payment succeeded - only the server does, after a bank alert is
 * matched.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/providers';
import { get, post, ApiError } from '@/lib/api';
import { Badge, Card, Spinner } from '@/components/ui';

interface UpiOrder {
  id: string;
  reference: string;
  /**
   * Customer-visible status, decided by the server:
   *   pending    - QR is live, nothing has arrived
   *   processing - a matching credit was seen and is being verified
   *   paid       - settled; plan already active
   *   expired / cancelled - the window closed
   */
  status: 'pending' | 'processing' | 'paid' | 'expired' | 'cancelled';
  amountPaise: number;
  amountLabel: string;
  /** Quoted plan price, before the per-attempt uniqueness suffix. */
  baseAmountPaise?: number;
  baseAmountLabel?: string;
  /** Paise added so concurrent checkouts do not share one payable amount. */
  suffixPaise?: number;
  payeeName: string;
  payeeVpa: string;
  description: string;
  qrSvg: string;
  intents: { id: string; label: string; href: string }[];
  /** Present when a credit for this order is awaiting verification. */
  review?: { observedAt: string; amountPaise: number } | null;
  /** How the server will confirm this payment. Drives the copy below. */
  verification?: 'automatic_match' | 'reviewed_match';
  expiresAt: string;
  settledAt: string | null;
}

interface UpiStatus {
  available: boolean;
  autoApprove: boolean;
  verification: string;
}

type Phase = 'loading' | 'ready' | 'processing' | 'settled' | 'expired' | 'unavailable';

export default function UpiCheckoutPage() {
  const router = useRouter();
  const { toast } = useToast();
  const params = useSearchParams();
  const planId = params.get('planId');
  const coupon = params.get('coupon');
  /*
   * Exam-scoped plans cannot be bought without naming the exams they unlock,
   * so the selection made on the pricing page has to travel with the redirect.
   */
  const examKeys = params.getAll('examKey');

  const [phase, setPhase] = useState<Phase>('loading');
  const [order, setOrder] = useState<UpiOrder | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Create the order once per mount. The server reuses an open order of the same
     amount, so a refresh does not mint a second QR. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await get<UpiStatus>('/upi/status');
        if (cancelled) return;
        if (!status.available) {
          setPhase('unavailable');
          return;
        }
        if (!planId) {
          setPhase('unavailable');
          return;
        }
        const res = await post<{ order: UpiOrder }>('/upi/orders', {
          planId,
          ...(coupon ? { couponCode: coupon } : {}),
          ...(examKeys.length ? { examKeys } : {}),
        });
        if (cancelled) return;
        setOrder(res.order);
        setPhase(
          res.order.status === 'paid'
            ? 'settled'
            : res.order.status === 'processing'
              ? 'processing'
              : res.order.status === 'expired' || res.order.status === 'cancelled'
                ? 'expired'
                : 'ready',
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        toast((err as Error).message, 'error');
        setPhase('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, coupon, examKeys.join(','), router]);

  /* Countdown to expiry, computed from the server clock offset-free deadline. */
  useEffect(() => {
    if (!order || (phase !== 'ready' && phase !== 'processing')) return;
    const tick = () => {
      const ms = new Date(order.expiresAt).getTime() - Date.now();
      const secs = Math.max(0, Math.round(ms / 1000));
      setSecondsLeft(secs);
      if (secs === 0) setPhase('expired');
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [order, phase]);

  /*
   * Poll until the server says the money arrived. Running while `processing` too
   * is the point: a credit being verified is the likeliest order to settle next,
   * and without polling here the payer would have to reload to learn that access
   * was granted.
   */
  useEffect(() => {
    if (!order || (phase !== 'ready' && phase !== 'processing')) return;
    const orderId = order.id;

    /** One status read, shared by the interval and the tab-focus refresh. */
    async function refresh() {
      try {
        const res = await get<{ order: UpiOrder }>(`/upi/orders/${orderId}`);
        setOrder(res.order);
        if (res.order.status === 'paid') setPhase('settled');
        else if (res.order.status === 'processing') setPhase('processing');
        else if (res.order.status === 'expired' || res.order.status === 'cancelled') setPhase('expired');
      } catch {
        // A transient poll failure is not a payment failure; keep trying.
      }
    }

    pollRef.current = setInterval(() => void refresh(), 4000);

    /*
     * A phone that was put down mid-payment stops being polled by the browser
     * timer, so one refresh happens immediately when the tab is brought back.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [order?.id, phase]);

  async function cancel() {
    if (!order) return;
    setBusy(true);
    try {
      await post(`/upi/orders/${order.id}/cancel`, {});
      setPhase('expired');
    } catch {
      toast('Could not cancel the order.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function copyReference() {
    if (!order) return;
    void navigator.clipboard?.writeText(order.reference);
    toast('Reference copied', 'success');
  }

  if (phase === 'loading') {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4">
        <Spinner />
      </main>
    );
  }

  if (phase === 'unavailable' || (!planId && phase !== 'settled')) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold text-content-primary">UPI checkout is not open</h1>
          <p className="mt-3 text-sm text-content-secondary">
            Direct UPI collection is not configured right now. Card checkout on the pricing page is
            still available.
          </p>
          <Link href="/pricing" className="btn-primary mt-6 inline-flex">
            Back to plans
          </Link>
        </Card>
      </main>
    );
  }

  if (phase === 'settled') {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-2xl text-positive">
            ✓
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-content-primary">Payment received</h1>
          <p className="mt-2 text-sm text-content-secondary">
            Your plan is active. A receipt is on its way to your inbox.
          </p>
          {order && (
            <p className="mt-4 text-xs text-content-muted">
              Reference <span className="font-mono text-content-primary">{order.reference}</span>
            </p>
          )}
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/exams" className="btn-primary">
              Start practising
            </Link>
            <Link href="/history" className="btn-ghost">
              View billing history
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  if (phase === 'expired') {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold text-content-primary">This payment window closed</h1>
          <p className="mt-3 text-sm text-content-secondary">
            Nothing was charged. If you already transferred after it closed, the payment will be
            matched to you and you will be notified, otherwise no money has moved.
          </p>
          <Link href="/pricing" className="btn-primary mt-6 inline-flex">
            Choose a plan again
          </Link>
        </Card>
      </main>
    );
  }

  if (phase === 'processing') {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="p-8">
          <div className="flex items-center gap-3">
            <Spinner className="h-5 w-5" />
            <h1 className="text-xl font-semibold text-content-primary">Verifying your payment</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-content-secondary">
            We have received a transfer that matches this order and it is being checked before your
            plan is switched on. <strong className="text-content-primary">Do not pay again</strong> -
            a second transfer cannot be matched to the same order and would need a manual refund.
          </p>
          <p className="mt-3 text-sm text-content-secondary">
            This page updates by itself. You can leave it; your plan activates even if you close the
            tab.
          </p>
          {order && (
            <dl className="mt-6 space-y-2 rounded-xl bg-surface-sunken p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-content-secondary">Amount</dt>
                <dd className="font-semibold text-content-primary">{order.amountLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-content-secondary">Reference</dt>
                <dd className="font-mono text-content-primary">{order.reference}</dd>
              </div>
              {order.review?.observedAt && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-content-secondary">Seen</dt>
                  <dd className="text-content-primary">
                    {new Date(order.review.observedAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/pricing" className="btn-ghost">
              Back to plans
            </Link>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-content-muted">
            {order?.verification === 'automatic_match'
              ? 'Confirmation comes from the bank transfer alert for this account and is matched automatically.'
              : 'Confirmation comes from the bank transfer alert for this account and is checked by a person before your plan is activated.'}
          </p>
        </Card>
      </main>
    );
  }

  if (!order) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">Pay with UPI</h1>
          <p className="mt-1 text-sm text-content-secondary">{order.description}</p>
        </div>
        <Badge tone="accent">
          Expires in {minutes}:{secs.toString().padStart(2, '0')}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* QR */}
        <Card className="p-5">
          <div
            className="mx-auto w-full max-w-[288px] [&>svg]:h-auto [&>svg]:w-full"
            // Server-rendered SVG from our own QR encoder; no user input enters it.
            dangerouslySetInnerHTML={{ __html: order.qrSvg }}
            role="img"
            aria-label="UPI payment QR code"
          />
          <p className="mt-4 text-center text-sm text-content-secondary">
            Scan with any UPI app
          </p>
          <div className="mt-4 rounded-xl bg-surface-sunken p-3 text-center">
            <p className="text-xs uppercase tracking-wide text-content-muted">Amount</p>
            <p className="mt-1 text-2xl font-semibold text-content-primary">{order.amountLabel}</p>
            {/*
              Explain the odd paise. Without this the total looks like a pricing
              error rather than what it is: a per-payment amount that lets us tell
              two simultaneous checkouts apart. Only shown when there is a suffix.
            */}
            {typeof order.suffixPaise === 'number' && order.suffixPaise > 0 && order.baseAmountLabel ? (
              <p className="mt-1 text-xs text-content-muted">
                {order.baseAmountLabel} plus {order.suffixPaise} paise so this payment is uniquely yours
              </p>
            ) : null}
          </div>
        </Card>

        {/* Details + intents */}
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-content-primary">Pay to</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-content-secondary">Name</dt>
                <dd className="text-right font-medium text-content-primary">{order.payeeName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-content-secondary">UPI ID</dt>
                <dd className="break-all text-right font-mono text-content-primary">{order.payeeVpa}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-content-secondary">Reference</dt>
                <dd className="flex items-center gap-2">
                  <span className="font-mono text-content-primary">{order.reference}</span>
                  <button
                    type="button"
                    onClick={copyReference}
                    className="rounded-md px-2 py-1 text-xs text-accent hover:bg-surface-sunken"
                  >
                    Copy
                  </button>
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-content-muted">
              Pay exactly {order.amountLabel}, including the paise. This exact amount is reserved for
              your checkout, so it is matched to you and not to another payment. Keep it unchanged.
            </p>
          </Card>

          {order.intents.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-content-primary">Or open an app</h2>
              <p className="mt-1 text-xs text-content-muted">On a phone, tap to pay directly.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {order.intents.map((intent) => (
                  <a
                    key={intent.id}
                    href={intent.href}
                    className="flex min-h-[44px] items-center justify-center rounded-xl border border-surface-border px-3 py-3 text-sm font-medium text-content-primary transition hover:border-accent hover:text-accent"
                  >
                    {intent.label}
                  </a>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Spinner className="h-4 w-4" />
              <p className="text-sm text-content-secondary">
                Waiting for your payment. This page updates on its own.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost mt-4"
              onClick={() => void cancel()}
              disabled={busy}
            >
              Cancel this order
            </button>
          </Card>

          {/*
            Stated plainly, because the customer deserves the same honesty the
            admin dashboard shows: we learn about the transfer from the bank's
            alert, we do not query the bank's settlement ledger.
          */}
          <p className="px-1 text-xs leading-relaxed text-content-muted">
            Payments are confirmed from the bank&apos;s own transfer alert for this account. If your
            app shows the money left but this page has not updated, wait a minute and refresh before
            paying again.
          </p>
        </div>
      </div>
    </main>
  );
}
