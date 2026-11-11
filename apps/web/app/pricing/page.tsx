'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type {
  AccessGrant,
  CheckoutSession,
  Entitlements,
  Exam,
  Paginated,
  Plan,
  PlanQuote,
  Payment,
  Subscription,
  User,
} from '@/lib/types';
import { Alert, EmptyState, PremiumBadge, Spinner } from '@/components/ui';
import { IconCheck, IconSparkles, IconX } from '@/components/icons';
import { formatDate, formatMoneyMinor } from '@/lib/format';

interface PlansResponse {
  plans: Plan[];
  paymentsEnabled: boolean;
  mockPayments: boolean;
  freeQuestionsPerExam: number;
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

const FREE_FEATURES = [
  '5 questions per exam, every exam',
  '1 timed mock exam per day',
  '20 random practice questions per day',
  'Progress tracking and streaks',
];

export default function PricingPage() {
  const { user, loading, refresh } = useAuth();
  const { toast } = useToast();

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [, setMockPayments] = useState(true);
  const [freeQuestions, setFreeQuestions] = useState(5);

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<PlanQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);

  const [examQuery, setExamQuery] = useState('');
  const [examResults, setExamResults] = useState<Exam[]>([]);
  const [examSearching, setExamSearching] = useState(false);
  const [selectedExams, setSelectedExams] = useState<Exam[]>([]);

  const plan = useMemo(() => plans?.find((p) => p.id === selectedPlan) ?? null, [plans, selectedPlan]);
  const quota = plan?.scope === 'all' ? 0 : plan?.scope === 'multi' ? plan.examQuota || 3 : 1;
  const needsExams = plan ? plan.scope !== 'all' : false;

  const load = useCallback(async () => {
    const data = await get<PlansResponse>('/subscriptions/plans');
    setPlans(data.plans);
    setPaymentsEnabled(data.paymentsEnabled);
    setMockPayments(data.mockPayments);
    setFreeQuestions(data.freeQuestionsPerExam ?? 5);
    if (user) setMe(await get<MeResponse>('/subscriptions/me'));
  }, [user]);

  useEffect(() => {
    void load().catch((err) => toast((err as Error).message, 'error'));
  }, [load, toast]);

