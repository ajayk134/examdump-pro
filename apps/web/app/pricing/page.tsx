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
import { Alert, EmptyState, PremiumBadge, Spinner, TableScroll } from '@/components/ui';
import { IconCheck, IconChevronDown, IconSparkles, IconX } from '@/components/icons';
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

  return (
    <div className="flex flex-col gap-12 sm:gap-14">
      <header className="relative isolate mx-auto max-w-3xl overflow-hidden text-center pb-2">
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-8 h-64" />
        <div aria-hidden="true" className="orb -left-10 top-0 h-52 w-52 bg-brand-500/25" />
        <div aria-hidden="true" className="orb -right-10 top-6 h-52 w-52 bg-accent-2/20" />
        <span className="badge badge-accent relative mx-auto mb-5">
          <IconSparkles width={13} height={13} />
          Pricing
        </span>
        <h1 className="display-1 relative text-balance">
          Pass once. Practice <span className="gradient-text animate-gradient">without limits</span>.
        </h1>
        <p className="body-text relative mx-auto mt-5 max-w-xl text-pretty text-base">
          Every exam has {freeQuestions} free questions. Unlock full question banks, timed mocks, AI explanations
          and analytics with a pass that fits how many exams you are taking.
        </p>
        {me?.entitlements.expiresAt ? (
          <p className="caption relative mt-4">
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
        <section className="flex flex-col gap-5" aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="sr-only">
            Plans
          </h2>
          <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                <Link
                  href={user ? '/exams' : '/register'}
                  className="btn-secondary w-full whitespace-normal text-center leading-tight"
                >
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
                    className={cn(
                      p.highlight ? 'btn-primary' : 'btn-secondary',
                      // Long API plan names overflow the card because `.btn`
                      // is `whitespace-nowrap`. Let the label wrap and centre.
                      'w-full whitespace-normal text-center leading-tight',
                    )}
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
          <p className="caption text-center">
            All prices are shown in the plan currency. Taxes, where applicable, are included at checkout.
          </p>
        </section>
      )}

      {plan ? (
        <section className="panel-lg animate-fade-in p-5 sm:p-6" aria-labelledby="configure-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow mb-1.5">Checkout</p>
              <h2 id="configure-heading" className="heading-1">
                Configure your {plan.name}
              </h2>
              <p className="body-text mt-1.5 max-w-xl text-pretty">
                {plan.scope === 'all'
                  ? 'Every exam in the catalogue is unlocked for the whole period.'
                  : plan.scope === 'multi'
                    ? `Pick up to ${plan.examQuota || 3} exams. You can change them later.`
                    : 'Pick the one exam this pass unlocks.'}
              </p>
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSelectedPlan(null)}>
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
                      className="chip gap-2 whitespace-normal border-brand-400/50 bg-brand-100/60 text-left text-brand-800 hover:bg-brand-200/60 dark:bg-brand-500/15 dark:text-brand-200"
                      onClick={() => toggleExam(e)}
                      aria-label={`Remove ${e.code}`}
                    >
                      <span className="min-w-0">
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
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-surface-border bg-surface-base p-2">
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
                          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                            picked
                              ? 'bg-brand-100/70 text-brand-900 dark:bg-brand-500/15 dark:text-brand-100'
                              : 'hover:bg-surface-overlay'
                          }`}
                        >
                          <span className="min-w-0">
                            <strong className="font-semibold">{e.code}</strong>{' '}
                            <span className="text-content-secondary">{e.title}</span>
                            <span className="ml-2 text-xs text-content-muted">{e.providerTitle}</span>
                          </span>
                          <span className="shrink-0 text-xs text-content-muted">{e.questionCount} q</span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 grid gap-5 border-t border-surface-border pt-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] sm:items-start">
            <div className="min-w-0">
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
            </div>
            <div className="sm:text-right" aria-live="polite">
              {quoting ? (
                <Spinner />
              ) : quote ? (
                <>
                  <p className="numeric text-2xl font-bold">{formatMoneyMinor(quote.totalMinor, quote.currency)}</p>
                  {quote.discountMinor > 0 ? (
                    <p className="caption mt-1 text-positive">
                      {formatMoneyMinor(quote.discountMinor, quote.currency)} off with {quote.couponCode}
                    </p>
                  ) : (
                    <p className="caption mt-1">Inclusive of all taxes</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-content-muted">Select exams to see the total</p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            {/*
              Only offer a button that can actually complete. With live payments
              off, `mock-activate` refuses to run on a production deployment, so
              showing "Activate (test mode)" there produced a guaranteed error.
            */}
            <button
              type="button"
              className="btn-primary w-full whitespace-normal text-center leading-tight sm:w-auto"
              disabled={!checkoutAvailable || busy || !quote || (needsExams && selectedExams.length === 0)}
              onClick={() => void startCheckout()}
            >
              <IconSparkles className="h-4 w-4" />
              {paymentsEnabled || youpiAvailable ? 'Continue to payment' : mockPayments ? 'Activate (test mode)' : 'Checkout unavailable'}
            </button>
            {!checkoutAvailable ? (
              <span className="caption">Payments are not enabled on this deployment.</span>
            ) : youpiAvailable ? (
              <span className="caption">
                UPI via YouPI-PG. Access is granted only after independent bank-statement reconciliation.
              </span>
            ) : !paymentsEnabled ? (
              <span className="caption">No charge is made in test mode.</span>
            ) : (
              <span className="caption">Cards, UPI and netbanking via HyperSwitch.</span>
            )}
          </div>
        </section>
      ) : null}

      {me ? (
        <section className="section" aria-labelledby="access-heading">
          <div className="section-head">
            <div>
              <p className="eyebrow mb-1.5">Account</p>
              <h2 id="access-heading" className="heading-1">
                Your access
              </h2>
            </div>
          </div>

          {me.subscriptions.length === 0 ? (
            <EmptyState title="No active pass" description="Choose a pass above to unlock full exam access." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {me.subscriptions.map((s) => (
                <div key={s.id} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.planId}</p>
                      <p className="caption mt-0.5 break-words">
                        {s.scope === 'all'
                          ? 'All exams'
                          : (s.examKeys && s.examKeys.length > 0
                              ? s.examKeys.join(', ')
                              : (s.examKey ?? 'One exam'))}
                      </p>
                    </div>
                    {s.status === 'active' ? <PremiumBadge /> : <span className="badge">{s.status}</span>}
                  </div>
                  <p className="body-text mt-2.5">
                    {s.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} on {formatDate(s.currentPeriodEnd)}
                  </p>
                </div>
              ))}
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
                        <td className="whitespace-nowrap text-content-secondary">{formatDate(p.createdAt)}</td>
                        <td>{p.description || 'Subscription'}</td>
                        <td>
                          <span className="badge">{p.status}</span>
                        </td>
                        <td className="whitespace-nowrap text-right font-medium">
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

      {comparison ? (
        <section className="section" aria-labelledby="compare-heading">
          <div className="mx-auto max-w-xl text-center">
            <p className="eyebrow mb-2">Compare</p>
            <h2 id="compare-heading" className="display-2 text-balance">
              What each pass includes
            </h2>
            <p className="body-text mt-2.5">On a phone, scroll the table sideways to see every plan.</p>
          </div>

          <TableScroll>
            <table className="tbl min-w-[38rem]">
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
                              <IconCheck width={16} height={16} className="mx-auto text-positive" aria-hidden="true" />
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
        </section>
      ) : null}

      <section className="section" aria-labelledby="faq-heading">
        <div className="mx-auto max-w-xl text-center">
          <p className="eyebrow mb-2">Questions</p>
          <h2 id="faq-heading" className="display-2 text-balance">
            Common questions
          </h2>
        </div>

        <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-surface-border bg-surface-raised shadow-sm">
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
  // `highlight` is the server's own recommendation signal; the label only
  // restates it, and an explicit plan badge always wins.
  const badge = props.badge ?? (props.highlight ? 'Recommended' : undefined);

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border p-5 transition-all duration-300 sm:p-6',
        props.highlight
          ? 'ring-gradient border-transparent bg-surface-raised shadow-lg'
          : 'border-surface-border bg-surface-raised shadow-xs hover:-translate-y-1 hover:border-accent/40 hover:shadow-md',
      )}
    >
      {props.highlight ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-brand-500/25 blur-3xl"
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-3">
        <h3 className="font-display text-[0.72rem] font-bold uppercase tracking-[0.14em] text-content-secondary">
          {props.name}
        </h3>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {badge ? (
            <span className={cn('badge', props.highlight && 'badge-accent')}>{badge}</span>
          ) : null}
          {props.current ? <span className="badge badge-success">Current</span> : null}
        </div>
      </div>

      <p className="numeric relative mt-4 font-display text-4xl font-bold tracking-tight">{props.price}</p>
      <p className="caption relative mt-1">{props.cadence}</p>
      <p className="relative mt-3 min-h-[2.5rem] text-[0.8125rem] leading-relaxed text-content-secondary">
        {props.description}
      </p>

      <ul className="relative mt-5 flex flex-1 flex-col gap-2.5">
        {props.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-content-secondary">
            <span className="mt-[0.15rem] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-positive/15 text-positive">
              <IconCheck width={11} height={11} />
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="relative mt-6">{props.cta}</div>
    </div>
  );
}
