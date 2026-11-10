'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get } from '@/lib/api';
import { Alert, EmptyState, Spinner, StatCard } from '@/components/ui';
import { IconTrophy } from '@/components/icons';
import { formatDate } from '@/lib/format';

interface ReferralStats {
  code: string;
  totalReferrals: number;
  totalRewardDays: number;
  shareUrl: string;
  referrals: Array<{ id: string; status: string; rewardDays: number; createdAt: string }>;
}

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
  if (!stats) return <Spinner label="Loading referrals…" />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><IconTrophy className="text-amber-400" /> Refer a friend</h1>
        <p className="mt-1 text-content-muted">You both get bonus Premium days when they verify their email.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Friends referred" value={stats.totalReferrals} />
        <StatCard label="Reward days earned" value={stats.totalRewardDays} />
        <StatCard label="Your code" value={<span className="font-mono text-xl">{stats.code}</span>} />
      </div>

      <div className="card p-5">
        <p className="label">Your invite link</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly className="input font-mono text-xs" value={stats.shareUrl} />
          <button onClick={() => copy(stats.shareUrl)} className="btn-primary">Copy link</button>
        </div>
        <p className="mt-2 text-xs text-content-muted">Friends receive 3 bonus days; you receive 7 when they verify their email.</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">Referral activity</h2>
        {stats.referrals.length === 0 ? (
          <p className="py-6 text-center text-sm text-content-muted">No referrals yet. Share your link to get started.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {stats.referrals.map((referral) => (
              <li key={referral.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium capitalize">{referral.status}</p>
                  <p className="text-xs text-content-muted">{formatDate(referral.createdAt)}</p>
                </div>
                <span className="badge">+{referral.rewardDays} days</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}