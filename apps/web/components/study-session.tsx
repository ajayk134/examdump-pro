'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import type { QuestionsResponse } from '@/lib/types';
import { QuestionCard } from './question-card';
import {
  Badge,
  EmptyIcon,
  EmptyState,
  ErrorState,
  ProgressBar,
  ProgressRing,
  Skeleton,
  Drawer,
} from './ui';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChart,
  IconGrid,
  IconRefresh,
  IconX,
} from './icons';
import { cn } from '@/lib/format';
import { clearAutosave, loadAutosave, saveAutosave } from '@/lib/local-store';

type Mode = 'practice' | 'random';

interface AutosaveState {
  index: number;
  answered: string[];
}

export function StudySession({ providerId, examKey, mode }: { providerId: string; examKey: string; mode: Mode }) {
  const router = useRouter();
  const autosaveKey = `${providerId}/${examKey}/${mode}`;

  const [data, setData] = useState<QuestionsResponse | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [restored, setRestored] = useState(false);

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  /* ---------------- load ---------------- */

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    get<QuestionsResponse>(
      `/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}/questions?limit=200&mode=${mode}&includeAnswer=true&random=${mode === 'random'}`,
    )
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, examKey, mode, reloadKey]);

  /* ---------------- autosave restore ---------------- */

  useEffect(() => {
    const saved = loadAutosave<AutosaveState>(autosaveKey);
    if (saved) {
      setIndex(Math.max(0, saved.index));
      setAnswered(new Set(saved.answered));
      setRestored(true);
    } else {
      setIndex(0);
      setAnswered(new Set());
    }
  }, [autosaveKey]);

  useEffect(() => {
    if (!data) return;
    saveAutosave<AutosaveState>(autosaveKey, { index, answered: [...answered] });
  }, [data, autosaveKey, index, answered]);

  /* ---------------- derived ---------------- */

  const questions = data?.questions ?? [];
  const total = questions.length;
  const current = questions[index];
  const doneCount = answered.size;
  const progress = total ? (doneCount / total) * 100 : 0;

  const go = useCallback(
    (next: number, dir: 'next' | 'prev') => {
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(total - 1, next));
      setDirection(dir);
      setIndex(clamped);
      // Bring the new card into view on mobile where the header is sticky.
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [total],
  );

  const next = useCallback(() => go(index + 1, 'next'), [go, index]);
  const prev = useCallback(() => go(index - 1, 'prev'), [go, index]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paletteOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'j') next();
      if (e.key === 'ArrowLeft' || e.key === 'k') prev();
      if (e.key === 'g') setPaletteOpen((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, prev, paletteOpen]);

  /* ---------------- swipe ---------------- */

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Only treat as a swipe when it is mostly horizontal and long enough.
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) next();
    else prev();
  }

  /* ---------------- states ---------------- */

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <ErrorState
          title="Could not load questions"
          description={error}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
        <div className="mt-4 flex justify-center">
          <Link href={`/exams/${encodeURIComponent(providerId)}`} className="btn-secondary btn-sm">
            Back to exam
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <Skeleton className="mb-3 h-1.5 w-full rounded-full" />
        <div className="surface p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-5 w-full" />
          <Skeleton className="mb-5 h-5 w-4/5" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="mb-2.5 h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon={<EmptyIcon name="book" />}
          title="No questions available"
          description="This exam has no questions unlocked yet. Try a different exam or check back after the next sync."
          action={
            <Link href="/exams" className="btn-primary btn-sm">
              Browse exams
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* ---------- Header: progress + palette trigger ---------- */}
      <header className="sticky top-14 z-30 -mx-3.5 mb-3 border-b border-surface-border/60 bg-surface-base/92 px-3.5 py-2 backdrop-blur-lg sm:top-16 sm:mx-0 sm:rounded-xl sm:border sm:px-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}`}
            className="icon-btn -ml-1 shrink-0"
            aria-label="Back to exam"
          >
            <IconArrowLeft />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[0.8125rem] font-semibold">
                Question {index + 1}
                <span className="text-content-muted"> / {total}</span>
              </p>
              {restored ? (
                <Badge tone="accent" className="hidden sm:inline-flex">
                  Resumed
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={progress} className="h-1" label="Session progress" />
              <span className="numeric shrink-0 text-[0.6875rem] font-semibold text-content-muted">
                {doneCount}/{total}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="icon-btn"
              aria-label="Open question palette"
            >
              <IconGrid />
            </button>
            <Link
              href={`/study?provider=${encodeURIComponent(providerId)}&exam=${encodeURIComponent(examKey)}&mode=practice&reload=1`}
              onClick={() => clearAutosave(autosaveKey)}
              className="icon-btn"
              aria-label="Restart session"
            >
              <IconRefresh />
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- Card ---------- */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="touch-pan-y"
        key={`${current?.id ?? index}-${index}`}
      >
        <div className={cn('animate-pop', direction === 'prev' && 'origin-top')}>
          {current ? (
            <QuestionCard
              question={current}
              index={index}
              providerId={providerId}
              examKey={examKey}
              answered={answered.has(current.id)}
              onAnswered={() => setAnswered((prev) => new Set(prev).add(current.id))}
            />
          ) : null}
        </div>
      </div>

      {/* ---------- Bottom navigation ---------- */}
      <nav
        className="mt-3 flex items-center justify-between gap-2"
        aria-label="Question navigation"
      >
        <button type="button" onClick={prev} disabled={index === 0} className="btn-secondary flex-1 sm:flex-none">
          <IconArrowLeft className="h-4 w-4" />
          Previous
        </button>

        <span className="caption hidden shrink-0 sm:block">Swipe or use ← →</span>

        {index === total - 1 ? (
          <button
            type="button"
            onClick={() => router.push(`/history`)}
            className="btn-primary flex-1 sm:flex-none"
          >
            Finish
            <IconCheck className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={next} className="btn-primary flex-1 sm:flex-none">
            Next
            <IconArrowRight className="h-4 w-4" />
          </button>
        )}
      </nav>

      {/* ---------- Session summary ---------- */}
      {doneCount > 0 && doneCount === total ? (
        <div className="surface mt-4 flex items-center gap-3 p-4">
          <ProgressRing value={100} size={52} tone="success">
            <IconCheck className="h-5 w-5 text-positive" />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="heading-3">Session complete</p>
            <p className="caption">You answered all {total} questions in this session.</p>
          </div>
          <Link href="/dashboard" className="btn-primary btn-sm shrink-0">
            <IconChart className="h-4 w-4" />
            Analytics
          </Link>
        </div>
      ) : null}

      {/* ---------- Palette ---------- */}
      <Drawer open={paletteOpen} onClose={() => setPaletteOpen(false)} title="Question palette" side="bottom">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <div>
            <p className="heading-3">Question palette</p>
            <p className="caption mt-0.5">
              {doneCount} answered · {total - doneCount} remaining
            </p>
          </div>
          <button type="button" onClick={() => setPaletteOpen(false)} className="icon-btn" aria-label="Close palette">
            <IconX />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
            {questions.map((q, i) => {
              const isDone = answered.has(q.id);
              const isCurrent = i === index;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    go(i, i > index ? 'next' : 'prev');
                    setPaletteOpen(false);
                  }}
                  aria-label={`Go to question ${i + 1}${isDone ? ' (answered)' : ''}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn(
                    'numeric grid aspect-square place-items-center rounded-lg text-xs font-bold transition-all',
                    isCurrent
                      ? 'bg-accent text-white shadow-sm'
                      : isDone
                        ? 'bg-positive/15 text-positive'
                        : 'bg-surface-inset text-content-muted hover:bg-surface-overlay',
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-surface-border p-3">
          <div className="mb-2 flex items-center justify-center gap-4 text-[0.6875rem] text-content-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded bg-accent" /> Current
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded bg-positive/60" /> Answered
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded bg-surface-inset" /> Remaining
            </span>
          </div>
          <button type="button" onClick={() => setPaletteOpen(false)} className="btn-secondary btn-block">
            Close
          </button>
        </div>
      </Drawer>
    </div>
  );
}
