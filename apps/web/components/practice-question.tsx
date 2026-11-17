'use client';

import { useEffect, useRef, useState } from 'react';
import type { Question } from '@/lib/types';
import { stripAnswerLabel } from '@examdump/shared';
import { get, post, streamPost } from '@/lib/api';
import { useAuth, useToast } from './providers';
import { QuestionStage } from './question-stage';
import { Markdown } from './markdown';
import { QuestionContent } from './question-content';
import {
  IconArrowRight,
  IconCheck,
  IconFlag,
  IconMessage,
  IconNote,
  IconRefresh,
  IconSparkles,
  IconStop,
  IconX,
  IconBookmark,
} from './icons';
import { cn } from '@/lib/format';

interface Props {
  question: Question;
  /** Absolute position in the session, zero-based. */
  index: number;
  total: number;
  providerId: string;
  examKey: string;
  selected: string[];
  revealed: boolean;
  correct: boolean | null;
  flagged: boolean;
  bookmarked: boolean;
  aiEnabled: boolean;
  aiRemaining: number | null;
  showShortcuts?: boolean;
  /** Keyboard cursor when more than one question is on screen. */
  active?: boolean;
  onToggle: (key: string) => void;
  onCheck: () => void;
  onClear: () => void;
  onRetry: () => void;
  onToggleFlag: () => void;
  onToggleBookmark: () => void;
  onAskAi: () => void;
  onNext?: () => void;
  onAiUsage: (remaining: number | null) => void;
}

/**
 * A practice question with immediate, server-verified feedback.
 *
 * Practice is the only mode that reveals the answer while answering: the card
 * grades locally for the badge, while the runner records the attempt through
 * `POST /analytics/practice`, which re-grades before counting it.
 */
