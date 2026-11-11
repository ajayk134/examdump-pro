'use client';

import { useEffect, useRef, useState } from 'react';
import type { Question } from '@/lib/types';
import { QuestionContent } from './question-content';
import { useAuth, useToast } from './providers';
import { del, get, post, streamPost } from '@/lib/api';
import { cn } from '@/lib/format';
import { Drawer } from './ui';
import { AiChat } from './ai-chat';
import { IconBookmark, IconMessage, IconNote, IconSparkles, IconCheck, IconX, IconStop } from './icons';
import { Markdown } from './markdown';

interface Props {
  question: Question;
  index?: number;
  providerId: string;
  examKey: string;
  /** Called once when the learner first checks an answer. */
  onAnswered?: () => void;
  /** Renders a subtle "done" marker in the header. */
  answered?: boolean;
}

export function QuestionCard({ question, index, providerId, examKey, onAnswered, answered = false }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiAbort = useRef<AbortController | null>(null);
  const [hintText, setHintText] = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const [hintStreaming, setHintStreaming] = useState(false);
  const [hintError, setHintError] = useState('');
  const hintAbort = useRef<AbortController | null>(null);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(
    () => () => {
      hintAbort.current?.abort();
      aiAbort.current?.abort();
    },
    [],
  );

  const correct = question.answer ?? '';
  const required = correct.length > 0 ? correct.length : question.type === 'multiple' ? 2 : 1;
  const isMulti = question.type === 'multiple' || required > 1;

  // AI capability + quota, so the tutor button can show remaining usage and
  // stay hidden when the server has no model configured.
  useEffect(() => {
    let cancelled = false;
    get<{ enabled: boolean; remaining: number | null }>('/ai/status')
      .then((data) => {
        if (!cancelled) {
          setAiEnabled(data.enabled);
          setAiRemaining(typeof data.remaining === 'number' ? data.remaining : null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    get<{ bookmarked: boolean }>(`/bookmarks/status?examKey=${encodeURIComponent(examKey)}&questionId=${encodeURIComponent(question.id)}`)
      .then((data) => {
        if (!cancelled) setBookmarked(data.bookmarked);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, examKey, question.id]);

  const toggleChoice = (key: string) => {
    if (revealed) return;
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (!isMulti) return [key];
      if (prev.length >= required) return [key];
      return [...prev, key];
    });
  };

  const check = () => {
    setRevealed(true);
    onAnswered?.();
  };

  const reset = () => {
    setSelected([]);
    setRevealed(false);
    setAiText('');
    setHintText('');
  };

  const toggleBookmark = async () => {
    if (!user) {
      toast('Sign in to save bookmarks.', 'info');
      return;
    }
    try {
      if (bookmarked) {
        await del(`/bookmarks?examKey=${encodeURIComponent(examKey)}&questionId=${encodeURIComponent(question.id)}`);
        setBookmarked(false);
        toast('Bookmark removed', 'info');
      } else {
        await post('/bookmarks', { provider: providerId, exam: examKey, questionId: question.id });
        setBookmarked(true);
        toast('Bookmarked', 'success');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const loadNote = async () => {
    if (!user) {
      toast('Sign in to save notes.', 'info');
      return;
    }
    setNoteOpen((v) => !v);
    if (!note) {
      try {
        const data = await get<{ items: Array<{ questionId: string; body: string }> }>(`/notes?examKey=${encodeURIComponent(examKey)}&pageSize=100`);
        const found = data.items.find((n) => n.questionId === question.id);
        if (found) setNote(found.body);
      } catch {
        /* ignore */
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

  /**
   * Stream an AI explanation. Text appears progressively, the request can be
   * cancelled mid-flight, and any failure can be retried without losing the
   * question state.
   */
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
          onDone: () => {
            setAiRemaining((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
          },
          onError: (message) => {
            setAiError(message);
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAiError((err as Error).message);
      }
    } finally {
      setAiLoading(false);
      aiAbort.current = null;
    }

    // Fall back to the non-streaming endpoint if the stream produced nothing.
    if (!received && !controller.signal.aborted) {
      try {
        const data = await post<{ explanation: string; degraded?: boolean; remaining?: number }>('/ai/explain', {
          provider: providerId,
          exam: examKey,
          questionId: question.id,
          choice: selected,
        });
        setAiText(data.explanation);
        setAiError('');
        if (typeof data.remaining === 'number') setAiRemaining(data.remaining);
        if (data.degraded) setAiEnabled(false);
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
    try {
      await streamPost(
        '/ai/hint/stream',
        { provider: providerId, exam: examKey, questionId: question.id },
        {
          onDelta: (text) => {
            if (!received) {
              received = true;
              // First token: swap the spinner for the caret so the wait never
              // looks frozen between "loading" and visible output.
              setHintLoading(false);
              setHintStreaming(true);
            }
            setHintText((prev) => prev + text);
          },
          onDone: () => {
            setAiRemaining((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
          },
          onError: (message) => setHintError(message),
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setHintError((err as Error).message);
    } finally {
      setHintLoading(false);
      setHintStreaming(false);
      hintAbort.current = null;
    }
  };

  const stopHint = () => {
    hintAbort.current?.abort();
    hintAbort.current = null;
    setHintLoading(false);
    setHintStreaming(false);
  };

  const sortedSelected = [...selected].sort().join('');
  const sortedCorrect = correct.split('').sort().join('');
  const isCorrect = correct.length > 0 && sortedSelected === sortedCorrect;

  const choiceClass = (key: string) => {
    const isSelected = selected.includes(key);
    if (!revealed) {
      return isSelected
        ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
        : 'border-surface-border-strong hover:border-accent/50 hover:bg-surface-overlay active:bg-surface-overlay';
    }
    const isAnswer = correct.includes(key);
    if (isAnswer) return 'border-positive/60 bg-positive/10';
    if (isSelected && !isAnswer) return 'border-negative/60 bg-negative/10';
    return 'border-surface-border opacity-70';
  };

  return (
    <article className="surface p-4 sm:p-5" aria-label={`Question ${index !== undefined ? index + 1 : ''}`}>
      <header className="mb-3.5 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge font-mono text-content-secondary">
            Q{question.number ?? (index !== undefined ? index + 1 : '')}
          </span>
          {question.type === 'multiple' ? <span className="badge">Multi-select</span> : null}
          {question.type === 'dragdrop' ? <span className="badge">Visual</span> : null}
          {question.stemImages.length > 0 ? (
            <span className="badge">
              {question.stemImages.length} image{question.stemImages.length > 1 ? 's' : ''}
            </span>
          ) : null}
          {answered ? (
            <span className="badge badge-success">
              <IconCheck width={11} height={11} /> Done
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggleBookmark}
            className={cn('icon-btn', bookmarked && 'text-accent')}
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
            aria-pressed={bookmarked}
          >
            <IconBookmark className={bookmarked ? 'fill-current' : undefined} />
          </button>
          <button type="button" onClick={loadNote} className="icon-btn" aria-label="Add a note">
            <IconNote />
          </button>
        </div>
      </header>

      <div className="text-[0.9375rem] leading-relaxed text-content-primary sm:text-[0.9375rem]">
        <QuestionContent items={question.stem} />
      </div>

      {question.choices.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-2" role={isMulti ? 'group' : 'radiogroup'} aria-label="Answer choices">
          {question.choices.map((choice) => {
            const isSelected = selected.includes(choice.key);
            return (
              <li key={choice.key}>
                <button
                  type="button"
                  onClick={() => toggleChoice(choice.key)}
                  disabled={revealed}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition-all duration-150 disabled:cursor-default sm:p-3.5',
                    choiceClass(choice.key),
                  )}
                >
                  <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-bold', isSelected ? 'border-brand-400 text-brand-400' : 'border-surface-border text-content-muted')}>
                    {revealed && correct.includes(choice.key) ? <IconCheck width={14} height={14} /> : revealed && isSelected ? <IconX width={14} height={14} /> : choice.key}
                  </span>
                  <span className="flex-1 text-content-primary">
                    <QuestionContent items={choice.content} />
                    {choice.images.map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt="Answer option" loading="lazy" referrerPolicy="no-referrer" className="mt-2 max-h-48 rounded-lg border border-surface-border bg-white p-1 object-contain" />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-surface-border bg-surface-overlay/60 p-3 text-sm text-content-muted">
          This is a visual or drag-and-drop question. Review the question and the suggested answer below.
        </p>
      )}

      {question.choices.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!revealed ? (
            <button onClick={check} className="btn-primary" disabled={selected.length === 0}>
              Check answer
            </button>
          ) : (
            <button onClick={reset} className="btn-secondary">
              Try again
            </button>
          )}
          {aiEnabled ? (
            <>
              {!revealed ? (
                hintLoading || hintStreaming ? (
                  <button onClick={stopHint} className="btn-ghost">
                    <IconStop width={16} height={16} />
                    {hintLoading ? 'Thinking…' : 'Stop'}
                  </button>
                ) : (
                  <button onClick={requestHint} className="btn-ghost">
                    <IconSparkles width={16} height={16} />
                    {hintText ? 'Another hint' : 'Hint'}
                  </button>
                )
              ) : null}
              {aiLoading ? (
                <button onClick={stopExplain} className="btn-secondary">
                  <IconStop width={16} height={16} /> Stop
                </button>
              ) : (
                <button onClick={explain} className="btn-ghost">
                  <IconSparkles width={16} height={16} /> {aiText ? 'Explain again' : 'AI explain'}
                </button>
              )}
              <button onClick={() => setChatOpen(true)} className="btn-secondary">
                <IconMessage width={16} height={16} /> Ask AI
              </button>
            </>
          ) : null}
          {revealed && correct ? (
            <span className={cn('text-sm font-semibold', isCorrect ? 'text-emerald-500' : 'text-rose-500')}>
              {selected.length === 0 ? `Answer: ${correct}` : isCorrect ? 'Correct' : `Incorrect — answer: ${correct}`}
            </span>
          ) : null}
        </div>
      ) : null}

      {revealed ? (
        <div className="mt-5 space-y-4 border-t border-surface-border pt-4">
          <div className="rounded-xl border border-positive/30 bg-positive/[0.06] p-3.5 sm:p-4">
            <p className="text-[0.8125rem] font-semibold text-positive">
              Suggested answer: {question.answerText || correct || 'See explanation'}
            </p>
            {question.explanation ? <div className="prose-answer mt-2 text-sm text-content-secondary"><QuestionContent items={[{ type: 'text', value: question.explanation }]} /></div> : null}
          </div>
          {question.votes.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">Community votes</p>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-overlay">
                {question.votes.map((vote, i) => (
                  <div
                    key={`${vote.answer}-${i}`}
                    title={`${vote.answer}: ${vote.percentage}%`}
                    style={{ width: `${vote.percentage}%` }}
                    className={i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-brand-500' : 'bg-slate-500'}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-content-muted">
                {question.votes.map((vote, i) => (
                  <span key={`${vote.answer}-label-${i}`}>
                    <b className="text-content-secondary">{vote.answer}</b> {vote.percentage}% ({vote.count})
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {hintText || hintLoading || hintError ? (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3.5 sm:p-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-300">
              <IconSparkles width={16} height={16} /> Hint
            </p>
            {hintStreaming ? (
              <span className="text-[11px] font-medium text-content-muted">writing…</span>
            ) : hintText ? (
              <span className="text-[11px] font-medium text-content-muted">done</span>
            ) : null}
          </div>

          {hintError ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 text-sm text-content-secondary">{hintError}</p>
              <button onClick={requestHint} className="btn-ghost btn-sm shrink-0">
                Try again
              </button>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-content-secondary">
              {hintText}
              {hintStreaming ? (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-amber-500 align-middle"
                />
              ) : null}
            </p>
          )}

          {hintLoading ? (
            <p className="flex items-center gap-2 text-sm text-content-muted">
              Thinking… <span className="dot-pulse" aria-hidden="true" />
            </p>
          ) : null}
        </div>
      ) : null}

      {aiText || aiLoading || aiError ? (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.05] p-3.5 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-accent">
              <IconSparkles width={15} height={15} /> AI explanation
              {aiLoading ? <span className="font-normal text-content-muted">· thinking…</span> : null}
            </p>
            {aiRemaining !== null ? (
              <span className="numeric text-[0.6875rem] text-content-muted">{aiRemaining} left today</span>
            ) : null}
          </div>

          {aiText ? (
            <div className="answer-prose">
              <Markdown content={aiText} />
              {aiLoading ? <span className="caret" aria-hidden="true" /> : null}
            </div>
          ) : aiLoading ? (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <span className="sr-only">Generating explanation</span>
              <div className="skeleton h-3.5 w-full" />
              <div className="skeleton h-3.5 w-11/12" />
              <div className="skeleton h-3.5 w-3/4" />
            </div>
          ) : null}

          {aiError ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-xs text-negative">{aiError}</p>
              <button type="button" onClick={explain} className="btn-secondary btn-sm">
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Drawer open={chatOpen} onClose={() => setChatOpen(false)} title="Ask AI about this question">
        <AiChat
          key={`${providerId}:${examKey}:${question.id}`}
          providerId={providerId}
          examKey={examKey}
          questionId={question.id}
          examLabel={examKey}
          embedded
          onClose={() => setChatOpen(false)}
        />
      </Drawer>

      {noteOpen ? (
        <div className="mt-4 space-y-2">
          <label htmlFor={`note-${question.id}`} className="label">Your note</label>
          <textarea
            id={`note-${question.id}`}
            className="input min-h-24"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write something you want to remember…"
          />
          <div className="flex gap-2">
            <button onClick={saveNote} className="btn-primary" disabled={noteSaving || !note.trim()}>
              {noteSaving ? 'Saving…' : 'Save note'}
            </button>
            <button onClick={() => setNoteOpen(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}