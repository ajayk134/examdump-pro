'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type { Payment, Plan, Subscription, User } from '@/lib/types';
import { Alert, EmptyState, PremiumBadge, Spinner } from '@/components/ui';
import { IconCheck, IconSparkles } from '@/components/icons';
import { formatCurrency, formatDate } from '@/lib/format';

interface PlansResponse {
  plans: Plan[];
  paymentsEnabled: boolean;
  mockPayments: boolean;
}

interface MeResponse {
  subscription: Subscription | null;
  payments: Payment[];
  paymentsEnabled: boolean;
  mockPayments: boolean;
}

export default function PricingPage() {
  const { user, loading, refresh } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mockPayments, setMockPayments] = useState(true);
  const [coupon, setCoupon] = useState('');
  const [couponMsg, setCouponMsg] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await get<PlansResponse>('/subscriptions/plans');
    setPlans(data.plans);
    setMockPayments(data.mockPayments);
    if (user) {
      const mine = await get<MeResponse>('/subscriptions/me');
      setMe(mine);
    }
  }, [user]);

  useEffect(() => {
    void load().catch((err) => toast((err as Error).message, 'error'));
  }, [load, toast]);

  const validateCoupon = async (planId: string) => {
    if (!coupon.trim()) {
      setCouponMsg('');
      return;
    }
    try {
      const result = await post<{ valid: boolean; message: string; percentOff: number }>('/coupons/validate', { code: coupon, planId });
      setCouponMsg(result.valid ? `${result.percentOff}% discount applied.` : result.message);
    } catch (err) {
      setCouponMsg((err as Error).message);
    }
  };

  const subscribe = async (plan: Plan) => {
    if (!user) return;
    setSelectedPlan(plan.planId);
    setBusy(true);
    try {
      const billingCycle = plan.yearlyPrice > 0 ? 'yearly' : 'monthly';
      const result = await post<{ user: User; note: string }>('/subscriptions', {
        planId: plan.planId,
        billingCycle,
        couponCode: coupon.trim() || undefined,
      });
      if (result.user) refresh();
      toast('Premium activated. Enjoy unlimited access!', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
      setSelectedPlan(null);
    }
  };

  const cancel = async () => {
    if (!me?.subscription) return;
    setBusy(true);
    try {
      await post(`/subscriptions/${me.subscription._id}/cancel`);
      toast('Subscription will end at the current period.', 'info');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !plans) return <Spinner label="Loading plans…" />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="text-center">
        <p className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-400/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-500 dark:text-brand-300">
          <IconSparkles width={14} height={14} /> Simple, honest pricing
        </p>
        <h1 className="text-4xl font-black tracking-tight">Invest in passing first time</h1>
        <p className="mx-auto mt-3 max-w-xl text-content-muted">
          Start free with 5 questions per exam. Upgrade for unlimited questions, mock exams, AI explanations and analytics.
        </p>
      </header>

      {mockPayments && !me?.paymentsEnabled ? (
        <Alert tone="info">
          Payment processing is not connected yet. Checkout is <b>simulated</b> — no charge will be made, but Premium features activate instantly so you can test the full experience.
        </Alert>
      ) : null}

      {me?.subscription ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="flex items-center gap-2 font-semibold">Current subscription <PremiumBadge /></p>
            <p className="mt-1 text-sm text-content-muted">
              {me.subscription.planId} · {me.subscription.billingCycle} · renews/ends {formatDate(me.subscription.currentPeriodEnd)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/profile" className="btn-secondary">Manage</Link>
            {!me.subscription.cancelAtPeriodEnd ? (
              <button onClick={cancel} className="btn-ghost" disabled={busy}>Cancel</button>
            ) : (
              <span className="badge">Cancels at period end</span>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        {plans.map((plan) => {
          const isYearly = plan.yearlyPrice > 0;
          const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
          const highlighted = isYearly;
          return (
            <div key={plan._id} className={`card relative p-6 ${highlighted ? 'border-brand-400/60 ring-1 ring-brand-400/30' : ''}`}>
              {highlighted ? (
                <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 px-3 py-1 text-xs font-bold text-slate-950">Best value</span>
              ) : null}
              <h2 className="text-xl font-bold">{plan.name}</h2>
              <p className="mt-1 min-h-10 text-sm text-content-muted">{plan.description}</p>
              <div className="mt-4 flex items-end gap-1">
                <span className="text-4xl font-black tracking-tight">{formatCurrency(price, plan.currency)}</span>
                <span className="mb-1 text-sm text-content-muted">/{isYearly ? 'year' : 'month'}</span>
              </div>
              <ul className="mt-5 flex flex-col gap-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <IconCheck width={16} height={16} className="mt-0.5 text-emerald-500" />
                    <span className="text-content-secondary">{feature}</span>
                  </li>
                ))}
              </ul>
              {user ? (
                <button
                  onClick={() => subscribe(plan)}
                  className={`mt-6 w-full py-3 ${highlighted ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={busy || (user.premiumActive && me?.subscription?.planId === plan.planId)}
                >
                  {user.premiumActive && me?.subscription?.planId === plan.planId
                    ? 'Current plan'
                    : busy && selectedPlan === plan.planId
                      ? 'Activating…'
                      : 'Choose plan'}
                </button>
              ) : (
                <Link href="/register" className={`mt-6 w-full py-3 ${highlighted ? 'btn-primary' : 'btn-secondary'}`}>Create account</Link>
              )}
            </div>
          );
        })}
      </div>

      <div className="card p-5">
        <label htmlFor="coupon" className="label">Have a coupon?</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="coupon" className="input" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="WELCOME20" />
          <button className="btn-secondary" onClick={() => plans[0] && validateCoupon(plans[0].planId)} disabled={!coupon.trim()}>Apply</button>
        </div>
        {couponMsg ? <p className="mt-2 text-sm text-content-secondary">{couponMsg}</p> : null}
      </div>

      {me?.payments && me.payments.length > 0 ? (
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Payment history</h2>
          <ul className="divide-y divide-surface-border">
            {me.payments.map((payment) => (
              <li key={payment._id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium">{payment.description}</p>
                  <p className="text-xs text-content-muted">{formatDate(payment.createdAt)} · {payment.reference}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatCurrency(payment.amount, payment.currency)}</p>
                  <p className="text-xs text-content-muted">{payment.status}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { q: 'Can I cancel any time?', a: 'Yes. Cancel from your profile and Premium stays active until the end of the period.' },
          { q: 'Do you charge my card today?', a: 'No payment provider is connected yet. Checkout is simulated while we finish payment integration.' },
          { q: 'Is my progress saved?', a: 'Yes. Your attempts, bookmarks, notes and analytics are stored securely in your account.' },
        ].map((item) => (
          <div key={item.q} className="card p-5">
            <h3 className="font-semibold">{item.q}</h3>
            <p className="mt-2 text-sm text-content-muted">{item.a}</p>
          </div>
        ))}
      </div>

      {!user ? <EmptyState title="Create a free account to get started" action={<Link href="/register" className="btn-primary">Sign up free</Link>} /> : null}
    </div>
  );
}