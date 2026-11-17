'use client';

import { useEffect, useRef, useState } from 'react';
import type { Question } from '@/lib/types';
import { stripOptionLabelFromContent } from '@examdump/shared';
import { streamPost } from '@/lib/api';
import { useAuth, useToast } from '../providers';
import { QuestionContent } from '../question-content';
import { Markdown } from '../markdown';
import { IconArrowRight, IconCheck, IconLock, IconRefresh, IconSparkles, IconStop, IconX } from '../icons';
import { cn } from '@/lib/format';

interface ExplainEntry {
  text: string;
  loading: boolean;
  error: string;
  done: boolean;
}

const EMPTY: ExplainEntry = { text: '', loading: false, error: '', done: false };

/**
 * The walkthrough companion.
 *
 * Verified data comes first (answer, your pick, option-by-option reasoning and
 * the source explanation); the AI adds a structured deeper explanation only
 * after the learner has committed to an answer. Before that, the tab is
 * deliberately locked so it cannot become an answer key.
 */
export function ExplainPanel({
  question,
  mode,
  selected,
  revealed,
  correct,
  providerId,
  examKey,
  aiEnabled,
  onConsumed,
  onOpenChat,
}: {
  question: Question;
  mode: 'practice' | 'mock';
  selected: string[];
  revealed: boolean;
  correct: boolean | null;
  providerId: string;
  examKey: string;
  aiEnabled: boolean;
  onConsumed: () => void;
  onOpenChat: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<Record<string, ExplainEntry>>({});
  const abort = useRef<AbortController | null>(null);
  const entry = entries[question.id] ?? EMPTY;
  const answerKey = question.answer ?? '';
  /**
   * Reasoning models sometimes narrate their plan in the visible channel
   * before writing the answer. The walkthrough is anchored at its first
   * structured heading so planning notes never reach the reader; a model that
   * returns plain prose is shown whole once it has finished.
   */
  const headingAt = entry.text.indexOf('## ');
  const walkthrough = headingAt >= 0 ? entry.text.slice(headingAt) : entry.done ? entry.text : '';

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
  }, [question.id]);

  const run = async () => {
    if (!user) {
      toast('Sign in to use AI explanations.', 'info');
      return;
    }
    if (!aiEnabled || entry.loading) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;

    setEntries((current) => ({
      ...current,
      [question.id]: { text: '', loading: true, error: '', done: false },
    }));

    const patch = (text: string) =>
      setEntries((current) => {
        const previous = current[question.id] ?? EMPTY;
        return {
          ...current,
          [question.id]: { ...previous, text: previous.text + text },
        };
      });

    try {
      await streamPost(
        '/ai/explain/stream',
        { provider: providerId, exam: examKey, questionId: question.id, choice: selected },
        {
          onDelta: patch,
          onDone: () => {
            onConsumed();
            setEntries((current) => ({
              ...current,
              [question.id]: { ...(current[question.id] ?? EMPTY), loading: false, done: true },
            }));
          },
          onError: (message) =>
            setEntries((current) => ({
              ...current,
              [question.id]: { ...(current[question.id] ?? EMPTY), loading: false, error: message },
            })),
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setEntries((current) => ({
        ...current,
        [question.id]: { ...(current[question.id] ?? EMPTY), loading: false, error: (err as Error).message },
      }));
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  if (mode === 'mock' && !revealed) {
    return <Locked title="Walkthroughs unlock after submission" body="The mock is scored as a whole. Answers and explanations stay sealed until you submit, then the full review opens." />;
  }

  if (!revealed) {
    return (
      <Locked
        title="Answer first, then unpack it"
        body="Commit to an option and check it. The verified answer, an option-by-option breakdown and the AI walkthrough open here."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 px-4 py-4">
        <div
          className={cn(
            'rounded-2xl p-4',
            correct ? 'bg-positive/[0.07]' : 'bg-negative/[0.06]',
          )}
        >
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em]">
            {correct ? (
              <IconCheck width={13} height={13} className="text-positive" />
            ) : (
              <IconX width={13} height={13} className="text-negative" />
            )}
            <span className={correct ? 'text-positive' : 'text-negative'}>
              {correct ? 'You got it' : 'Review and rebuild'}
            </span>
          </p>
          <p className="mt-2 text-sm text-content-secondary">
            Verified answer{' '}
            <strong className="numeric text-base font-bold text-content-primary">{answerKey || '—'}</strong>
            {question.answerText && question.answerText !== answerKey ? (
              <span className="block pt-1 text-[0.8125rem] leading-relaxed text-content-secondary">
                {question.answerText}
              </span>
            ) : null}
          </p>
          {selected.length > 0 ? (
            <p className="mt-1 text-xs text-content-muted">
              You chose <strong className="numeric text-content-secondary">{[...selected].sort().join('')}</strong>
            </p>
          ) : null}
        </div>

        {question.choices.length > 0 ? (
          <section aria-label="Option breakdown">
            <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-content-muted">
              Option by option
            </p>
            <ul className="space-y-1.5">
              {question.choices.map((choice) => {
                const isAnswer = answerKey.includes(choice.key);
                const isPicked = selected.includes(choice.key);
                return (
                  <li
                    key={choice.key}
                    className={cn(
                      'flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-[0.8125rem] leading-relaxed',
                      isAnswer ? 'bg-positive/[0.06]' : isPicked ? 'bg-negative/[0.05]' : 'bg-surface-overlay/35',
                    )}
                  >
                    <span
                      className={cn(
                        'numeric mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[0.625rem] font-bold',
                        isAnswer
                          ? 'bg-positive text-white'
                          : isPicked
                            ? 'bg-negative text-white'
                            : 'bg-surface-inset text-content-muted',
                      )}
                    >
                      {choice.key}
                    </span>
                    <span className="min-w-0 flex-1 text-content-secondary">
                      <QuestionContent items={stripOptionLabelFromContent(choice.content, choice.key)} />
                    </span>
                    {isAnswer ? (
                      <span className="shrink-0 text-[0.5625rem] font-bold uppercase tracking-[0.06em] text-positive">
                        Correct
                      </span>
                    ) : isPicked ? (
                      <span className="shrink-0 text-[0.5625rem] font-bold uppercase tracking-[0.06em] text-negative">
                        Your pick
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {question.explanation ? (
          <section aria-label="Source explanation">
            <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-content-muted">
              From the source
            </p>
            <div className="rounded-xl bg-surface-overlay/45 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-content-secondary">
              <QuestionContent items={[{ type: 'text', value: question.explanation }]} />
            </div>
          </section>
        ) : null}

        {entry.text || entry.loading || entry.error ? (
          <section aria-label="AI walkthrough">
            <p className="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-accent">
              <IconSparkles width={12} height={12} /> Tutor walkthrough
            </p>
            {walkthrough ? (
              <div className="answer-prose text-[0.875rem]">
                <Markdown content={walkthrough} />
                {entry.loading ? <span className="caret" aria-hidden="true" /> : null}
              </div>
            ) : (
              <div className="space-y-2 py-1" aria-live="polite" aria-busy="true">
                <span className="sr-only">Building the walkthrough</span>
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-5/6" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            )}
            {entry.error ? (
              <p className="mt-2 rounded-xl bg-negative/[0.07] px-3 py-2 text-xs text-negative" role="alert">
                {entry.error}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-surface-border/70 p-3">
        {entry.loading ? (
          <button
            type="button"
            onClick={() => {
              abort.current?.abort();
              setEntries((current) => ({
                ...current,
                [question.id]: { ...(current[question.id] ?? EMPTY), loading: false },
              }));
            }}
            className="btn-secondary btn-block"
          >
            <IconStop width={15} height={15} /> Stop walkthrough
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            disabled={!aiEnabled}
            className="btn-primary btn-block"
          >
            {entry.text ? (
              <>
                <IconRefresh width={15} height={15} /> Rebuild walkthrough
              </>
            ) : (
              <>
                <IconSparkles width={15} height={15} /> {aiEnabled ? 'Build a deeper walkthrough' : 'AI unavailable'}
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenChat}
          className="flex w-full items-center justify-center gap-1.5 py-1.5 text-[0.6875rem] font-semibold text-content-muted hover:text-accent"
        >
          Ask about this question <IconArrowRight width={12} height={12} />
        </button>
      </div>
    </div>
  );
}

function Locked({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-overlay text-content-muted">
        <IconLock width={18} height={18} />
      </span>
      <p className="mt-3 text-sm font-semibold text-content-primary">{title}</p>
      <p className="mt-1.5 max-w-[15rem] text-xs leading-relaxed text-content-muted">{body}</p>
    </div>
  );
}