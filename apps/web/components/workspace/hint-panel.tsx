'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '@/lib/types';
import { streamPost } from '@/lib/api';
import { useAuth, useToast } from '../providers';
import { IconArrowRight, IconSparkles, IconStop } from '../icons';
import { cn } from '@/lib/format';

interface HintEntry {
  texts: string[];
  loading: boolean;
  error: string;
}

const EMPTY: HintEntry = { texts: [], loading: false, error: '' };
const LEVELS = ['Orientation', 'Narrow it down', 'Final nudge'] as const;

function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A question-specific reading focus, so two items never show the same primer. */
function questionFocus(question: Question): string {
  const stem = compact(question.stemText || '', 150);
  return stem || compact(question.title || '', 120) || 'this item';
}

/**
 * Progressive hints.
 *
 * The first step is a deterministic reading prompt built from the question
 * shape, so a learner always gets somewhere to start without spending a model
 * call. Each subsequent step asks the server for a deeper nudge; every level is
 * instructed never to name the answer.
 */
export function HintPanel({
  question,
  mode,
  providerId,
  examKey,
  aiEnabled,
  onConsumed,
  onOpenExplain,
  onOpenChat,
}: {
  question: Question;
  mode: 'practice' | 'mock';
  providerId: string;
  examKey: string;
  aiEnabled: boolean;
  onConsumed: () => void;
  onOpenExplain: () => void;
  onOpenChat: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<Record<string, HintEntry>>({});
  const abort = useRef<AbortController | null>(null);
  const entryKey = `${providerId}/${examKey}/${question.id}`;
  const entry = entries[entryKey] ?? EMPTY;

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    return () => {
      abort.current?.abort();
      abort.current = null;
    };
  }, [entryKey]);

  const primer = useMemo(() => {
    const focus = questionFocus(question);
    if (question.type === 'multiple') {
      return [
        `Focus on “${focus}”. Treat each option as a separate true/false statement — more than one may be correct.`,
      ];
    }
    if (question.choices.length === 0 || question.stemImages.length > 0) {
      return [
        `Focus on “${focus}”. Read the exhibit for sequence, labels, and constraints before choosing.`,
      ];
    }
    return [`Focus on “${focus}”. Find the one option that satisfies it without adding an assumption.`];
  }, [question]);

  const requestHint = async () => {
    if (mode === 'mock') return;
    if (!user) {
      toast('Sign in to use AI hints.', 'info');
      return;
    }
    if (entry.loading || entry.texts.length >= LEVELS.length) return;
    const retrying = Boolean(entry.error);
    const level = (retrying ? entry.texts.length : entry.texts.length + 1) as 1 | 2 | 3;
    const previousHints = (retrying ? entry.texts.slice(0, -1) : entry.texts)
      .map((text) => text.trim())
      .filter(Boolean);
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;

    setEntries((current) => {
      const previous = current[entryKey] ?? EMPTY;
      const texts = [...previous.texts];
      if (retrying && texts.length > 0) texts[texts.length - 1] = '';
      else texts.push('');
      return { ...current, [entryKey]: { texts, loading: true, error: '' } };
    });

    const patch = (text: string) =>
      setEntries((current) => {
        const previous = current[entryKey] ?? EMPTY;
        const texts = [...previous.texts];
        texts[texts.length - 1] = `${texts[texts.length - 1] ?? ''}${text}`;
        return { ...current, [entryKey]: { ...previous, texts } };
      });

    try {
      await streamPost(
        '/ai/hint/stream',
        { provider: providerId, exam: examKey, questionId: question.id, level, previousHints },
        {
          onDelta: (text) => patch(text),
          onDone: () => onConsumed(),
          onError: (message) =>
            setEntries((current) => ({
              ...current,
              [entryKey]: { ...(current[entryKey] ?? EMPTY), loading: false, error: message },
            })),
        },
        controller.signal,
      );
      setEntries((current) => {
        const previous = current[entryKey] ?? EMPTY;
        return { ...current, [entryKey]: { ...previous, loading: false } };
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setEntries((current) => ({
        ...current,
        [entryKey]: { ...(current[entryKey] ?? EMPTY), loading: false, error: (err as Error).message },
      }));
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  if (mode === 'mock') {
    return (
      <div className="px-4 py-5">
        <div className="rounded-2xl bg-surface-overlay/60 p-4">
          <p className="text-sm font-semibold text-content-primary">Guided hints are paused</p>
          <p className="mt-1 text-xs leading-relaxed text-content-muted">
            This is a timed exam. Hints and answer walkthroughs unlock after you submit, so nothing here can
            influence the score.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="rounded-2xl bg-accent/[0.055] p-4">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-accent">
            <IconSparkles width={12} height={12} /> Orient first
          </p>
          <ul className="mt-2 space-y-1.5">
            {primer.map((line) => (
              <li key={line} className="flex gap-2 text-[0.8125rem] leading-relaxed text-content-secondary">
                <span aria-hidden="true" className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        {entry.texts.length > 0 ? (
          <ol className="mt-4 space-y-3">
            {entry.texts.map((text, index) => (
              <li key={index} className="relative pl-7">
                <span className="numeric absolute left-0 top-0 grid h-5 w-5 place-items-center rounded-full bg-accent text-[0.625rem] font-bold text-[rgb(var(--accent-contrast))]">
                  {index + 1}
                </span>
                {index < entry.texts.length - 1 ? (
                  <span aria-hidden="true" className="absolute left-2.5 top-6 h-[calc(100%+0.4rem)] w-px bg-surface-border" />
                ) : null}
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-content-muted">
                  {LEVELS[index]}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-content-secondary">
                  {text}
                  {entry.loading && index === entry.texts.length - 1 ? (
                    <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-accent" />
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        ) : null}

        {entry.error ? (
          <p className="mt-3 rounded-xl bg-negative/[0.07] px-3 py-2 text-xs text-negative" role="alert">
            {entry.error}
          </p>
        ) : null}

        {!aiEnabled ? (
          <p className="mt-4 text-xs leading-relaxed text-content-muted">
            AI hints are unavailable right now. The reading prompt above still applies.
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-surface-border/70 p-3">
        {entry.texts.length < LEVELS.length ? (
          <button
            type="button"
            onClick={() => void requestHint()}
            disabled={entry.loading || !aiEnabled}
            className="btn-primary btn-block"
          >
            {entry.loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Thinking...
              </>
            ) : entry.texts.length === 0 ? (
              <>
                <IconSparkles width={15} height={15} /> Reveal a nudge
              </>
            ) : (
              <>
                Go deeper <IconArrowRight width={15} height={15} />
              </>
            )}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-center text-[0.6875rem] leading-relaxed text-content-muted">
              You have all three hints. Commit to an answer, then unlock the walkthrough.
            </p>
            <button type="button" onClick={onOpenExplain} className="btn-secondary btn-block">
              Open walkthrough <IconArrowRight width={15} height={15} />
            </button>
          </div>
        )}

        {entry.loading ? (
          <button
            type="button"
            onClick={() => {
              abort.current?.abort();
              setEntries((current) => ({
                ...current,
                [entryKey]: { ...(current[entryKey] ?? EMPTY), loading: false },
              }));
            }}
            className="mt-1 flex w-full items-center justify-center gap-1.5 py-1.5 text-[0.6875rem] font-semibold text-content-muted hover:text-content-secondary"
          >
            <IconStop width={12} height={12} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenChat}
            className="mt-1 flex w-full items-center justify-center gap-1.5 py-1.5 text-[0.6875rem] font-semibold text-content-muted hover:text-accent"
          >
            Ask the tutor instead
          </button>
        )}
      </div>
    </div>
  );
}