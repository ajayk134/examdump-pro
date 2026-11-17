'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/format';
import { ProgressBar } from '../ui';
import {
  IconArrowLeft,
  IconBookOpen,
  IconClock,
  IconGrid,
  IconMessage,
  IconSparkles,
} from '../icons';

export interface WorkspaceTimer {
  label: string;
  /** Remaining seconds for a timed mock; omitted for practice. */
  remaining?: number | null;
  low?: boolean;
}

/**
 * The frame around a practice or mock workspace.
 *
 * Desktop is a three-part studio: a compact session map, the open reading
 * column, and the study companion. Phones keep one column and surface the map,
 * guide and tutor through a floating utility bar above the site navigation.
 */
export function QuestionWorkspace({
  mode,
  examCode,
  backHref,
  backLabel,
  total,
  answered,
  flagged,
  progress,
  timer,
  range,
  onOpenMap,
  onOpenGuide,
  children,
  rail,
  companion,
}: {
  mode: 'practice' | 'mock';
  examCode: string;
  backHref: string;
  backLabel: string;
  total: number;
  answered: number;
  flagged: number;
  progress: number;
  timer: WorkspaceTimer;
  range: string;
  onOpenMap: () => void;
  onOpenGuide: (tab: 'guide' | 'explain' | 'ask') => void;
  children: ReactNode;
  rail: ReactNode;
  companion: ReactNode;
}) {
  return (
    <div className="relative w-full">
      <header className="sticky top-14 z-40 -mx-3.5 border-b border-surface-border/70 bg-surface-base/85 px-3.5 backdrop-blur-xl sm:top-16 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex h-[3.75rem] max-w-[104rem] items-center gap-2.5 sm:gap-4">
          <Link href={backHref} className="icon-btn shrink-0" aria-label={backLabel}>
            <IconArrowLeft />
          </Link>

          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-mono text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-accent">
                {examCode}
              </span>
              <span className="hidden rounded-full bg-surface-overlay px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-[0.1em] text-content-muted sm:inline">
                {mode === 'practice' ? 'Practice' : 'Exam'}
              </span>
            </div>
            <p className="numeric truncate text-[0.75rem] font-semibold text-content-secondary">{range}</p>
          </div>

          <div className="ml-auto hidden min-w-[9rem] max-w-[16rem] flex-1 items-center gap-2 md:flex">
            <ProgressBar value={progress} className="h-1" label="Session progress" />
            <span className="numeric shrink-0 text-[0.6875rem] font-semibold text-content-muted">
              {answered}/{total}
            </span>
          </div>

          <div
            role="timer"
            aria-label={mode === 'mock' ? 'Time remaining' : 'Time in this session'}
            className={cn(
              'numeric flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-bold tabular-nums',
              timer.low
                ? 'animate-pulse bg-negative/10 text-negative'
                : 'bg-surface-overlay/70 text-content-secondary',
            )}
          >
            <IconClock width={13} height={13} />
            {timer.label}
          </div>

          <div className="hidden items-center gap-1 sm:flex">
            <button type="button" onClick={onOpenMap} className="icon-btn lg:hidden" aria-label="Open session map">
              <IconGrid />
            </button>
            {mode === 'practice' ? (
              <button
                type="button"
                onClick={() => onOpenGuide('guide')}
                className="icon-btn lg:hidden"
                aria-label="Open study guide"
              >
                <IconSparkles />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mx-auto -mb-px max-w-[104rem] md:hidden">
          <ProgressBar value={progress} className="h-[2px] rounded-none" label="Session progress" />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[104rem] grid-cols-1 gap-x-8 pb-28 pt-5 sm:pt-7 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[12rem_minmax(0,1fr)_21rem] lg:pb-10">
        <aside className="hidden xl:block">
          <div className="scroll-thin sticky top-[calc(var(--header-h)+5.25rem)] flex h-[calc(100dvh-var(--header-h)-9rem)] flex-col overflow-hidden pr-1">
            {rail}
          </div>
        </aside>

        <main className="min-w-0">{children}</main>

        <div className="min-w-0">{companion}</div>
      </div>

      {/* Floating utility bar: the whole workspace in reach of a thumb. */}
      <nav
        aria-label="Workspace actions"
        className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom,0px)+0.5rem)] z-40 px-3 lg:hidden"
      >
        <div className="mx-auto flex max-w-md items-center gap-1 rounded-full border border-surface-border/80 bg-surface-raised/95 p-1 shadow-lg backdrop-blur-xl">
          <button
            type="button"
            onClick={onOpenMap}
            className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] font-bold uppercase tracking-[0.04em] text-content-muted transition-colors hover:text-content-primary"
          >
            <IconGrid width={17} height={17} />
            Map
          </button>
          {mode === 'practice' ? (
            <>
              <button
                type="button"
                onClick={() => onOpenGuide('guide')}
                className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] font-bold uppercase tracking-[0.04em] text-content-muted transition-colors hover:text-content-primary"
              >
                <IconSparkles width={17} height={17} />
                Hint
              </button>
              <button
                type="button"
                onClick={() => onOpenGuide('explain')}
                className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] font-bold uppercase tracking-[0.04em] text-content-muted transition-colors hover:text-content-primary"
              >
                <IconBookOpen width={17} height={17} />
                Explain
              </button>
              <button
                type="button"
                onClick={() => onOpenGuide('ask')}
                className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] font-bold uppercase tracking-[0.04em] text-content-muted transition-colors hover:text-content-primary"
              >
                <IconMessage width={17} height={17} />
                Ask
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onOpenGuide('guide')}
              className="flex min-h-11 flex-[2] flex-col items-center justify-center gap-0.5 rounded-full bg-accent/[0.08] text-[0.625rem] font-bold uppercase tracking-[0.04em] text-accent"
            >
              <IconBookOpen width={17} height={17} />
              Exam info
            </button>
          )}
          <span className="mx-0.5 h-6 w-px bg-surface-border" aria-hidden="true" />
          <span className="numeric flex min-h-11 min-w-11 flex-col items-center justify-center rounded-full bg-accent/10 px-2 text-[0.6875rem] font-bold text-accent">
            {answered}
            <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.06em] text-content-muted">
              done
            </span>
          </span>
        </div>
        {flagged > 0 ? (
          <p className="mx-auto mt-1 max-w-md text-center text-[0.625rem] font-semibold text-caution">
            {flagged} flagged for review
          </p>
        ) : null}
      </nav>
    </div>
  );
}