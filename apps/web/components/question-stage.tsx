'use client';

import { useState, type ReactNode } from 'react';
import type { Question } from '@/lib/types';
import { stripOptionLabelFromContent } from '@examdump/shared';
import { QuestionContent } from './question-content';
import { Dialog } from './ui';
import { IconCheck, IconExpand, IconX } from './icons';
import { cn } from '@/lib/format';

/**
 * How many options this item expects and whether more than one is valid.
 *
 * Practice payloads carry the answer key; mock payloads deliberately do not, so
 * the fallback relies on the question type only.
 */
export function selectionRulesFor(question: Question): { multi: boolean; limit: number } {
  const correct = question.answer ?? '';
  const required = correct.length > 0 ? correct.length : question.type === 'multiple' ? 2 : 1;
  return { multi: question.type === 'multiple' || required > 1, limit: required };
}

export interface QuestionStageProps {
  question: Question;
  /** Short label such as "Q12". */
  label: string;
  /** Session length, rendered as "of N" beside the label. */
  of?: number;
  mode: 'practice' | 'mock';
  selected: string[];
  onToggle?: (key: string) => void;
  /** Answering is done: options are locked and graded colours are shown. */
  disabled?: boolean;
  revealed?: boolean;
  /** Correct option letters; only set for practice, never during a mock. */
  answer?: string | null;
  /** Header actions (flag, bookmark, note, AI). */
  actions?: ReactNode;
  /** Extra status badges next to the label. */
  badges?: ReactNode;
  /** Feedback and controls below the options. */
  footer?: ReactNode;
  showShortcuts?: boolean;
  /** Marks the question the keyboard cursor is on when several are visible. */
  active?: boolean;
  /** Tighter spacing when several cards share one page. */
  compact?: boolean;
  className?: string;
}

/**
 * One question, presented for answering.
 *
 * The practice and mock runners both use this so the typography, option states,
 * image handling and keyboard affordances stay identical across the two flows.
 * Correctness is only ever rendered when `revealed` is true and an answer key
 * was supplied.
 */
