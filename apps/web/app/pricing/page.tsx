'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
} from '@/lib/types';
import { Alert, EmptyState, PremiumBadge, Spinner, TableScroll } from '@/components/ui';
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconGrid,
  IconSparkles,
  IconX,
} from '@/components/icons';
import { cn, formatDate, formatMoneyMinor } from '@/lib/format';

interface PlansResponse {
  plans: Plan[];
  paymentsEnabled: boolean;
  mockPayments: boolean;
  freeQuestionsPerExam: number;
  currency: string;
  youpi?: { enabled: boolean; configured: boolean; available: boolean };
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

const FAQ_ITEMS = [
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
];

/** Human duration for the days the API returns. No rounding beyond 365-day years. */
function durationLabel(days: number): string {
  if (days >= 365 && days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`;
  return `${days} days`;
}

/** Mirror of the checkout quota rules used for exam selection. */
function quotaOf(plan: Plan): number {
  return plan.scope === 'all' ? 0 : plan.scope === 'multi' ? plan.examQuota || 3 : 1;
}

function quotaLabel(quota: number): string {
  if (quota <= 0) return 'Every exam';
  return quota === 1 ? '1 exam' : `Up to ${quota} exams`;
}

export default function PricingPage() {
  const { user, loading, refresh } = useAuth();
  const { toast } = useToast();

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [youpiAvailable, setYoupiAvailable] = useState(false);
  const [mockPayments, setMockPayments] = useState(false);
  const [freeQuestions, setFreeQuestions] = useState(5);

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<PlanQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const [examQuery, setExamQuery] = useState('');
  const [examResults, setExamResults] = useState<Exam[]>([]);
  const [examSearching, setExamSearching] = useState(false);
  const [selectedExams, setSelectedExams] = useState<Exam[]>([]);

  const plan = useMemo(() => plans?.find((p) => p.id === selectedPlan) ?? null, [plans, selectedPlan]);
  const quota = plan?.scope === 'all' ? 0 : plan?.scope === 'multi' ? plan.examQuota || 3 : 1;
  const needsExams = plan ? plan.scope !== 'all' : false;
  const checkoutAvailable = paymentsEnabled || youpiAvailable || mockPayments;

  const load = useCallback(async () => {
    const data = await get<PlansResponse>('/subscriptions/plans');
    setPlans(data.plans);
    setPaymentsEnabled(data.paymentsEnabled);
    setYoupiAvailable(Boolean(data.youpi?.available));
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
      void get<Paginated<Exam>>(
        `/exams/search?q=${encodeURIComponent(examQuery.trim())}&pageSize=8`,
      )
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

  /** Selecting a pass always starts the exam picker from a clean slate. */
  function selectPlan(planId: string) {
    setSelectedPlan(planId);
    setSelectedExams([]);
    setExamQuery('');
    setQuote(null);
  }

  async function startCheckout() {
    if (!checkoutAvailable) return;
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
      if (youpiAvailable) {
        // UPI checkout on YouPI-PG. The API refuses (503) unless both the
        // deployment-wide payment switch and the YouPI switch are on.
        const session = await post<CheckoutSession>('/payments/pay/youpi/checkout', {
          planId: selectedPlan,
          examKeys: selectedExams.map((e) => e.key),
          ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
        });
        if (session.checkoutUrl) {
          window.location.href = session.checkoutUrl;
          return;
        }
        toast('Checkout could not be opened. Please try again.', 'error');
        return;
      }

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
  const currency = plans?.[0]?.currency ?? 'INR';

  /*
   * Feature comparison derived from the plans the API returned. The union of
   * every plan's feature strings becomes the rows, so nothing is invented —
   * a tick only ever reflects a string the plan actually advertises.
   */
  const comparison = useMemo(() => {
    if (!plans || plans.length === 0) return null;
    const columns = [
      { id: 'free', name: 'Free', features: new Set(FREE_FEATURES) },
      ...plans.map((p) => ({ id: p.id, name: p.name, features: new Set(p.features) })),
    ];
    const rows: string[] = [];
    for (const column of columns) {
      for (const feature of column.features) {
        if (!rows.includes(feature)) rows.push(feature);
      }
    }
    return { columns, rows };
  }, [plans]);

  const payLabel = paymentsEnabled || youpiAvailable
    ? 'Continue to payment'
    : mockPayments
      ? 'Activate (test mode)'
      : 'Checkout unavailable';

  const nextStep = !checkoutAvailable
    ? 'Payments are not enabled on this deployment.'
    : youpiAvailable
      ? 'You will be redirected to the secure YouPI-PG UPI checkout. Access is granted only after independent bank-statement reconciliation.'
      : !paymentsEnabled
        ? 'Test mode: the pass activates immediately and no money is charged.'
        : 'You will be redirected to the secure HyperSwitch checkout to pay by card, UPI or netbanking.';

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border bg-surface-raised p-5 shadow-sm sm:p-7">
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-16 h-64" />
        <div aria-hidden="true" className="orb -right-16 -top-20 h-56 w-56 bg-accent-2/20" />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <span className="badge badge-accent mb-3">
              <IconSparkles width={13} height={13} /> Pricing
            </span>
            <h1 className="display-2 max-w-2xl text-balance">
              Pass once. Practice <span className="gradient-text">without limits</span>.
            </h1>
            <p className="body-text mt-2.5 max-w-2xl text-pretty text-base">
              Every exam has {freeQuestions} free questions. Unlock full question banks, timed mocks, AI
              explanations and analytics with a pass that fits how many exams you are taking.
            </p>
          </div>
          {me?.entitlements.expiresAt ? (
            <p className="caption shrink-0 sm:max-w-[15rem] sm:text-right">
              Your current access runs until{' '}
              <strong className="text-content-primary">{formatDate(me.entitlements.expiresAt)}</strong>.
            </p>
          ) : null}
        </div>

        <ol className="relative mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {['Choose a pass', 'Add exams if needed', 'Pay'].map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-overlay px-2.5 py-1 text-[0.6875rem] font-semibold text-content-secondary">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-accent/15 font-display text-[0.625rem] font-bold text-accent">
                  {index + 1}
                </span>
                {label}
              </span>
              {index < 2 ? (
                <span aria-hidden="true" className="text-content-muted">
                  ·
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </header>

      {plans && !paymentsEnabled && !youpiAvailable ? (
        <Alert tone="warning" title="Live payments are not enabled on this environment">
          {mockPayments
            ? 'Plan activation is simulated for testing only and no money is charged.'
            : 'No payment method is available on this deployment yet.'}
        </Alert>
      ) : null}

      {loading || !plans ? (
        <div className="panel-lg flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-6">
          <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
            <section id="plans" aria-labelledby="plans-heading" className="scroll-mt-24">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow mb-1">Step 1</p>
                  <h2 id="plans-heading" className="heading-1">
                    Choose your pass
                  </h2>
                </div>
                <p className="caption hidden shrink-0 text-right sm:block">Prices in {currency}</p>
              </div>

              <fieldset className="min-w-0">
                <legend className="sr-only">Passes</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FreePlanCard
                    currency={currency}
                    freeQuestions={freeQuestions}
                    signedIn={Boolean(user)}
                    current={me ? !me.subscription : false}
                  />
                  {plans.map((p) => (
                    <PaidPlanCard
                      key={p.id}
                      plan={p}
                      selected={selectedPlan === p.id}
                      current={activePlanId === p.id}
                      onSelect={selectPlan}
                    />
                  ))}
                </div>
              </fieldset>

              <p className="caption mt-2.5">
                All prices are shown in the plan currency. Taxes, where applicable, are included at checkout.
              </p>
            </section>
            {plan ? (
              <section id="exams" aria-labelledby="exams-heading" className="panel scroll-mt-24 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow mb-1">Step 2</p>
                    <h2 id="exams-heading" className="heading-1">
                      {needsExams ? 'Choose the exams this pass unlocks' : 'Every exam is included'}
                    </h2>
                    <p className="body-text mt-1.5 max-w-xl text-pretty">
                      {plan.scope === 'all'
                        ? 'Every exam in the catalogue is unlocked for the whole period.'
                        : plan.scope === 'multi'
                          ? `Pick up to ${plan.examQuota || 3} exams. You can change them later.`
                          : 'Pick the one exam this pass unlocks.'}
                    </p>
                  </div>
                  <div className="flex max-w-full flex-wrap items-center gap-2">
                    <span className="badge">{durationLabel(plan.durationDays)}</span>
                    <span className="badge">{quotaLabel(quota)}</span>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setSelectedPlan(null)}>
                      <IconX className="h-4 w-4" /> Change pass
                    </button>
                  </div>
                </div>

                {needsExams ? (
                  <div className="mt-4 space-y-3">
                    <label className="label" htmlFor="exam-search">
                      Search exams
                    </label>
                    <input
                      id="exam-search"
                      name="exam-search"
                      type="search"
                      className="input"
                      placeholder="e.g. AWS Solutions Architect, AZ-104, CCNA"
                      value={examQuery}
                      onChange={(e) => setExamQuery(e.target.value)}
                      aria-describedby="exam-search-help"
                      autoComplete="off"
                    />
                    {selectedExams.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedExams.map((e) => (
                          <button
                            key={e.key}
                            type="button"
                            className="chip max-w-full gap-2 whitespace-normal border-accent/40 bg-accent/10 text-left text-content-primary hover:bg-accent/15"
                            onClick={() => toggleExam(e)}
                            aria-label={`Remove ${e.code}`}
                          >
                            <span className="min-w-0 break-words">
                              {e.code} · {e.providerTitle}
                            </span>
                            <IconX className="h-3.5 w-3.5 shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <p id="exam-search-help" className="caption" role="status" aria-live="polite">
                      {selectedExams.length > 0
                        ? quota > 0
                          ? `${selectedExams.length} of ${quota} selected`
                          : `${selectedExams.length} selected`
                        : quota > 0
                          ? `0 of ${quota} selected`
                          : 'No exams selected yet'}
                    </p>
                    {examQuery.trim().length >= 2 ? (
                      <div className="max-h-64 space-y-1 overflow-y-auto rounded-[1rem] border border-surface-border bg-surface-base p-1.5">
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
                                aria-pressed={picked}
                                className={cn(
                                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-[0.75rem] px-3 py-2 text-left text-sm transition-colors',
                                  picked
                                    ? 'bg-accent/10 text-content-primary'
                                    : 'hover:bg-surface-overlay',
                                )}
                              >
                                <span className="min-w-0 break-words">
                                  <strong className="font-semibold">{e.code}</strong>{' '}
                                  <span className="text-content-secondary">{e.title}</span>
                                  <span className="ml-2 text-xs text-content-muted">{e.providerTitle}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5 text-xs text-content-muted">
                                  {e.questionCount} q
                                  {picked ? <IconCheck className="h-3.5 w-3.5 text-accent" /> : null}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="tile mt-4 flex items-start gap-3 p-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.75rem] bg-accent/10 text-accent">
                      <IconGrid className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Nothing else to choose</p>
                      <p className="caption mt-0.5">
                        All exams are covered for {durationLabel(plan.durationDays)}, so you can go straight to
                        payment.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
          </div>

          <aside
            id="checkout"
            aria-labelledby="checkout-heading"
            className="min-w-0 scroll-mt-24 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
          >
            <div className="panel-lg flex flex-col gap-4 p-4 sm:p-5 lg:max-h-[calc(100dvh_-_7rem)] lg:overflow-y-auto scroll-thin">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow mb-1">Step 3</p>
                  <h2 id="checkout-heading" className="heading-2">
                    Order summary
                  </h2>
                </div>
                {plan ? (
                  <span className="badge badge-accent max-w-[55%] break-words text-right">{plan.name}</span>
                ) : null}
              </div>

              {!plan ? (
                <div className="surface-inset p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <IconSparkles className="h-4 w-4 text-accent" /> No pass selected
                  </p>
                  <p className="caption mt-1">
                    Pick a pass above and the price, duration and total appear here.
                  </p>
                </div>
              ) : (
                <>
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-content-muted">Pass</dt>
                      <dd className="min-w-0 break-words text-right font-semibold">{plan.name}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-content-muted">Duration</dt>
                      <dd className="text-right font-semibold">{durationLabel(plan.durationDays)}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-content-muted">Exams</dt>
                      <dd className="min-w-0 break-words text-right font-semibold">
                        {plan.scope === 'all'
                          ? 'Every exam'
                          : selectedExams.length > 0
                            ? selectedExams.map((e) => e.code).join(', ')
                            : `None yet · ${quotaLabel(quota)}`}
                      </dd>
                    </div>
                  </dl>

                  <div className="border-t border-surface-border pt-3">
                    <label className="label" htmlFor="coupon">
                      Coupon code (optional)
                    </label>
                    <input
                      id="coupon"
                      name="coupon"
                      className="input uppercase"
                      placeholder="SAVE20"
                      value={coupon}
                      onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {quote?.couponCode && quote.discountMinor > 0 ? (
                      <p className="caption mt-1.5 text-positive">{quote.couponCode} applied</p>
                    ) : null}
                  </div>

                  <div className="border-t border-surface-border pt-3" aria-live="polite">
                    {quoting && !quote ? (
                      <p className="flex items-center gap-2 text-sm text-content-muted">
                        <InlineSpinner /> Getting your total…
                      </p>
                    ) : quote ? (
                      <dl className="flex flex-col gap-1.5 text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-content-muted">Subtotal</dt>
                          <dd className="numeric whitespace-nowrap">
                            {formatMoneyMinor(quote.grossMinor, quote.currency)}
                          </dd>
                        </div>
                        {quote.discountMinor > 0 ? (
                          <div className="flex items-baseline justify-between gap-3 text-positive">
                            <dt className="min-w-0 break-words">
                              Discount{quote.couponCode ? ` · ${quote.couponCode}` : ''}
                            </dt>
                            <dd className="numeric whitespace-nowrap">
                              −{formatMoneyMinor(quote.discountMinor, quote.currency)}
                            </dd>
                          </div>
                        ) : null}
                        <div className="mt-1 flex items-end justify-between gap-3 border-t border-surface-border pt-2">
                          <dt className="font-semibold">Total</dt>
                          <dd className="numeric font-display text-2xl font-bold leading-none">
                            {formatMoneyMinor(quote.totalMinor, quote.currency)}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-sm text-content-muted">
                        {needsExams && selectedExams.length === 0
                          ? 'Select an exam to see your total.'
                          : 'Your total will appear here.'}
                      </p>
                    )}
                    {quote && quote.discountMinor === 0 ? (
                      <p className="caption mt-2">Inclusive of all taxes</p>
                    ) : null}
                    {quoting && quote ? <p className="caption mt-1">Updating…</p> : null}
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {/*
                      Only offer a button that can actually complete. With live payments
                      off, `mock-activate` refuses to run on a production deployment, so
                      showing "Activate (test mode)" there produced a guaranteed error.
                    */}
                    <button
                      type="button"
                      className="btn-primary btn-lg btn-block whitespace-normal text-center leading-tight"
                      disabled={!checkoutAvailable || busy || !quote || (needsExams && selectedExams.length === 0)}
                      aria-describedby="checkout-help"
                      onClick={() => void startCheckout()}
                    >
                      <IconSparkles className="h-4 w-4" />
                      {busy ? 'Please wait…' : payLabel}
                    </button>
                    {!user && checkoutAvailable ? (
                      <p className="caption">You will be asked to sign in before payment.</p>
                    ) : null}
                    <p id="checkout-help" className="caption">
                      {nextStep}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="btn-ghost btn-sm -mb-1 self-start"
                    onClick={() => setSelectedPlan(null)}
                  >
                    <IconX className="h-4 w-4" /> Clear selection
                  </button>
                </>
              )}
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-2">
            {comparison ? (
              <section aria-labelledby="compare-heading">
                <div className="panel overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
                    <div className="min-w-0">
                      <p className="eyebrow mb-1">Compare</p>
                      <h2 id="compare-heading" className="heading-1">
                        What each pass includes
                      </h2>
                      <p className="caption mt-1">
                        {comparison.rows.length} features across {comparison.columns.length} options, using the
                        exact wording each pass lists.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm shrink-0"
                      aria-expanded={compareOpen}
                      aria-controls="compare-panel"
                      onClick={() => setCompareOpen((open) => !open)}
                    >
                      {compareOpen ? 'Hide comparison' : 'Compare every feature'}
                      <IconChevronDown
                        className={cn('h-4 w-4 transition-transform', compareOpen && 'rotate-180')}
                      />
                    </button>
                  </div>

                  {compareOpen ? (
                    <div id="compare-panel" className="border-t border-surface-border p-3 sm:p-4">
                      <TableScroll className="rounded-[1.1rem]">
                        <table className="tbl min-w-[42rem]">
                          <caption className="sr-only">Feature comparison across every plan</caption>
                          <thead>
                            <tr>
                              <th scope="col">Feature</th>
                              {comparison.columns.map((column) => (
                                <th key={column.id} scope="col" className="text-center">
                                  {column.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {comparison.rows.map((row) => (
                              <tr key={row}>
                                <th
                                  scope="row"
                                  className="border-t border-surface-border px-3 py-2.5 text-left text-sm font-medium text-content-secondary"
                                >
                                  {row}
                                </th>
                                {comparison.columns.map((column) => {
                                  const included = column.features.has(row);
                                  return (
                                    <td key={column.id} className="text-center">
                                      {included ? (
                                        <>
                                          <IconCheck
                                            width={16}
                                            height={16}
                                            className="mx-auto text-positive"
                                            aria-hidden="true"
                                          />
                                          <span className="sr-only">Included</span>
                                        </>
                                      ) : (
                                        <>
                                          <span aria-hidden="true" className="text-content-muted">
                                            —
                                          </span>
                                          <span className="sr-only">Not included</span>
                                        </>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableScroll>
                      <p className="caption mt-2">On a phone, scroll the table sideways to see every plan.</p>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
            {me ? (
              <section aria-labelledby="access-heading" className="section">
                <div className="section-head">
                  <div>
                    <p className="eyebrow mb-1.5">Account</p>
                    <h2 id="access-heading" className="heading-1">
                      Your access
                    </h2>
                  </div>
                </div>

                {me.subscriptions.length === 0 ? (
                  <EmptyState
                    title="No active pass"
                    description="Choose a pass above to unlock full exam access."
                  />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {me.subscriptions.map((s) => {
                      const planName = plans?.find((p) => p.id === s.planId)?.name ?? s.planId;
                      return (
                        <div key={s.id} className="panel p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{planName}</p>
                              <p className="caption mt-0.5 break-words">
                                {s.scope === 'all'
                                  ? 'All exams'
                                  : s.examKeys && s.examKeys.length > 0
                                    ? s.examKeys.join(', ')
                                    : (s.examKey ?? 'One exam')}
                              </p>
                            </div>
                            {s.status === 'active' ? <PremiumBadge /> : <span className="badge">{s.status}</span>}
                          </div>
                          <p className="body-text mt-2.5">
                            {s.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} on{' '}
                            {formatDate(s.currentPeriodEnd)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {me.payments.length > 0 ? (
                  <div className="panel overflow-hidden p-0">
                    <TableScroll className="rounded-none border-0 shadow-none">
                      <table className="tbl min-w-[34rem]">
                        <caption className="sr-only">Your recent payments</caption>
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Description</th>
                            <th scope="col">Status</th>
                            <th scope="col" className="text-right">
                              Amount
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {me.payments.slice(0, 10).map((p) => (
                            <tr key={p.id}>
                              <td className="whitespace-nowrap text-content-secondary">
                                {formatDate(p.createdAt)}
                              </td>
                              <td>{p.description || 'Subscription'}</td>
                              <td>
                                <span className="badge">{p.status}</span>
                              </td>
                              <td className="numeric whitespace-nowrap text-right font-medium">
                                {formatMoneyMinor(p.amountMinor, p.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                    <div className="border-t border-surface-border px-4 py-3 text-right">
                      <Link href="/profile#invoices" className="link text-sm">
                        View invoices
                      </Link>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            <section aria-labelledby="faq-heading" className="section">
              <div>
                <p className="eyebrow mb-1.5">Questions</p>
                <h2 id="faq-heading" className="heading-1">
                  Common questions
                </h2>
              </div>

              <div className="panel overflow-hidden">
                {FAQ_ITEMS.map((item) => (
                  <details key={item.q} className="group border-t border-surface-border first:border-t-0">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-sm font-semibold text-content-primary transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5 [&::-webkit-details-marker]:hidden">
                      {item.q}
                      <IconChevronDown
                        width={18}
                        height={18}
                        className="shrink-0 text-content-muted transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <p className="px-4 pb-4 text-sm leading-relaxed text-content-secondary sm:px-5">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small inline spinner for the summary, without the page-level padding. */
function InlineSpinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
    />
  );
}

function PlanMeta({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="tile min-w-0 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-content-muted">
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-0.5 break-words text-[0.75rem] font-semibold leading-snug">{value}</p>
    </div>
  );
}

function PlanFeatures({ features, limit = 3 }: { features: string[]; limit?: number }) {
  const shown = features.slice(0, limit);
  const extra = features.length - shown.length;

  return (
    <ul className="relative mt-3 flex flex-1 flex-col gap-1.5">
      {shown.map((feature) => (
        <li
          key={feature}
          className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-content-secondary"
        >
          <span className="mt-[0.2rem] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
            <IconCheck width={11} height={11} />
          </span>
          <span className="min-w-0 break-words">{feature}</span>
        </li>
      ))}
      {extra > 0 ? (
        <li className="caption pl-6">
          +{extra} more feature{extra === 1 ? '' : 's'} in the full comparison
        </li>
      ) : null}
    </ul>
  );
}

function PlanCardFrame({
  highlight,
  selected,
  children,
}: {
  highlight?: boolean;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-[1.6rem] border bg-surface-raised p-4 text-left transition-all duration-300 sm:p-5',
        'peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-base',
        selected
          ? 'border-accent shadow-glow-sm ring-1 ring-accent/50'
          : highlight
            ? 'ring-gradient border-transparent shadow-md'
            : 'border-surface-border hover:border-accent/40',
      )}
    >
      {highlight ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-accent/20 blur-3xl"
        />
      ) : null}
      {children}
    </div>
  );
}

function PaidPlanCard({
  plan,
  selected,
  current,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  current: boolean;
  onSelect: (planId: string) => void;
}) {
  const price = formatMoneyMinor(plan.priceMinor, plan.currency);
  const cadence = plan.durationDays >= 365 ? 'per year' : `per ${plan.durationDays} days`;
  // `highlight` is the server's own recommendation signal; the label only
  // restates it, and an explicit plan badge always wins.
  const badge = plan.badge ?? (plan.highlight ? 'Recommended' : undefined);
  const shortName = plan.name.split('·')[0]!.trim();

  return (
    <label className="relative block h-full cursor-pointer">
      <input
        type="radio"
        name="pass"
        value={plan.id}
        checked={selected}
        onChange={() => onSelect(plan.id)}
        onClick={() => {
          // Re-picking the active pass clears the exam selection, exactly as the
          // old button did. A controlled radio does not emit `change` when it is
          // already checked, so the click has to carry that case.
          if (selected) onSelect(plan.id);
        }}
        aria-label={`${plan.name}, ${price} ${cadence}`}
        className="peer sr-only"
      />
      <PlanCardFrame highlight={plan.highlight} selected={selected}>
        <div className="relative flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-display text-[0.72rem] font-bold uppercase tracking-[0.14em] text-content-secondary">
            {plan.name}
          </h3>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {badge ? (
              <span className={cn('badge max-w-full text-right', plan.highlight && 'badge-accent')}>
                {badge}
              </span>
            ) : null}
            {current ? <span className="badge badge-success">Current</span> : null}
          </div>
        </div>

        <p className="numeric relative mt-3 font-display text-[2rem] font-bold leading-none tracking-tight">
          {price}
        </p>
        <p className="caption relative mt-1">{cadence}</p>

        <div className="relative mt-3 grid grid-cols-2 gap-1.5">
          <PlanMeta
            icon={<IconClock className="h-3 w-3" />}
            label="Access"
            value={durationLabel(plan.durationDays)}
          />
          <PlanMeta icon={<IconGrid className="h-3 w-3" />} label="Exams" value={quotaLabel(quotaOf(plan))} />
        </div>

        <p className="relative mt-3 line-clamp-2 min-h-[2.5rem] text-pretty text-[0.8125rem] leading-relaxed text-content-secondary">
          {plan.description}
        </p>
        <PlanFeatures features={plan.features} />

        <div className="relative mt-4">
          <span
            aria-hidden="true"
            className={cn(
              'btn w-full whitespace-normal text-center leading-tight',
              selected || !plan.highlight ? 'btn-secondary' : 'btn-primary',
            )}
          >
            {selected ? (
              <>
                <IconCheck className="h-4 w-4" /> Selected
              </>
            ) : current ? (
              'Renew or extend'
            ) : (
              `Choose ${shortName}`
            )}
          </span>
        </div>
      </PlanCardFrame>
    </label>
  );
}

function FreePlanCard({
  currency,
  freeQuestions,
  signedIn,
  current,
}: {
  currency: string;
  freeQuestions: number;
  signedIn: boolean;
  current: boolean;
}) {
  return (
    <div className="h-full">
      <PlanCardFrame>
        <div className="relative flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-display text-[0.72rem] font-bold uppercase tracking-[0.14em] text-content-secondary">
            Free
          </h3>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="badge">Always free</span>
            {current ? <span className="badge badge-success">Current</span> : null}
          </div>
        </div>

        <p className="numeric relative mt-3 font-display text-[2rem] font-bold leading-none tracking-tight">
          {formatMoneyMinor(0, currency)}
        </p>
        <p className="caption relative mt-1">forever</p>

        <div className="relative mt-3 grid grid-cols-2 gap-1.5">
          <PlanMeta icon={<IconClock className="h-3 w-3" />} label="Access" value="No expiry" />
          <PlanMeta icon={<IconGrid className="h-3 w-3" />} label="Exams" value="Every exam" />
        </div>

        <p className="relative mt-3 min-h-[2.5rem] text-pretty text-[0.8125rem] leading-relaxed text-content-secondary">
          {freeQuestions} questions per exam, unlimited browsing.
        </p>
        <PlanFeatures features={FREE_FEATURES} limit={4} />

        <div className="relative mt-4">
          <Link
            href={signedIn ? '/exams' : '/register'}
            className="btn-secondary w-full whitespace-normal text-center leading-tight"
          >
            {signedIn ? 'Browse exams' : 'Start free'}
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </PlanCardFrame>
    </div>
  );
}