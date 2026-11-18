'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CommunityVoteSummary, Question } from '@/lib/types';
import { get, post } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import { IconCheck, IconThumbUp } from '../icons';
import { useAuth, useToast } from '../providers';

/**
 * Community poll for one question.
 *
 * The server owns the counts and the one-vote-per-user rule. The UI only knows
 * the question's actual option list, so it works for two, three, four or more
 * options without a fixed layout.
 */
export function CommunityVote({
  question,
  providerId,
  examKey,
}: {
  question: Question;
  providerId: string;
  examKey: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [summary, setSummary] = useState<CommunityVoteSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [voting, setVoting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const search = new URLSearchParams({
      provider: providerId,
      exam: examKey,
      questionId: question.id,
    });
    return search.toString();
  }, [examKey, providerId, question.id]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      setSummary(await get<CommunityVoteSummary>(`/community/votes?${params}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params, user]);

  useEffect(() => {
    setSummary(null);
    void load();
  }, [load]);

  const vote = async (choice: string) => {
    if (!user || voting) return;
    setVoting(choice);
    setError('');
    try {
      const next = await post<CommunityVoteSummary>('/community/votes', {
        provider: providerId,
        exam: examKey,
        questionId: question.id,
        choice,
      });
      setSummary(next);
    } catch (err) {
      setError((err as Error).message);
      toast((err as Error).message, 'error');
    } finally {
      setVoting(null);
    }
  };

  if (question.choices.length === 0) return null;

  if (!user) {
    return (
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-xs">
        <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-content-muted">
          <IconThumbUp width={13} height={13} /> Community vote
        </p>
        <p className="mt-2 text-sm text-content-secondary">
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>{' '}
          to vote and see how other learners answered.
        </p>
      </section>
    );
  }

  const total = summary?.total ?? 0;
  const rows = question.choices.map((choice) => {
    const count = summary?.counts[choice.key] ?? 0;
    const percentage = total > 0 ? (count / total) * 100 : 0;
    return { ...choice, count, percentage };
  });

  return (
    <section
      aria-labelledby={`community-vote-${question.id}`}
      className="rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-content-muted">
            <IconThumbUp width={13} height={13} /> Community vote
          </p>
          <h3 id={`community-vote-${question.id}`} className="mt-1 text-sm font-bold text-content-primary">
            What did others pick?
          </h3>
        </div>
        <span className="numeric rounded-full bg-surface-overlay px-2.5 py-1 text-[0.6875rem] font-bold text-content-secondary">
          {formatNumber(total)} {total === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((choice) => {
          const picked = summary?.myVote === choice.key;
          return (
            <button
              key={choice.key}
              type="button"
              onClick={() => void vote(choice.key)}
              disabled={Boolean(voting)}
              aria-pressed={picked}
              title={choice.text || choice.key}
              className={cn(
                'group flex w-full flex-col gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                picked
                  ? 'border-accent/55 bg-accent/[0.06]'
                  : 'border-surface-border bg-surface-base hover:border-surface-border-strong hover:bg-surface-overlay/35',
                voting && voting !== choice.key && 'opacity-60',
              )}
            >
              <span className="flex w-full items-start gap-3">
                <span
                  className={cn(
                    'numeric mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-[0.6875rem] font-bold',
                    picked
                      ? 'border-transparent bg-accent text-[rgb(var(--accent-contrast))]'
                      : 'border-surface-border-strong bg-surface-raised text-content-secondary',
                  )}
                >
                  {picked ? <IconCheck width={13} height={13} /> : choice.key}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[0.8125rem] leading-snug text-content-secondary">
                    {choice.text || 'Image option'}
                  </span>
                  {picked ? (
                    <span className="mt-0.5 block text-[0.625rem] font-bold uppercase tracking-[0.08em] text-accent">
                      Your vote
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right">
                  <span className="numeric block text-sm font-bold text-content-primary">
                    {Math.round(choice.percentage)}%
                  </span>
                  <span className="numeric block text-[0.625rem] text-content-muted">
                    {formatNumber(choice.count)} {choice.count === 1 ? 'vote' : 'votes'}
                  </span>
                </span>
              </span>
              <span
                aria-hidden="true"
                className="relative block h-2 w-full overflow-hidden rounded-full bg-surface-inset"
              >
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out',
                    picked ? 'bg-accent' : 'bg-accent/55',
                  )}
                  style={{ width: `${choice.percentage}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {loading ? <p className="mt-2 text-xs text-content-muted">Loading community votes…</p> : null}
      {error ? (
        <p className="mt-2 text-xs text-negative" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-[0.6875rem] text-content-muted">
        {summary?.myVote
          ? 'You can change your vote at any time.'
          : 'Pick the option you think is right. One vote per learner.'}
      </p>
    </section>
  );
}