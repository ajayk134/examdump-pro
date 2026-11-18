'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Question } from '@/lib/types';
import { stripOptionLabelFromContent } from '@examdump/shared';
import { get, post } from '@/lib/api';
import { QuestionContent } from '../question-content';
import { Dialog } from '../ui';
import { QuestionCommunity } from './question-community';
import {
  IconArrowRight,
  IconBookmark,
  IconCheck,
  IconFlag,
  IconNote,
  IconRefresh,
  IconSparkles,
  IconX,
} from '../icons';
import { cn } from '@/lib/format';
import { useAuth, useToast } from '../providers';

export interface QuestionSheetProps {
  question: Question;
  /** Zero-based position in the session. */
  index: number;
  total: number;
  mode: 'practice' | 'mock';
  selected: string[];
  revealed: boolean;
  correct: boolean | null;
  flagged: boolean;
  bookmarked?: boolean;
  providerId: string;
  examKey: string;
  compact?: boolean;
  active?: boolean;
  showShortcuts?: boolean;
  aiEnabled?: boolean;
  onToggle: (key: string) => void;
  onCheck: () => void;
  onClear: () => void;
  onRetry: () => void;
  onToggleFlag: () => void;
  onToggleBookmark?: () => void;
  onOpenGuide: (tab: 'guide' | 'explain') => void;
  onNext?: () => void;
}

function selectionHint(question: Question): string {
  if (question.type === 'multiple') {
    const count = question.answer?.length ?? 0;
    return count > 1 ? `Choose ${count} options` : 'Choose every option that applies';
  }
  if (question.choices.length === 0) return 'Visual item';
  return 'Choose one answer';
}

/**
 * One question as an open editorial sheet.
 *
 * Deliberately not a card: the question number, stem and options share one
 * reading column with hairline separation, so a page of several questions
 * reads like a workbook rather than a stack of boxes.
 */
