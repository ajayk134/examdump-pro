'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * Keeps the AI tutor beside the question on a desktop and as a full-height
 * sheet on a phone, without navigating away from the session.
 *
 * The panel stays mounted once opened (`open` only hides it) so a streaming
 * answer is not cut off when the learner glances back at the question. On a
 * desktop it sticks below the session bar and is sized to the remaining
 * viewport, so the composer and follow-up strip are always reachable.
 */
export function AiDock({
  open,
  onClose,
  title,
  children,
  label = 'AI tutor',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  // Open the dock in position: a tall question can start it below the fold, so
  // bring the composer into view once rather than making the learner scroll.
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const element = ref.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[90] bg-slate-950/55 backdrop-blur-sm lg:hidden',
          !open && 'hidden',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={ref}
        aria-label={label}
        aria-hidden={!open}
        className={cn(
          'fixed inset-x-0 bottom-0 top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] z-[100] flex flex-col overflow-hidden border-t border-surface-border bg-surface-raised shadow-2xl',
          'lg:sticky lg:inset-auto lg:top-[calc(var(--header-h)+4.5rem)] lg:z-auto lg:h-[calc(100dvh-var(--header-h)-5.25rem)] lg:w-[25rem] lg:shrink-0 lg:self-start lg:rounded-[1.6rem] lg:border lg:shadow-sm',
          !open && 'hidden',
        )}
      >
        <div aria-hidden="true" className="flex shrink-0 justify-center py-1.5 lg:hidden">
          <span className="h-1 w-10 rounded-full bg-surface-border-strong" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {children}
        </div>
      </aside>
    </>
  );
}