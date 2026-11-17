'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get } from '@/lib/api';
import { Alert, EmptyState, PageHeader, Spinner, StatStrip } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { IconCheckCircle, IconClock, IconCopy, IconSend, IconSparkles, IconTrophy } from '@/components/icons';
import { formatDate, formatNumber } from '@/lib/format';

interface ReferralStats {
  code: string;
  totalReferrals: number;
  totalRewardDays: number;
  shareUrl: string;
  referrals: Array<{ id: string; status: string; rewardDays: number; createdAt: string }>;
}

const STEPS = [
  {
    icon: IconSend,
    title: 'Share your link',
    body: 'Send your code or invite link to someone preparing for the same certification.',
  },
  {
    icon: IconSparkles,
    title: 'They join and verify',
    body: 'They create an account with your code and confirm their email address.',
  },
  {
    icon: IconTrophy,
    title: 'You both get days',
    body: 'They receive 3 bonus days; your account receives 7 once they verify.',
  },
];

export default function ReferralsPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    get<ReferralStats>('/referrals/me')
      .then(setStats)
      .catch((err) => setError((err as Error).message));
  }, [user]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard', 'success');
    } catch {
      toast('Could not copy', 'error');
    }
  };

  if (loading) return <Spinner />;
  if (!user) return <EmptyState title="Sign in to view referrals" action={<Link href="/login" className="btn-primary">Sign in</Link>} />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!stats) return <Spinner label="Loading referrals..." />;

  const pending = stats.referrals.filter((referral) => referral.status === 'pending').length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Rewards"
        title="Refer a friend"
        description="You both get bonus Premium days when they verify their email."
      />

      <Reveal>
        {/* Share hero: the one thing a visitor to this page came to do. */}
        <section className="panel-lg ring-gradient relative isolate overflow-hidden p-5 sm:p-7">
          <div aria-hidden="true" className="orb -right-20 -top-24 h-60 w-60 bg-accent/20" />
          <div aria-hidden="true" className="orb -bottom-24 -left-16 h-52 w-52 bg-accent-3/15" />

          <div className="relative grid gap-6 lg:grid-cols-2 lg:items-center">
            <div className="min-w-0">
              <p className="eyebrow">Your invite code</p>
              <p className="mt-2 break-all font-mono text-[1.75rem] font-black tracking-[0.14em] text-content-primary sm:text-3xl">
                {stats.code}
              </p>
              <p className="caption mt-2">
                Friends receive 3 bonus days; you receive 7 when they verify their email.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => void copy(stats.shareUrl)}>
                  <IconCopy width={16} height={16} aria-hidden="true" />
                  Copy invite link
                </button>
                <button type="button" className="btn-secondary" onClick={() => void copy(stats.code)}>
                  Copy code
                </button>
              </div>
            </div>

            <div className="min-w-0">
              <label className="label" htmlFor="invite-link">
                Your invite link
              </label>
              <input
                id="invite-link"
                readOnly
                className="input font-mono text-xs"
                value={stats.shareUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="caption mt-2">
                Share the link, or read the code out — both work when someone signs up.
              </p>
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section aria-label="Referral totals" className="panel overflow-hidden">
          <StatStrip
            columns={2}
            items={[
              {
                label: 'Friends referred',
                value: formatNumber(stats.totalReferrals),
                hint: pending > 0 ? `${pending} awaiting verification` : 'Verified referrals so far',
              },
              {
                label: 'Reward days earned',
                value: formatNumber(stats.totalRewardDays),
                hint: 'Bonus Premium days added to your account',
                tone: stats.totalRewardDays > 0 ? 'success' : 'default',
              },
            ]}
          />
        </section>
      </Reveal>

      <Reveal>
        <section aria-labelledby="how-heading" className="section">
          <div className="section-head">
            <h2 id="how-heading" className="heading-2">
              How it works
            </h2>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="tile flex flex-col gap-2 p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                      <Icon width={16} height={16} aria-hidden="true" />
                    </span>
                    <span className="numeric text-2xl font-black leading-none text-accent/25">{index + 1}</span>
                  </div>
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-xs leading-relaxed text-content-muted">{step.body}</p>
                </li>
              );
            })}
          </ol>
        </section>
      </Reveal>

      <Reveal>
        <section aria-labelledby="activity-heading" className="panel p-4 sm:p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 id="activity-heading" className="heading-2">
              Referral activity
            </h2>
            {stats.referrals.length > 0 ? (
              <span className="badge numeric shrink-0">{stats.referrals.length} shown</span>
            ) : null}
          </div>

          {stats.referrals.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">
              No referrals yet. Share your link to get started.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {stats.referrals.map((referral) => {
                const completed = referral.status === 'completed';
                return (
                  <li key={referral.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                          completed ? 'bg-positive/[0.12] text-positive' : 'bg-caution/[0.12] text-caution'
                        }`}
                      >
                        {completed ? <IconCheckCircle width={16} height={16} /> : <IconClock width={16} height={16} />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {completed ? 'Verified' : referral.status === 'pending' ? 'Awaiting verification' : referral.status}
                        </p>
                        <p className="caption mt-0.5">Referred {formatDate(referral.createdAt)}</p>
                      </div>
                    </div>
                    <span
                      className={`numeric shrink-0 text-sm font-semibold ${
                        referral.rewardDays > 0 ? 'text-positive' : 'text-content-muted'
                      }`}
                    >
                      {referral.rewardDays > 0 ? `+${referral.rewardDays} days` : 'No reward yet'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Reveal>
    </div>
  );
}