export function QuestionSheet({
  question,
  index,
  total,
  mode,
  selected,
  revealed,
  correct,
  flagged,
  bookmarked = false,
  providerId,
  examKey,
  compact = false,
  active = false,
  showShortcuts = false,
  aiEnabled = false,
  onToggle,
  onCheck,
  onClear,
  onRetry,
  onToggleFlag,
  onToggleBookmark,
  onOpenGuide,
  onNext,
}: QuestionSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [zoom, setZoom] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const noteId = useId();
  const noteLoaded = useRef(false);

  const answerKey = question.answer ?? '';
  const interactive = !revealed;
  const answered = selected.length > 0;
  const position = index + 1;
  const answerLabel = question.answerText?.trim() ?? '';

  useEffect(() => {
    setNote('');
    noteLoaded.current = false;
  }, [question.id]);

  const openNote = async () => {
    if (!user) {
      toast('Sign in to save notes.', 'info');
      return;
    }
    setNoteOpen(true);
    if (noteLoaded.current) return;
    noteLoaded.current = true;
    setNoteLoading(true);
    try {
      const data = await get<{ items: Array<{ questionId: string; body: string }> }>(
        `/notes?examKey=${encodeURIComponent(examKey)}&pageSize=100`,
      );
      const found = data.items.find((item) => item.questionId === question.id);
      if (found) setNote(found.body);
    } catch {
      /* notes are optional */
    } finally {
      setNoteLoading(false);
    }
  };

  const saveNote = async () => {
    if (!user) return;
    setNoteLoading(true);
    try {
      await post('/notes', { provider: providerId, exam: examKey, questionId: question.id, body: note });
      toast('Note saved', 'success');
      setNoteOpen(false);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setNoteLoading(false);
    }
  };

  return (
    <article
      data-question-id={question.id}
      data-question-type={question.type}
      aria-labelledby={`question-${question.id}`}
      className={cn(
        'group/sheet relative scroll-mt-28 border-t border-surface-border/70 first:border-t-0',
        compact ? 'py-7 sm:py-8' : 'py-9 sm:py-12',
        active && 'before:absolute before:inset-y-6 before:-left-3 before:w-[2px] before:rounded-full before:bg-accent sm:before:-left-5',
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3 sm:mb-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span
            id={`question-${question.id}`}
            className="numeric text-[0.8125rem] font-bold tracking-[0.08em] text-accent"
          >
            {String(position).padStart(2, '0')}
          </span>
          <span className="numeric text-[0.75rem] font-medium text-content-muted">of {total}</span>
          <span className="text-content-muted/60" aria-hidden="true">
            ·
          </span>
          <span className="text-[0.75rem] font-medium text-content-muted">{selectionHint(question)}</span>
          {active && showShortcuts ? (
            <>
              <span className="text-content-muted/60" aria-hidden="true">
                ·
              </span>
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-accent">
                Focused
              </span>
            </>
          ) : null}
          {question.type === 'multiple' ? (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-accent">
              Multi-select
            </span>
          ) : null}
          {mode === 'mock' && answered ? (
            <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-positive">
              Answered
            </span>
          ) : null}
          {mode === 'practice' && revealed ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em]',
                correct ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative',
              )}
            >
              {correct ? <IconCheck width={11} height={11} /> : <IconX width={11} height={11} />}
              {correct ? 'Correct' : 'Review'}
            </span>
          ) : null}
          {flagged ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-caution/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-caution">
              <IconFlag width={10} height={10} /> Flagged
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onToggleFlag}
            aria-pressed={flagged}
            aria-label={flagged ? 'Remove review flag' : 'Mark for review'}
            title={flagged ? 'Remove review flag' : 'Mark for review'}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors hover:bg-surface-overlay hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              flagged && 'text-caution',
            )}
          >
            <IconFlag className={cn('h-4 w-4', flagged && 'fill-current')} />
          </button>
          {onToggleBookmark ? (
            <button
              type="button"
              onClick={onToggleBookmark}
              aria-pressed={bookmarked}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors hover:bg-surface-overlay hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                bookmarked && 'text-accent',
              )}
            >
              <IconBookmark className={cn('h-4 w-4', bookmarked && 'fill-current')} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void openNote()}
            aria-label="Add a note"
            title="Add a note"
            className="grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors hover:bg-surface-overlay hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <IconNote className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        className={cn(
          'max-w-[68ch] text-pretty text-content-primary',
          compact
            ? 'text-[0.9375rem] leading-[1.68] sm:text-base'
            : 'text-[1.0625rem] leading-[1.72] sm:text-[1.125rem] sm:leading-[1.74]',
        )}
      >
        <QuestionContent items={question.stem} onImage={setZoom} />
      </div>

      {question.choices.length > 0 ? (
        <ul
          className={cn('mt-5 flex max-w-[68ch] flex-col', compact ? 'gap-1.5' : 'gap-2')}
          role={question.type === 'multiple' ? 'group' : 'radiogroup'}
          aria-label="Answer choices"
        >
          {question.choices.map((choice, choiceIndex) => {
            const isSelected = selected.includes(choice.key);
            const isAnswer = revealed && answerKey.includes(choice.key);
            const isWrongPick = revealed && isSelected && !isAnswer;
            const state = isAnswer ? 'correct' : isWrongPick ? 'incorrect' : isSelected ? 'selected' : 'idle';
            return (
              <li key={choice.key}>
                <button
                  type="button"
                  data-choice={choice.key}
                  data-state={state}
                  aria-pressed={isSelected}
                  disabled={!interactive}
                  onClick={() => (interactive ? onToggle(choice.key) : undefined)}
                  className={cn(
                    'option-row group/option flex w-full items-start gap-3.5 rounded-2xl px-3 text-left transition-[background-color,border-color,transform] duration-150 sm:gap-4 sm:px-4',
                    compact ? 'min-h-[3.25rem] py-2.5' : 'min-h-[3.5rem] py-3',
                    interactive ? 'cursor-pointer' : 'cursor-default',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    state === 'idle' &&
                      'border border-transparent hover:border-surface-border-strong hover:bg-surface-overlay/55',
                    state === 'selected' && 'border border-accent/45 bg-accent/[0.07]',
                    state === 'correct' && 'border border-positive/45 bg-positive/[0.07]',
                    state === 'incorrect' && 'border border-negative/45 bg-negative/[0.06]',
                    revealed && !isAnswer && !isSelected && 'opacity-55',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[0.7rem] border text-[0.8125rem] font-bold transition-colors',
                      state === 'idle' &&
                        'border-surface-border-strong bg-surface-raised text-content-secondary group-hover/option:border-accent/40 group-hover/option:text-accent',
                      state === 'selected' &&
                        'border-transparent bg-accent text-[rgb(var(--accent-contrast))] shadow-sm',
                      state === 'correct' && 'border-transparent bg-positive text-white',
                      state === 'incorrect' && 'border-transparent bg-negative text-white',
                    )}
                  >
                    {state === 'correct' ? (
                      <IconCheck width={16} height={16} />
                    ) : state === 'incorrect' ? (
                      <IconX width={16} height={16} />
                    ) : (
                      choice.key
                    )}
                  </span>

                  <span
                    className={cn(
                      'min-w-0 flex-1 text-content-primary',
                      compact ? 'text-[0.9375rem] leading-relaxed' : 'text-[0.9375rem] leading-relaxed sm:text-base',
                    )}
                  >
                    <QuestionContent
                      items={stripOptionLabelFromContent(choice.content, choice.key)}
                      onImage={setZoom}
                    />
                  </span>

                  {showShortcuts && interactive && choiceIndex < 9 ? (
                    <span className="mt-1 hidden shrink-0 sm:block" aria-hidden="true">
                      <span className="kbd">{choiceIndex + 1}</span>
                    </span>
                  ) : null}

                  {state === 'selected' ? (
                    <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10">
                      <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                    </span>
                  ) : null}
                  {revealed && isAnswer ? (
                    <span className="mt-1 hidden shrink-0 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-positive sm:block">
                      Answer
                    </span>
                  ) : isWrongPick ? (
                    <span className="mt-1 hidden shrink-0 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-negative sm:block">
                      Your pick
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-5 max-w-[68ch] rounded-2xl bg-surface-overlay/50 px-4 py-3 text-sm text-content-secondary">
          This item is visual or drag-and-drop. Review the exhibit, then open the explanation to compare
          your approach with the verified answer.
        </p>
      )}

      {revealed && mode === 'practice' && answerKey ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mt-5 max-w-[68ch] rounded-2xl px-4 py-3.5',
            correct ? 'bg-positive/[0.07]' : 'bg-negative/[0.06]',
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-bold',
                correct ? 'text-positive' : 'text-negative',
              )}
            >
              {correct ? <IconCheck width={16} height={16} /> : <IconX width={16} height={16} />}
              {correct ? 'Correct' : 'Not quite'}
            </span>
            <span className="text-sm text-content-secondary">
              Answer <strong className="numeric font-semibold text-content-primary">{answerKey}</strong>
              {answerLabel && answerLabel !== answerKey ? ` · ${answerLabel}` : ''}
            </span>
            {!correct && selected.length > 0 ? (
              <span className="text-sm text-content-muted">
                You chose <strong className="numeric text-content-secondary">{[...selected].sort().join('')}</strong>
              </span>
            ) : null}
          </div>
          {question.explanation ? (
            <div className="mt-3 border-l-2 border-surface-border-strong/70 pl-3">
              <p className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.09em] text-content-muted">
                From the source
              </p>
              <div className="text-sm leading-relaxed text-content-secondary">
                <QuestionContent items={[{ type: 'text', value: question.explanation }]} />
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenGuide('explain')}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
          >
            <IconSparkles width={14} height={14} /> Open the full walkthrough
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex max-w-[68ch] flex-wrap items-center gap-2">
        {mode === 'practice' && !revealed ? (
          <>
            <button type="button" onClick={onCheck} disabled={!answered} className="btn-primary">
              Check answer
            </button>
            <button type="button" onClick={onClear} disabled={!answered} className="btn-ghost">
              Clear
            </button>
            {aiEnabled ? (
              <button
                type="button"
                onClick={() => onOpenGuide('guide')}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/[0.07]"
              >
                <IconSparkles width={15} height={15} /> Hint
              </button>
            ) : null}
          </>
        ) : null}

        {mode === 'practice' && revealed ? (
          <>
            {onNext ? (
              <button type="button" onClick={onNext} className="btn-primary">
                Next question <IconArrowRight width={16} height={16} />
              </button>
            ) : (
              <button type="button" onClick={() => onOpenGuide('explain')} className="btn-primary">
                Walkthrough <IconArrowRight width={16} height={16} />
              </button>
            )}
            <button type="button" onClick={onRetry} className="btn-secondary">
              <IconRefresh width={15} height={15} /> Try again
            </button>
            {aiEnabled ? (
              <button type="button" onClick={() => onOpenGuide('guide')} className="btn-ghost">
                <IconSparkles width={15} height={15} /> Hint
              </button>
            ) : null}
          </>
        ) : null}

        {mode === 'mock' ? (
          <>
            <button type="button" onClick={onClear} disabled={!answered} className="btn-ghost btn-sm">
              Clear answer
            </button>
            <span className="text-[0.75rem] text-content-muted">
              {answered ? `${selected.length} selected` : 'Not answered'}
            </span>
          </>
        ) : null}

        <span className="ml-auto text-[0.75rem] text-content-muted">
          {mode === 'practice' && !revealed
            ? 'Answers save automatically'
            : mode === 'mock'
              ? 'Nothing is graded until you submit'
              : null}
        </span>
      </div>

      {mode === 'practice' && revealed ? (
        <QuestionCommunity question={question} providerId={providerId} examKey={examKey} />
      ) : null}

      {mode === 'practice' && !revealed ? (
        <p className="mt-3 max-w-[68ch] text-[0.75rem] text-content-muted">
          Community votes and discussion unlock after you check your answer.
        </p>
      ) : null}

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

      <Dialog
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Your note"
        description={`Question ${position} · saved to this exam`}
        footer={
          <>
            <button type="button" onClick={() => setNoteOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={noteLoading || !note.trim()}
              className="btn-primary"
            >
              {noteLoading ? 'Saving...' : 'Save note'}
            </button>
          </>
        }
      >
        <label htmlFor={noteId} className="sr-only">
          Note
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What do you want to remember about this question?"
          className="input min-h-32"
        />
      </Dialog>
    </article>
  );
}