  // Live server-side quote whenever the plan / exams / coupon change.
  useEffect(() => {
    if (!selectedPlan) {
      setQuote(null);
      return;
    }
    if (needsExams && selectedExams.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void post<PlanQuote>('/payments/quote', {
        planId: selectedPlan,
        examKeys: selectedExams.map((e) => e.key),
        ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
      })
        .then((data) => {
          if (!cancelled) setQuote(data);
        })
        .catch((err) => {
          if (!cancelled) {
            setQuote(null);
            toast((err as Error).message, 'error');
          }
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedPlan, selectedExams, coupon, needsExams, toast]);

  useEffect(() => {
    if (!needsExams || examQuery.trim().length < 2) {
      setExamResults([]);
      return;
    }
    let cancelled = false;
    setExamSearching(true);
    const timer = setTimeout(() => {
      void get<Paginated<Exam>>(`/exams?search=${encodeURIComponent(examQuery.trim())}&pageSize=8`)
        .then((data) => {
          if (!cancelled) setExamResults(data.items);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setExamSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [examQuery, needsExams]);

  function toggleExam(exam: Exam) {
    setSelectedExams((current) => {
      if (current.some((e) => e.key === exam.key)) return current.filter((e) => e.key !== exam.key);
      if (quota > 0 && current.length >= quota) {
        toast(`This pass unlocks up to ${quota} exam${quota > 1 ? 's' : ''}.`, 'error');
        return current;
      }
      return [...current, exam];
    });
  }

  async function startCheckout() {
    if (!user) {
      window.location.href = `/login?next=${encodeURIComponent('/pricing')}`;
      return;
    }
    if (!selectedPlan) return;
    if (needsExams && selectedExams.length === 0) {
      toast('Choose an exam to unlock first.', 'error');
      return;
    }
    setBusy(true);
    try {
      if (paymentsEnabled) {
        const session = await post<CheckoutSession>('/payments/checkout', {
          planId: selectedPlan,
          examKeys: selectedExams.map((e) => e.key),
          ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
          requestId: `web_${Date.now().toString(36)}`,
        });
        if (session.checkoutUrl) {
          window.location.href = session.checkoutUrl;
          return;
        }
        toast('Checkout could not be opened. Please try again.', 'error');
        return;
      }

      // No gateway configured: only ever allowed off production, and the API
      // labels the resulting payment as simulated.
      await post('/payments/mock-activate', {
        planId: selectedPlan,
        examKeys: selectedExams.map((e) => e.key),
        ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
      });
      toast('Plan activated (test mode - no payment was taken).', 'success');
      await refresh();
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const activePlanId = me?.subscription?.planId ?? null;

  return (
    <div className="space-y-12">
      <header className="mx-auto max-w-3xl text-center">
        <span className="badge mx-auto mb-4">Pricing</span>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Pass once. Practice <span className="text-gradient">without limits</span>.
        </h1>
        <p className="mt-3 text-content-secondary">
          Every exam has {freeQuestions} free questions. Unlock full question banks, timed mocks, AI
          explanations and analytics with a pass that fits how many exams you are taking.
        </p>
        {me?.entitlements.expiresAt ? (
          <p className="mt-3 text-sm text-content-muted">
            Your current access runs until{' '}
            <strong className="text-content-primary">{formatDate(me.entitlements.expiresAt)}</strong>.
          </p>
        ) : null}
      </header>

      {!paymentsEnabled ? (
        <Alert tone="warning" title="Live payments are not enabled on this environment">
          Card/UPI checkout needs the payment gateway keys configured on the server. Until then plan
          activation is simulated for testing only and no money is charged.
        </Alert>
      ) : null}

      {loading || !plans ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          <PlanCard
            id="free"
            name="Free"
            price="₹0"
            cadence="forever"
            description={`${freeQuestions} questions per exam, unlimited browsing.`}
            features={FREE_FEATURES}
            active={!me?.entitlements.allAccess && (me?.entitlements.examKeys.length ?? 0) === 0}
            current={!me?.subscription}
            cta={
              <Link href={user ? '/browse' : '/register'} className="btn-secondary w-full">
                {user ? 'Browse exams' : 'Start free'}
              </Link>
            }
          />
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              id={p.id}
              name={p.name}
              price={formatMoneyMinor(p.priceMinor, p.currency)}
              cadence={p.durationDays >= 365 ? 'per year' : `per ${p.durationDays} days`}
              description={p.description}
              features={p.features}
              highlight={p.highlight}
              badge={p.badge ?? undefined}
              active={activePlanId === p.id}
              current={activePlanId === p.id}
              cta={
                <button
                  type="button"
                  className={p.highlight ? 'btn-primary w-full' : 'btn-secondary w-full'}
                  onClick={() => {
                    setSelectedPlan(p.id);
                    setSelectedExams([]);
                    setExamQuery('');
                    setQuote(null);
                  }}
                >
                  {activePlanId === p.id ? 'Renew or extend' : 'Choose ' + p.name.split('·')[0]!.trim()}
                </button>
              }
            />
          ))}
        </div>
      )}

      {plan ? (
        <section className="card-elevated animate-fade-in p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Configure your {plan.name}</h2>
              <p className="mt-1 text-sm text-content-secondary">
                {plan.scope === 'all'
                  ? 'Every exam in the catalogue is unlocked for the whole period.'
                  : plan.scope === 'multi'
                    ? `Pick up to ${plan.examQuota || 3} exams. You can change them later.`
                    : 'Pick the one exam this pass unlocks.'}
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setSelectedPlan(null)}>
              <IconX className="h-4 w-4" /> Close
            </button>
          </div>

          {needsExams ? (
            <div className="mt-5 space-y-3">
              <label className="label" htmlFor="exam-search">
                Search exams
              </label>
              <input
                id="exam-search"
                className="input"
                placeholder="e.g. AWS Solutions Architect, AZ-104, CCNA"
                value={examQuery}
                onChange={(e) => setExamQuery(e.target.value)}
              />
              {selectedExams.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedExams.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      className="badge border-brand-400/50 bg-brand-100/60 text-brand-800 hover:bg-brand-200/60 dark:bg-brand-500/15 dark:text-brand-200"
                      onClick={() => toggleExam(e)}
                      title="Remove"
                    >
                      {e.code} · {e.providerTitle}
                      <IconX className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-content-muted">
                  {quota > 0 ? `0 of ${quota} selected` : 'No exams selected yet'}
                </p>
              )}
              {examQuery.trim().length >= 2 ? (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-surface-border p-2">
                  {examSearching && examResults.length === 0 ? (
                    <div className="flex justify-center py-6">
                      <Spinner />
                    </div>
                  ) : examResults.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-content-muted">No exams matched.</p>
                  ) : (
                    examResults.map((e) => {
                      const picked = selectedExams.some((s) => s.key === e.key);
                      return (
                        <button
                          key={e.key}
                          type="button"
                          onClick={() => toggleExam(e)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                            picked
                              ? 'bg-brand-100/70 text-brand-900 dark:bg-brand-500/15 dark:text-brand-100'
                              : 'hover:bg-surface-overlay'
                          }`}
                        >
                          <span>
                            <strong className="font-semibold">{e.code}</strong>{' '}
                            <span className="text-content-secondary">{e.title}</span>
                            <span className="ml-2 text-xs text-content-muted">{e.providerTitle}</span>
                          </span>
                          <span className="text-xs text-content-muted">{e.questionCount} q</span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className="label" htmlFor="coupon">
                Coupon code (optional)
              </label>
              <input
                id="coupon"
                className="input uppercase"
                placeholder="SAVE20"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              />
            </div>
            <div className="text-right">
              {quoting ? (
                <Spinner />
              ) : quote ? (
                <>
                  <p className="text-2xl font-bold">{formatMoneyMinor(quote.totalMinor, quote.currency)}</p>
                  {quote.discountMinor > 0 ? (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {formatMoneyMinor(quote.discountMinor, quote.currency)} off with {quote.couponCode}
                    </p>
                  ) : (
                    <p className="text-xs text-content-muted">Inclusive of all taxes</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-content-muted">Select exams to see the total</p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !quote || (needsExams && selectedExams.length === 0)}
              onClick={() => void startCheckout()}
            >
              <IconSparkles className="h-4 w-4" />
              {paymentsEnabled ? 'Continue to payment' : 'Activate (test mode)'}
            </button>
            {!paymentsEnabled ? (
              <span className="text-xs text-content-muted">No charge is made in test mode.</span>
            ) : (
              <span className="text-xs text-content-muted">
                Cards, UPI and netbanking via HyperSwitch.
              </span>
            )}
          </div>
        </section>
      ) : null}

      {me ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Your access</h2>
          {me.subscriptions.length === 0 ? (
            <EmptyState title="No active pass" description="Choose a pass above to unlock full exam access." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {me.subscriptions.map((s) => (
                <div key={s.id} className="card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{s.planId}</p>
                      <p className="text-xs text-content-muted">
                        {s.scope === 'all'
                          ? 'All exams'
                          : (s.examKeys && s.examKeys.length > 0
                              ? s.examKeys.join(', ')
                              : (s.examKey ?? 'One exam'))}
                      </p>
                    </div>
                    {s.status === 'active' ? <PremiumBadge /> : <span className="badge">{s.status}</span>}
                  </div>
                  <p className="mt-2 text-sm text-content-secondary">
                    {s.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} on {formatDate(s.currentPeriodEnd)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {me.payments.length > 0 ? (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-overlay text-left text-xs uppercase tracking-wide text-content-muted">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {me.payments.slice(0, 10).map((p) => (
                    <tr key={p.id} className="border-t border-surface-border">
                      <td className="px-4 py-2 text-content-secondary">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-2">{p.description || 'Subscription'}</td>
                      <td className="px-4 py-2">
                        <span className="badge">{p.status}</span>
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {formatMoneyMinor(p.amountMinor, p.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-surface-border px-4 py-3 text-right">
                <Link href="/profile#invoices" className="link text-sm">
                  View invoices
                </Link>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Common questions</h2>
        <dl className="mt-4 grid gap-5 md:grid-cols-2">
          {[
            {
              q: 'How do exam slots work on the Multi-Exam Pass?',
              a: 'Pick up to three exams at checkout. You can move a slot to a different exam at any time from your profile without losing the remaining days.',
            },
            {
              q: 'What happens when my pass ends?',
              a: 'Your account falls back to the free tier: 5 questions per exam, one mock per day, and all your history, bookmarks and notes are kept.',
            },
            {
              q: 'Can I upgrade mid-cycle?',
              a: 'Yes. Buying a bigger pass immediately supersedes the overlapping access and starts a fresh period from the purchase date.',
            },
            {
              q: 'Do you offer refunds?',
              a: 'Refunds are handled by our team. Contact support with your payment reference from the profile page and we will review it.',
            },
          ].map((item) => (
            <div key={item.q}>
              <dt className="font-medium">{item.q}</dt>
              <dd className="mt-1 text-sm text-content-secondary">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function PlanCard(props: {
  id: string;
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: React.ReactNode;
  highlight?: boolean;
  badge?: string;
  active?: boolean;
  current?: boolean;
}) {
  return (
    <div
      className={`card relative flex flex-col p-5 ${
        props.highlight ? 'border-brand-400/70 ring-2 ring-brand-400/30' : ''
      }`}
    >
      {props.badge ? (
        <span className="absolute -top-3 left-5 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow">
          {props.badge}
        </span>
      ) : null}
      <p className="text-sm font-semibold uppercase tracking-wide text-content-muted">{props.name}</p>
      <p className="mt-2 text-2xl font-bold">{props.price}</p>
      <p className="text-xs text-content-muted">{props.cadence}</p>
      <p className="mt-3 text-sm text-content-secondary">{props.description}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm">
        {props.features.map((f) => (
          <li key={f} className="flex gap-2">
            <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            <span className="text-content-secondary">{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        {props.current ? (
          <p className="mb-2 text-center text-xs font-medium text-brand-600 dark:text-brand-300">
            Current plan
          </p>
        ) : null}
        {props.cta}
      </div>
    </div>
  );
}
