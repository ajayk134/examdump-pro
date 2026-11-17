'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Plan } from '@/lib/types';
import { IconCheck } from '@/components/icons';
import { formatMoneyMinor } from '@/lib/format';

interface PlansResponse {
  plans: Plan[];
  freeQuestionsPerExam: number;
  currency: string;
}

/**
 * Pricing preview.
 *
 * Reads the same public `/subscriptions/plans` endpoint as the pricing page and
 * displays the first few passes. It never starts a checkout — payment state is
 * always decided on the pricing page where the server flags are known.
 */
export function LandingPricing() {
  const [data, setData] = useState<PlansResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<PlansResponse>('/subscriptions/plans')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const freeQuestions = data?.freeQuestionsPerExam ?? 5;
  const paid = (data?.plans ?? [])
    .filter((p) => p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 3);

  const cadence = (p: Plan) => (p.durationDays >= 365 ? 'per year' : p.durationDays === 30 ? 'per month' : `per ${p.durationDays} days`);

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {/* Free tier */}
      <PlanTile
        title="Free"
        price="₹0"
        cadence="forever"
        description={`${freeQuestions} questions on every exam, unlimited browsing.`}
        points={['Progress tracking', 'Leaderboards', '1 mock per day']}
        cta={
          <Link href="/register" className="btn-secondary w-full">
            Start free
          </Link>
        }
      />

      {data === null
        ? Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton min-h-[16rem] rounded-[1.5rem]" />
          ))
        : paid.map((plan) => (
            <PlanTile
              key={plan.id}
              title={plan.name}
              price={formatMoneyMinor(plan.priceMinor, plan.currency)}
              cadence={cadence(plan)}
              description={plan.description}
              points={plan.features.slice(0, 3)}
              highlight={plan.highlight}
              badge={plan.badge ?? undefined}
              cta={
                <Link href="/pricing" className={plan.highlight ? 'btn-primary w-full' : 'btn-secondary w-full'}>
                  Choose plan
                </Link>
              }
            />
          ))}
    </div>
  );
}

function PlanTile({
  title,
  price,
  cadence,
  description,
  points,
  cta,
  highlight,
  badge,
}: {
  title: string;
  price: string;
  cadence: string;
  description: string;
  points: string[];
  cta: React.ReactNode;
  highlight?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={[
        'relative flex flex-col rounded-[1.5rem] border bg-surface-raised p-4 transition-all duration-300 ease-smooth',
        highlight
          ? 'ring-gradient border-transparent shadow-md'
          : 'border-surface-border shadow-xs hover:-translate-y-1 hover:border-accent/40',
      ].join(' ')}
    >
      {badge ? (
        <span className="absolute -top-2.5 left-4 rounded-full bg-accent px-2.5 py-1 text-[0.6875rem] font-semibold text-white shadow-glow-sm">
          {badge}
        </span>
      ) : null}
      <p className="font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] text-content-muted">{title}</p>
      <p className="numeric mt-2 font-display text-3xl font-bold tracking-tight">{price}</p>
      <p className="text-xs text-content-muted">{cadence}</p>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[0.8125rem] leading-relaxed text-content-secondary">
        {description}
      </p>
      <ul className="mt-3 flex-1 space-y-1.5">
        {points.map((point) => (
          <li key={point} className="flex gap-2 text-[0.8125rem] text-content-secondary">
            <IconCheck width={15} height={15} className="mt-0.5 shrink-0 text-accent" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">{cta}</div>
    </div>
  );
}
