'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type { AccessGrant, Entitlements, Exam, Paginated, Payment, Plan, Subscription, User } from '@/lib/types';
import { Alert, EmptyState, PremiumBadge, Spinner } from '@/components/ui';
import { IconCheck, IconSparkles } from '@/components/icons';
import { formatDate, formatMoneyMinor } from '@/lib/format';

interface PlansResponse {
  plans: Plan[];
  paymentsEnabled: boolean;
  mockPayments: boolean;
  currency: string;
}

interface MeResponse {
  subscription: Subscription | null;
  subscriptions: Subscription[];
  payments: Payment[];
  grants: AccessGrant[];
  entitlements: Entitlements;
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
  const [examQuery, setExamQuery] = useState('');
  const [examResults, setExamResults] = useState<Exam[]>([]);
  const [exam, setExam] = useState<Exam | null>(null);

  const singlePlans = useMemo(() => (plans ?? []).filter((p) => p.scope === 'single'), [plans]);
  const needsExam = useMemo(
    () => plans?.some((p) => p.scope === 'single' && p.id === selectedPlan),
    [plans, selectedPlan],
  );

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

  useEffect(() => {
    if (!examQuery.trim()) {
      setExamResults([]);
      return;
    }
    const timer = setTimeout(() => {
      get<Paginated<Exam>>(`/exams/search?q=${encodeURIComponent(examQuery)}&pageSize=6`)
        .then((r) => setExamResults(r.items))
        .catch(() => setExamResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [examQuery]);

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
    if (plan.scope === 'single' && !exam) {
      setSelectedPlan(plan.id);
      toast('Choose the exam you want to unlock first.', 'info');
      return;
    }
    setSelectedPlan(plan.id);
    setBusy(true);
    try {
      const result = await post<{ user: User; note: string }>('/subscriptions', {
        planId: plan.id,
        ...(plan.scope === 'single' && exam ? { examKey: exam.key, providerId: exam.providerId } : {}),
        couponCode: coupon.trim() || undefined,
      });
      if (result.user) refresh();
      toast('Access activated. Enjoy unlimited practise!', 'success');
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
      await post(`/subscriptions/${me.subscription.id}/cancel`);
      toast('Subscription will end at the current period.', 'info');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !plans) return <Spinner label="Loading plans..." />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="text-center">
        <p className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-400/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-500 dark:text-brand-300">
          <IconSparkles width={14} height={14} /> Simple, honest pricing in ₹
        </p>
        <h1 className="text-4xl font-black tracking-tight">Invest in passing first time</h1>
        <p className="mx-auto mt-3 max-w-xl text-content-muted">
          Start free with 5 questions per exam. Pick one exam or unlock everything for as long as you need.
        </p>
      </header>

      {mockPayments && !me?.paymentsEnabled ? (
        <Alert tone="info">
          Payment processing is not connected yet. Checkout is <b>simulated</b> — no charge will be made, but access activates instantly so you can test the full experience.
        </Alert>
      ) : null}

      {me?.subscription ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="flex items-center gap-2 font-semibold">Current access <PremiumBadge /></p>
            <p className="mt-1 text-sm text-content-muted">
              {me.subscription.scope === 'all' ? 'All exams' : me.subscription.examKey} · {me.subscription.planId} · ends {formatDate(me.subscription.currentPeriodEnd)}
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

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const highlight = plan.id === 'all-365';
          return (
            <div key={plan.id} className={`card relative flex flex-col p-6 ${highlight ? 'border-brand-400/60 ring-1 ring-brand-400/30' : ''}`}>
              {highlight ? (
                <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 px-3 py-1 text-xs font-bold text-slate-950">Best value</span>
              ) : null}
              {plan.earlyAccess ? (
                <span className="badge-premium mb-2 self-start text-xs">Early access</span>
              ) : null}
              <h2 className="text-lg font-bold">{plan.name}</h2>
              <p className="mt-1 min-h-10 text-sm text-content-muted">{plan.description}</p>
              <div className="mt-4 flex items-end gap-1">
                <span className="text-3xl font-black tracking-tight">{formatMoneyMinor(plan.priceMinor, plan.currency)}</span>
                <span className="mb-1 text-sm text-content-muted">/ {plan.durationDays} days</span>
              </div>
              <ul className="mt-5 flex flex-1 flex-col gap-2 text-sm">
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
                  className={`mt-6 w-full py-3 ${highlight ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={busy || (me?.subscription?.planId === plan.id && !me.subscription.cancelAtPeriodEnd)}
                >
                  {me?.subscription?.planId === plan.id && !me.subscription.cancelAtPeriodEnd
                    ? 'Current plan'
                    : busy && selectedPlan === plan.id
                      ? 'Activating...'
                      : 'Choose plan'}
                </button>
              ) : (
                <Link href="/register" className={`mt-6 w-full py-3 text-center ${highlight ? 'btn-primary' : 'btn-secondary'}`}>Create account</Link>
              )}
            </div>
          );
        })}
      </div>

      {singlePlans.length > 0 ? (
        <div className="card p-5">
          <label className="label" htmlFor="exam-picker">Unlocking a single exam? Choose it here</label>
          <input
            id="exam-picker"
            className="input"
            placeholder="Search exams (e.g. 200-301, AWS)..."
            value={examQuery}
            onChange={(e) => setExamQuery(e.target.value)}
          />
          {exam ? (
            <p className="mt-2 text-sm text-emerald-500">Selected: <b>{exam.title}</b> ({exam.code})</p>
          ) : null}
          {examResults.length > 0 ? (
            <ul className="mt-3 divide-y divide-surface-border">
              {examResults.map((e) => (
                <li key={`${e.providerId}-${e.key}`} className="flex items-center justify-between py-2 text-sm">
                  <span>{e.title} <span className="text-content-muted">· {e.providerTitle} · {e.questionCount} Q</span></span>
                  <button className="btn-ghost text-xs" onClick={() => { setExam(e); setExamResults([]); setExamQuery(e.title); }}>Select</button>
                </li>
              ))}
            </ul>
          ) : null}
          {needsExam && !exam ? <p className="mt-2 text-xs text-amber-500">Select an exam above to continue.</p> : null}
        </div>
      ) : null}

      <div className="card p-5">
        <label htmlFor="coupon" className="label">Have a coupon?</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="coupon" className="input" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="WELCOME20" />
          <button className="btn-secondary" onClick={() => plans[0] && validateCoupon(plans[0].id)} disabled={!coupon.trim()}>Apply</button>
        </div>
        {couponMsg ? <p className="mt-2 text-sm text-content-secondary">{couponMsg}</p> : null}
      </div>

      {me?.payments && me.payments.length > 0 ? (
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Payment history</h2>
          <ul className="divide-y divide-surface-border">
            {me.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium">{payment.description}</p>
                  <p className="text-xs text-content-muted">{formatDate(payment.createdAt)} · {payment.providerRef}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatMoneyMinor(payment.amountMinor, payment.currency)}</p>
                  <p className="text-xs text-content-muted">{payment.status}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {me?.grants && me.grants.length > 0 ? (
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Granted access</h2>
          <ul className="divide-y divide-surface-border">
            {me.grants.map((grant) => (
              <li key={grant.id} className="flex items-center justify-between py-2 text-sm">
                <span>{grant.scope === 'all' ? 'All exams' : grant.examKey} · {grant.source}</span>
                <span className="text-xs text-content-muted">{grant.expiresAt ? `expires ${formatDate(grant.expiresAt)}` : 'no expiry'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { q: 'Can I buy just one exam?', a: 'Yes. Choose the One Exam plan and pick the exam you are preparing for.' },
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