export function PracticeQuestion({
  question,
  index,
  total,
  providerId,
  examKey,
  selected,
  revealed,
  correct,
  flagged,
  bookmarked,
  aiEnabled,
  aiRemaining,
  showShortcuts,
  active,
  onToggle,
  onCheck,
  onClear,
  onRetry,
  onToggleFlag,
  onToggleBookmark,
  onAskAi,
  onNext,
  onAiUsage,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [hintText, setHintText] = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const [hintStreaming, setHintStreaming] = useState(false);
  const [hintError, setHintError] = useState('');
  const [votesOpen, setVotesOpen] = useState(false);
  const aiAbort = useRef<AbortController | null>(null);
  const hintAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      hintAbort.current?.abort();
      aiAbort.current?.abort();
    },
    [],
  );

  // Moving to another question in the same slot must not keep this one's answer
  // commentary on screen.
  useEffect(() => {
    setAiText('');
    setAiError('');
    setHintText('');
    setHintError('');
  }, [question.id]);

  const answerKey = question.answer ?? '';
  const answerLabel = stripAnswerLabel(question.answerText ?? '') || answerKey;

  const explain = async () => {
    if (!user) {
      toast('Sign in to use the AI tutor.', 'info');
      return;
    }
    aiAbort.current?.abort();
    const controller = new AbortController();
    aiAbort.current = controller;
    setAiLoading(true);
    setAiText('');
    setAiError('');

    let received = false;
    try {
      await streamPost(
        '/ai/explain/stream',
        { provider: providerId, exam: examKey, questionId: question.id, choice: selected },
        {
          onDelta: (text) => {
            received = true;
            setAiText((prev) => prev + text);
          },
          onDone: () => onAiUsage(aiRemaining === null ? null : Math.max(0, aiRemaining - 1)),
          onError: (message) => setAiError(message),
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
      aiAbort.current = null;
    }

    if (!received && !controller.signal.aborted) {
      try {
        const data = await post<{ explanation: string; remaining?: number; degraded?: boolean }>(
          '/ai/explain',
          { provider: providerId, exam: examKey, questionId: question.id, choice: selected },
        );
        setAiText(data.explanation);
        setAiError('');
        if (typeof data.remaining === 'number') onAiUsage(data.remaining);
      } catch (err) {
        setAiError((err as Error).message);
      }
    }
  };

  const stopExplain = () => {
    aiAbort.current?.abort();
    setAiLoading(false);
  };

  const requestHint = async () => {
    if (!user) {
      toast('Sign in to use the AI tutor.', 'info');
      return;
    }
    hintAbort.current?.abort();
    const controller = new AbortController();
    hintAbort.current = controller;
    setHintError('');
    setHintText('');
    setHintLoading(true);
    setHintStreaming(false);

    let received = false;
    const watchdog = window.setTimeout(() => {
      if (hintAbort.current === controller && !received) {
        controller.abort();
        setHintLoading(false);
        setHintStreaming(false);
        setHintError('The hint is taking too long. Please try again.');
      }
    }, 45000);

    try {
      await streamPost(
        '/ai/hint/stream',
        { provider: providerId, exam: examKey, questionId: question.id },
        {
          onDelta: (text) => {
            if (!received) {
              received = true;
              setHintLoading(false);
              setHintStreaming(true);
            }
            setHintText((prev) => prev + text);
          },
          onDone: () => onAiUsage(aiRemaining === null ? null : Math.max(0, aiRemaining - 1)),
          onError: (message) => setHintError(message),
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setHintError((err as Error).message);
    } finally {
      window.clearTimeout(watchdog);
      if (hintAbort.current === controller) {
        setHintLoading(false);
        setHintStreaming(false);
        hintAbort.current = null;
      }
    }
  };

  const stopHint = () => {
    hintAbort.current?.abort();
    hintAbort.current = null;
    setHintLoading(false);
    setHintStreaming(false);
  };

  const openNote = async () => {
    if (!user) {
      toast('Sign in to save notes.', 'info');
      return;
    }
    setNoteOpen((open) => !open);
    if (!note) {
      try {
        const data = await get<{ items: Array<{ questionId: string; body: string }> }>(
          `/notes?examKey=${encodeURIComponent(examKey)}&pageSize=100`,
        );
        const found = data.items.find((item) => item.questionId === question.id);
        if (found) setNote(found.body);
      } catch {
        /* notes are optional */
      }
    }
  };

  const saveNote = async () => {
    if (!user) {
      toast('Sign in to save notes.', 'info');
      return;
    }
    setNoteSaving(true);
    try {
      await post('/notes', { provider: providerId, exam: examKey, questionId: question.id, body: note });
      toast('Note saved', 'success');
      setNoteOpen(false);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setNoteSaving(false);
    }
  };

  const isLast = index === total - 1;
  const correctCount = answerKey.length;

  const feedback =
    revealed && answerKey ? (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[1rem] border px-3.5 py-3',
          correct
            ? 'border-positive/40 bg-positive/[0.07]'
            : 'border-negative/40 bg-negative/[0.06]',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-sm font-bold',
            correct ? 'text-positive' : 'text-negative',
          )}
        >
          {correct ? <IconCheck width={16} height={16} /> : <IconX width={16} height={16} />}
          {correct ? 'Correct' : 'Incorrect'}
        </span>
        <span className="text-sm text-content-secondary">
          Answer: <strong className="numeric font-semibold text-content-primary">{answerKey}</strong>
          {answerLabel && answerLabel !== answerKey ? ` · ${answerLabel}` : ''}
        </span>
        {!correct && selected.length > 0 ? (
          <span className="text-sm text-content-muted">
            You chose <strong className="numeric text-content-secondary">{[...selected].sort().join('')}</strong>
          </span>
        ) : null}
      </div>
    ) : null;

  return (
    <QuestionStage
      question={question}
      label={`Q${index + 1}`}
      mode="practice"
      selected={selected}
      onToggle={onToggle}
      revealed={revealed}
      answer={question.answer}
      disabled={revealed}
      showShortcuts={showShortcuts}
      active={active}
      badges={
        <>
          {revealed ? (
            <span className={cn('badge', correct ? 'badge-success' : 'badge-danger')}>
              {correct ? 'Correct' : 'Incorrect'}
            </span>
          ) : null}
          {flagged ? (
            <span className="badge badge-warning">
              <IconFlag width={11} height={11} /> Marked
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={onToggleFlag}
            className={cn('icon-btn', flagged && 'text-caution')}
            aria-label={flagged ? 'Remove review flag' : 'Mark for review'}
            aria-pressed={flagged}
            title={flagged ? 'Remove review flag' : 'Mark for review'}
          >
            <IconFlag className={flagged ? 'fill-current' : undefined} />
          </button>
          <button
            type="button"
            onClick={onToggleBookmark}
            className={cn('icon-btn', bookmarked && 'text-accent')}
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
            aria-pressed={bookmarked}
            title={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
          >
            <IconBookmark className={bookmarked ? 'fill-current' : undefined} />
          </button>
          <button
            type="button"
            onClick={() => void openNote()}
            className={cn('icon-btn', noteOpen && 'text-accent')}
            aria-label="Add a note"
            aria-expanded={noteOpen}
            title="Add a note"
          >
            <IconNote />
          </button>
        </>
      }
      footer={
        <div className="flex flex-col gap-3">
          {feedback}

          <div className="flex flex-wrap items-center gap-2">
            {!revealed ? (
              <>
                <button type="button" onClick={onCheck} disabled={selected.length === 0} className="btn-primary">
                  Check answer
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  disabled={selected.length === 0}
                  className="btn-ghost"
                >
                  Clear answer
                </button>
                {aiEnabled ? (
                  hintLoading || hintStreaming ? (
                    <button type="button" onClick={stopHint} className="btn-ghost">
                      <IconStop width={15} height={15} /> {hintLoading ? 'Thinking...' : 'Stop hint'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void requestHint()} className="btn-ghost">
                      <IconSparkles width={15} height={15} /> {hintText ? 'Another hint' : 'Hint'}
                    </button>
                  )
                ) : null}
              </>
            ) : (
              <>
                {onNext ? (
                  <button type="button" onClick={onNext} className="btn-primary">
                    {isLast ? 'Finish session' : 'Next question'}
                    <IconArrowRight width={16} height={16} />
                  </button>
                ) : null}
                <button type="button" onClick={onRetry} className="btn-secondary">
                  <IconRefresh width={15} height={15} /> Try again
                </button>
                {aiEnabled ? (
                  aiLoading ? (
                    <button type="button" onClick={stopExplain} className="btn-secondary">
                      <IconStop width={15} height={15} /> Stop
                    </button>
                  ) : (
                    <button type="button" onClick={() => void explain()} className="btn-ghost">
                      <IconSparkles width={15} height={15} /> {aiText ? 'Explain again' : 'AI explain'}
                    </button>
                  )
                ) : null}
              </>
            )}
            {aiEnabled ? (
              <button type="button" onClick={onAskAi} className="btn-secondary">
                <IconMessage width={15} height={15} /> Ask AI
              </button>
            ) : null}
          </div>

          {revealed ? (
            <div className="space-y-3 border-t border-surface-border pt-3">
              <div className="rounded-[1.1rem] border border-surface-border bg-surface-overlay/40 p-3.5">
                <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-content-muted">
                  Explanation
                </p>
                {question.explanation ? (
                  <div className="answer-prose text-[0.9375rem] leading-relaxed">
                    <QuestionContent items={[{ type: 'text', value: question.explanation }]} />
                  </div>
                ) : (
                  <p className="text-sm text-content-secondary">
                    This item has no written explanation in the source data. Ask the AI tutor to walk
                    through it.
                  </p>
                )}
                {question.votes.length > 0 ? (
                  <div className="mt-2.5">
                    <button
                      type="button"
                      onClick={() => setVotesOpen((open) => !open)}
                      aria-expanded={votesOpen}
                      className="text-[0.6875rem] font-semibold text-accent underline-offset-2 hover:underline"
                    >
                      {votesOpen ? 'Hide community answers' : 'Community answers'}
                    </button>
                    {votesOpen ? (
                      <div className="mt-2">
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-inset">
                          {question.votes.map((vote, i) => (
                            <div
                              key={`${vote.answer}-${i}`}
                              title={`${vote.answer}: ${vote.percentage}%`}
                              style={{ width: `${vote.percentage}%` }}
                              className={i === 0 ? 'bg-positive' : i === 1 ? 'bg-accent' : 'bg-content-muted'}
                            />
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-3 text-[0.6875rem] text-content-muted">
                          {question.votes.map((vote, i) => (
                            <span key={`${vote.answer}-label-${i}`}>
                              <b className="text-content-secondary">{vote.answer}</b> {vote.percentage}% (
                              {vote.count})
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {correctCount > 1 ? (
                <p className="caption">
                  This item is graded as a set: every correct option must be selected, with no extras.
                </p>
              ) : null}
            </div>
          ) : null}

          {hintText || hintLoading || hintError ? (
            <div className="rounded-[1.1rem] border border-caution/30 bg-caution/[0.06] p-3.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-caution">
                  <IconSparkles width={15} height={15} /> Hint
                </p>
                {hintStreaming ? (
                  <span className="text-[0.6875rem] text-content-muted">writing…</span>
                ) : hintText ? (
                  <span className="text-[0.6875rem] text-content-muted">done</span>
                ) : null}
              </div>
              {hintError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 text-sm text-content-secondary">{hintError}</p>
                  <button type="button" onClick={() => void requestHint()} className="btn-ghost btn-sm">
                    Try again
                  </button>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-content-secondary">
                  {hintText}
                  {hintStreaming ? (
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-caution align-middle"
                    />
                  ) : null}
                </p>
              )}
              {hintLoading ? (
                <p className="flex items-center gap-2 text-sm text-content-muted">
                  Thinking... <span className="dot-pulse" aria-hidden="true" />
                </p>
              ) : null}
            </div>
          ) : null}

          {aiText || aiLoading || aiError ? (
            <div className="rounded-[1.1rem] border border-accent/30 bg-accent/[0.05] p-3.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-accent">
                  <IconSparkles width={15} height={15} /> AI explanation
                  {aiLoading ? <span className="font-normal text-content-muted">· thinking</span> : null}
                </p>
                {aiRemaining !== null ? (
                  <span className="numeric text-[0.6875rem] text-content-muted">{aiRemaining} left today</span>
                ) : null}
              </div>
              {aiText ? (
                <div className="answer-prose text-[0.9375rem]">
                  <Markdown content={aiText} />
                  {aiLoading ? <span className="caret" aria-hidden="true" /> : null}
                </div>
              ) : aiLoading ? (
                <div className="space-y-2" aria-live="polite" aria-busy="true">
                  <span className="sr-only">Generating explanation</span>
                  <div className="skeleton h-3.5 w-full" />
                  <div className="skeleton h-3.5 w-5/6" />
                </div>
              ) : null}
              {aiError ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-negative">{aiError}</p>
                  <button type="button" onClick={() => void explain()} className="btn-secondary btn-sm">
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {noteOpen ? (
            <div className="space-y-2 rounded-[1.1rem] border border-surface-border bg-surface-overlay/40 p-3.5">
              <label htmlFor={`note-${question.id}`} className="label">
                Your note
              </label>
              <textarea
                id={`note-${question.id}`}
                className="input min-h-24"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Write something you want to remember..."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveNote()}
                  className="btn-primary btn-sm"
                  disabled={noteSaving || !note.trim()}
                >
                  {noteSaving ? 'Saving...' : 'Save note'}
                </button>
                <button type="button" onClick={() => setNoteOpen(false)} className="btn-ghost btn-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  );
}