'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CommunityVoteSummary, Question } from '@/lib/types';
import { get, post } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import { IconThumbUp } from '../icons';
import { useAuth, useToast } from '../providers';

const SEGMENT_COLORS = [
  'rgb(var(--accent))',
  'rgb(var(--accent-2))',
  'rgb(var(--accent-3))',
  'rgb(var(--success))',
  'rgb(var(--warning))',
  'rgb(var(--danger))',
  'rgb(var(--content-muted))',
];

/**
 * Community poll for one question.
 *
 * The server owns the counts and the one-vote-per-user rule. Single-answer
 * questions accept one label; multi-answer questions allow a set and submit it
 * as one persisted vote. The combined bar is split by each option's share of
 * all selections, so the segments always fill exactly 100%.
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
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const multi = question.type === 'multiple' || (question.answer?.length ?? 0) > 1;
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
    setSelected([]);
    void load();
  }, [load]);

  useEffect(() => {
    setSelected(summary?.myVote ? summary.myVote.split(',').filter(Boolean) : []);
  }, [summary]);

  const total = summary?.total ?? 0;
  const rows = question.choices.map((choice, index) => {
    const count = summary?.counts[choice.key] ?? 0;
    return {
      ...choice,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length]!,
    };
  });

  const save = async (keys: string[]) => {
    if (!user || saving || keys.length === 0) return;
    setSaving(true);
    setError('');
    setSelected(keys);
    try {
      const next = await post<CommunityVoteSummary>('/community/votes', {
        provider: providerId,
        exam: examKey,
        questionId: question.id,
        choice: keys.join(','),
      });
      setSummary(next);
    } catch (err) {
      setSelected(summary?.myVote ? summary.myVote.split(',').filter(Boolean) : []);
      setError((err as Error).message);
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const choose = (key: string) => {
    if (saving) return;
    if (!multi) {
      void save([key]);
      return;
    }
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key].sort(),
    );
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

  const savedSelection = summary?.myVote ? summary.myVote.split(',').filter(Boolean) : [];
  const selectionChanged = selected.join(',') !== savedSelection.join(',');

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
            {multi ? 'Select every answer that applies' : 'Pick the answer you chose'}
          </h3>
        </div>
        <span className="numeric rounded-full bg-surface-overlay px-2.5 py-1 text-[0.6875rem] font-bold text-content-secondary">
          {formatNumber(total)} {total === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      <div
        role="group"
        aria-label={multi ? 'Select all answer options that apply' : 'Select one answer option'}
        className="mt-3 flex flex-wrap gap-2"
      >
        {question.choices.map((choice) => {
          const picked = selected.includes(choice.key);
          return (
            <button
              key={choice.key}
              type="button"
              onClick={() => choose(choice.key)}
              disabled={saving}
              aria-pressed={picked}
              aria-label={choice.text ? `${choice.key}: ${choice.text}` : choice.key}
              title={choice.text || choice.key}
              className={cn(
                'numeric grid h-11 min-w-11 place-items-center rounded-xl border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60',
                picked
                  ? 'border-transparent bg-accent text-[rgb(var(--accent-contrast))] shadow-sm'
                  : 'border-surface-border-strong bg-surface-base text-content-secondary hover:border-accent/45 hover:text-accent',
              )}
            >
              {choice.key}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.6875rem] text-content-muted">
          {multi
            ? 'Select all that apply, then save your vote.'
            : 'Your vote is saved as soon as you pick an option.'}
        </p>
        {multi && selected.length > 0 && selectionChanged ? (
          <button
            type="button"
            onClick={() => void save(selected)}
            disabled={saving}
            className="btn-primary btn-sm"
          >
            {saving ? 'Saving...' : 'Save vote'}
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-content-muted">Results</p>
          <p className="numeric text-[0.6875rem] text-content-muted">
            {formatNumber(total)} {total === 1 ? 'vote' : 'votes'}
          </p>
        </div>
        <div
          role="img"
          aria-label={
            total > 0
              ? rows
                  .filter((row) => row.count > 0)
                  .map((row) => `${row.key}: ${Math.round(row.percentage)} percent`)
                  .join(', ')
              : 'No community votes yet'
          }
          className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-surface-inset"
        >
          {rows.map((row) =>
            row.count > 0 ? (
              <span
                key={row.key}
                title={`${row.key}: ${Math.round(row.percentage)}%`}
                className="h-full transition-[width] duration-500 ease-out first:rounded-l-full last:rounded-r-full"
                style={{ width: `${row.percentage}%`, backgroundColor: row.color }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {rows.map((row) => (
            <span
              key={row.key}
              className="inline-flex items-center gap-1.5 text-[0.6875rem] text-content-muted"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="numeric font-bold text-content-secondary">{row.key}</span>
              <span>{Math.round(row.percentage)}%</span>
              <span className="numeric text-content-muted/70">({formatNumber(row.count)})</span>
            </span>
          ))}
        </div>
      </div>

      {loading ? <p className="mt-2 text-xs text-content-muted">Loading community votes...</p> : null}
      {error ? (
        <p className="mt-2 text-xs text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}