export function QuestionStage({
  question,
  label,
  of,
  mode,
  selected,
  onToggle,
  disabled = false,
  revealed = false,
  answer,
  actions,
  badges,
  footer,
  showShortcuts = false,
  active = false,
  compact = false,
  className,
}: QuestionStageProps) {
  const [zoom, setZoom] = useState<string | null>(null);
  const { multi, limit } = selectionRulesFor(question);
  const correct = revealed ? (answer ?? question.answer ?? '') : '';
  const interactive = Boolean(onToggle) && !disabled;
  const hasChoices = question.choices.length > 0;

  const optionClass = (key: string) => {
    const isSelected = selected.includes(key);
    if (!revealed) {
      if (isSelected) return 'border-accent bg-accent/[0.08] ring-1 ring-accent/25';
      return 'border-surface-border-strong bg-surface-raised hover:border-accent/50 hover:bg-surface-overlay/70';
    }
    const isAnswer = correct.includes(key);
    if (isAnswer) return 'border-positive/55 bg-positive/[0.07]';
    if (isSelected) return 'border-negative/55 bg-negative/[0.07]';
    return 'border-surface-border bg-surface-raised opacity-65';
  };

  const letterClass = (key: string) => {
    const isSelected = selected.includes(key);
    if (!revealed) {
      return isSelected
        ? 'border-transparent bg-accent text-[rgb(var(--accent-contrast))]'
        : 'border-surface-border-strong bg-surface-raised text-content-secondary';
    }
    const isAnswer = correct.includes(key);
    if (isAnswer) return 'border-transparent bg-positive text-white';
    if (isSelected) return 'border-transparent bg-negative text-white';
    return 'border-surface-border bg-surface-raised text-content-muted';
  };

  return (
    <article
      data-question-id={question.id}
      data-question-type={question.type}
      className={cn(
        'relative scroll-mt-24 overflow-hidden rounded-[1.75rem] border bg-surface-raised shadow-sm transition-colors',
        active ? 'border-accent/60 ring-2 ring-accent/20' : 'border-surface-border',
        className,
      )}
      aria-labelledby={`q-${question.id}-label`}
    >
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-b border-surface-border/70',
          compact ? 'px-3.5 py-2' : 'px-4 py-2.5 sm:px-5',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="inline-flex min-w-0 items-baseline gap-1">
            <span
              id={`q-${question.id}-label`}
              className={cn(
                'numeric rounded-full bg-accent/[0.09] font-bold text-accent ring-1 ring-inset ring-accent/15',
                compact ? 'px-2 py-0.5 text-[0.6875rem]' : 'px-2.5 py-1 text-[0.75rem]',
              )}
            >
              {label}
            </span>
            {of ? (
              <span className="numeric text-[0.6875rem] font-semibold text-content-muted">of {of}</span>
            ) : null}
          </span>
          {active ? <span className="badge badge-accent">Active</span> : null}
          {question.type === 'multiple' ? (
            <span className="badge badge-accent">Select all that apply</span>
          ) : null}
          {question.type === 'dragdrop' ? <span className="badge">Visual</span> : null}
          {multi && question.answer && hasChoices && question.type === 'multiple' ? (
            <span className="badge">Choose {limit}</span>
          ) : null}
          {badges}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </header>

      <div className={cn(compact ? 'px-3.5 py-3.5' : 'px-4 py-4 sm:px-5 sm:py-5')}>
        <div
          className={cn(
            'max-w-[70ch] text-content-primary',
            compact ? 'text-[0.9375rem] leading-[1.65]' : 'text-[1rem] leading-[1.7] sm:text-[1.0625rem]',
          )}
        >
          <QuestionContent items={question.stem} onImage={setZoom} />
        </div>

        {hasChoices ? (
          <>
            {multi ? (
              <p className="caption mt-3">
                {revealed
                  ? `The answer accepts ${correct.length || limit} option${(correct.length || limit) === 1 ? '' : 's'}.`
                  : mode === 'mock'
                    ? 'Select every option that applies. Your answer is saved as you go.'
                    : 'Select every option that applies, then check your answer.'}
              </p>
            ) : null}
            <ul
              className={cn('mt-3 flex flex-col', compact ? 'gap-1.5' : 'gap-2 sm:gap-2.5')}
              role={multi ? 'group' : 'radiogroup'}
              aria-label="Answer choices"
            >
              {question.choices.map((choice, i) => {
                const isSelected = selected.includes(choice.key);
                const isAnswer = revealed && correct.includes(choice.key);
                const isWrongPick = revealed && isSelected && !isAnswer;
                return (
                  <li key={choice.key}>
                    <button
                      type="button"
                      onClick={() => (interactive ? onToggle?.(choice.key) : undefined)}
                      disabled={!interactive}
                      aria-pressed={isSelected}
                      data-choice={choice.key}
                      data-state={isAnswer ? 'correct' : isWrongPick ? 'incorrect' : isSelected ? 'selected' : 'idle'}
                      className={cn(
                        'group flex w-full items-start gap-3 rounded-[1rem] border text-left transition-colors duration-150',
                        compact ? 'min-h-12 px-3 py-2.5' : 'min-h-14 px-3 py-3 sm:px-4',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                        interactive ? 'cursor-pointer' : 'cursor-default',
                        optionClass(choice.key),
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[0.65rem] border text-[0.75rem] font-bold',
                          letterClass(choice.key),
                        )}
                      >
                        {isAnswer ? (
                          <IconCheck width={15} height={15} />
                        ) : isWrongPick ? (
                          <IconX width={15} height={15} />
                        ) : (
                          choice.key
                        )}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-content-primary',
                          compact
                            ? 'text-[0.9375rem] leading-relaxed'
                            : 'text-[0.9375rem] leading-relaxed sm:text-base',
                        )}
                      >
                        <QuestionContent
                          items={stripOptionLabelFromContent(choice.content, choice.key)}
                          onImage={setZoom}
                        />
                      </span>
                      {showShortcuts && interactive && i < 9 ? (
                        <span className="ml-auto hidden shrink-0 pt-1 sm:block" aria-hidden="true">
                          <span className="kbd">{i + 1}</span>
                        </span>
                      ) : null}
                      {!revealed && isSelected ? (
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[rgb(var(--accent-contrast))]"
                        >
                          <IconCheck width={12} height={12} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-surface-border bg-surface-overlay/60 p-3 text-sm text-content-muted">
            This is a visual or drag-and-drop question, so there are no options to pick. Review the
            question and the suggested answer below.
          </p>
        )}

        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>

      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} title="Question image">
        {zoom ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={zoom}
            alt="Question diagram, full size"
            referrerPolicy="no-referrer"
            className="w-full rounded-xl border border-surface-border bg-white object-contain p-1"
          />
        ) : null}
      </Dialog>
    </article>
  );
}

/** Small "open full size" affordance reused by the review screens. */
export function ExpandHint() {
  return (
    <span className="caption inline-flex items-center gap-1">
      <IconExpand width={12} height={12} /> Tap a diagram to enlarge
    </span>
  );
}