'use client';

import { useEffect, useState } from 'react';
import type { Question } from '@/lib/types';
import { QuestionContent } from './question-content';
import { useAuth, useToast } from './providers';
import { del, get, post } from '@/lib/api';
import { cn } from '@/lib/format';
import { IconBookmark, IconNote, IconSparkles, IconCheck, IconX } from './icons';

interface Props {
  question: Question;
  index?: number;
  providerId: string;
  examKey: string;
  initiallyRevealed?: boolean;
  allowPractice?: boolean;
}

export function QuestionCard({ question, index, providerId, examKey, initiallyRevealed = false, allowPractice = true }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(initiallyRevealed);
  const [bookmarked, setBookmarked] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [hintText, setHintText] = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);

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
    if (!question.answer) {
      setRevealed(true);
      return;
    }
    setRevealed(true);
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

  const explain = async () => {
    if (!user) {
      toast('Sign in to use the AI tutor.', 'info');
      return;
    }
    setAiLoading(true);
    setAiText('');
    try {
      const data = await post<{ explanation: string; degraded?: boolean; remaining?: number }>('/ai/explain', {
        provider: providerId,
        exam: examKey,
        questionId: question.id,
        choice: selected,
      });
      setAiText(data.explanation);
      if (typeof data.remaining === 'number') setAiRemaining(data.remaining);
      else setAiRemaining((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
      if (data.degraded) setAiEnabled(false);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const requestHint = async () => {
    if (!user) {
      toast('Sign in to use the AI tutor.', 'info');
      return;
    }
    setHintLoading(true);
    setHintText('');
    try {
      const data = await post<{ hint: string; degraded?: boolean }>('/ai/hint', {
        provider: providerId,
        exam: examKey,
        questionId: question.id,
      });
      setHintText(data.hint);
      if (data.degraded) setAiEnabled(false);
      else setAiRemaining((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setHintLoading(false);
    }
  };

  const sortedSelected = [...selected].sort().join('');
  const sortedCorrect = correct.split('').sort().join('');
  const isCorrect = correct.length > 0 && sortedSelected === sortedCorrect;

  const choiceClass = (key: string) => {
    const isSelected = selected.includes(key);
    if (!revealed) {
      return isSelected ? 'border-brand-400 bg-brand-500/10' : 'border-surface-border hover:border-brand-400/60 hover:bg-surface-overlay';
    }
    const isAnswer = correct.includes(key);
    if (isAnswer) return 'border-emerald-400/70 bg-emerald-500/10';
    if (isSelected && !isAnswer) return 'border-rose-400/70 bg-rose-500/10';
    return 'border-surface-border opacity-80';
  };

  return (
    <article className="card p-5 sm:p-6" aria-label={`Question ${index ?? ''}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-surface-overlay px-2.5 py-1 text-xs font-semibold text-content-secondary">
            Q{question.number ?? index ?? ''}
          </span>
          {question.type === 'multiple' ? <span className="badge">Multiple answers</span> : null}
          {question.type === 'dragdrop' ? <span className="badge">Drag & drop / visual</span> : null}
          {question.stemImages.length > 0 ? <span className="badge">{question.stemImages.length} image{question.stemImages.length > 1 ? 's' : ''}</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleBookmark} className={cn('btn-ghost h-9 w-9 !px-0', bookmarked && 'text-amber-400')} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark question'} aria-pressed={bookmarked}>
            <IconBookmark />
          </button>
          <button onClick={loadNote} className="btn-ghost h-9 w-9 !px-0" aria-label="Add note">
            <IconNote />
          </button>
        </div>
      </header>

      <div className="text-[15px] leading-relaxed text-content-primary">
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
                    'flex w-full items-start gap-3 rounded-xl border p-3.5 text-left text-sm transition disabled:cursor-default',
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

      {allowPractice && question.choices.length > 0 ? (
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
                <button onClick={requestHint} className="btn-ghost" disabled={hintLoading}>
                  <IconSparkles width={16} height={16} />
                  {hintLoading ? 'Thinking…' : 'Get a hint'}
                </button>
              ) : null}
              <button onClick={explain} className="btn-ghost" disabled={aiLoading}>
                <IconSparkles width={16} height={16} /> {aiLoading ? 'Thinking…' : 'AI explain'}
              </button>
              {aiRemaining !== null ? (
                <span className="text-xs text-content-muted">{aiRemaining} AI credits left today</span>
              ) : null}
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
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 p-4">
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">
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

      {hintText ? (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/5 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-300">
            <IconSparkles width={16} height={16} /> Hint
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-content-secondary">{hintText}</p>
        </div>
      ) : null}

      {aiText ? (
        <div className="mt-4 rounded-xl border border-brand-400/30 bg-brand-500/5 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-brand-500 dark:text-brand-300"><IconSparkles width={16} height={16} /> AI explanation</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-content-secondary">{aiText}</p>
        </div>
      ) : null}

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