'use client';

import type { Question } from '@/lib/types';
import { cn } from '@/lib/format';
import { IconBookOpen, IconMessage, IconSparkles, IconX } from '../icons';
import { HintPanel } from './hint-panel';
import { ExplainPanel } from './explain-panel';
import { TutorChat } from './tutor-chat';

export type CompanionTab = 'guide' | 'explain' | 'ask';

const TABS: Array<{ id: CompanionTab; label: string; icon: typeof IconSparkles }> = [
  { id: 'guide', label: 'Guide', icon: IconSparkles },
  { id: 'explain', label: 'Explain', icon: IconBookOpen },
  { id: 'ask', label: 'Ask', icon: IconMessage },
];

/**
 * One continuous study companion.
 *
 * All three modes stay mounted so a streamed hint, a half-written tutor answer
 * or a scroll position survives tab switches. On a phone the same component
 * becomes a full-height sheet; on desktop it is a sticky column beside the
 * reading surface.
 */
export function StudyCompanion({
  question,
  questionIndex,
  mode,
  selected,
  revealed,
  correct,
  providerId,
  examKey,
  examLabel,
  aiEnabled,
  remaining,
  tab,
  onTab,
  onConsumed,
  open,
  onClose,
}: {
  question: Question | null;
  questionIndex: number;
  mode: 'practice' | 'mock';
  selected: string[];
  revealed: boolean;
  correct: boolean | null;
  providerId: string;
  examKey: string;
  examLabel?: string;
  aiEnabled: boolean;
  remaining: number | null;
  tab: CompanionTab;
  onTab: (tab: CompanionTab) => void;
  onConsumed: () => void;
  /** Mobile sheet visibility. Desktop is always visible. */
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[104] bg-slate-950/55 backdrop-blur-sm lg:hidden',
          !open && 'hidden',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label="Study companion"
        aria-hidden={!open ? undefined : false}
        className={cn(
          'z-[105] flex min-h-0 flex-col overflow-hidden border-surface-border bg-surface-raised',
          // Phone: full-height sheet under the site header.
          'fixed inset-x-0 bottom-0 top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] border-t shadow-2xl',
          // Desktop: sticky third column.
          'lg:sticky lg:inset-auto lg:top-[calc(var(--header-h)+5.25rem)] lg:h-[calc(100dvh-var(--header-h)-9rem)] lg:max-h-[calc(100dvh-var(--header-h)-9rem)] lg:self-start lg:rounded-[1.4rem] lg:border lg:shadow-sm',
          !open && 'hidden lg:flex',
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div aria-hidden="true" className="flex shrink-0 justify-center pb-1 pt-2 lg:hidden">
          <span className="h-1 w-9 rounded-full bg-surface-border-strong" />
        </div>

        <header className="shrink-0 px-3 pb-2 pt-1.5 sm:px-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-content-muted">
                Study companion
              </p>
              <p className="mt-0.5 truncate text-[0.8125rem] font-semibold text-content-primary">
                {question ? `Question ${questionIndex + 1}` : 'Session'}
                <span className="font-normal text-content-muted">
                  {question ? ' · grounded in this item' : ''}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="icon-btn lg:hidden"
              aria-label="Close study companion"
            >
              <IconX />
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Study companion mode"
            className={cn(
              'mt-2.5 grid grid-cols-3 gap-0.5 rounded-full bg-surface-overlay/70 p-0.5',
              mode === 'mock' && 'hidden',
            )}
          >
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => onTab(id)}
                className={cn(
                  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full text-[0.75rem] font-bold transition-colors',
                  tab === id
                    ? 'bg-surface-raised text-content-primary shadow-xs'
                    : 'text-content-muted hover:text-content-secondary',
                )}
              >
                <Icon width={13} height={13} />
                {label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-surface-border/60">
          {mode === 'mock' ? (
            <ExamModePanel questionIndex={questionIndex} />
          ) : question ? (
            <>
              <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'guide' && 'hidden')}>
                <HintPanel
                  question={question}
                  mode={mode}
                  providerId={providerId}
                  examKey={examKey}
                  aiEnabled={aiEnabled}
                  onConsumed={onConsumed}
                  onOpenExplain={() => onTab('explain')}
                  onOpenChat={() => onTab('ask')}
                />
              </div>
              <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'explain' && 'hidden')}>
                <ExplainPanel
                  question={question}
                  mode={mode}
                  selected={selected}
                  revealed={revealed}
                  correct={correct}
                  providerId={providerId}
                  examKey={examKey}
                  aiEnabled={aiEnabled}
                  onConsumed={onConsumed}
                  onOpenChat={() => onTab('ask')}
                />
              </div>
              <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'ask' && 'hidden')}>
                <TutorChat
                  providerId={providerId}
                  examKey={examKey}
                  questionId={question.id}
                  examLabel={examLabel}
                  learnerChoice={selected}
                  aiEnabled={aiEnabled}
                  remaining={remaining}
                  onConsumed={onConsumed}
                  onOpenHint={() => onTab('guide')}
                  onOpenExplain={() => onTab('explain')}
                />
              </div>
            </>
          ) : (
            <p className="px-4 py-6 text-sm text-content-muted">Open a question to use the companion.</p>
          )}
        </div>
      </aside>
    </>
  );
}
function ExamModePanel({ questionIndex }: { questionIndex: number }) {
  return (
    <div className="flex flex-1 flex-col px-4 py-5">
      <div className="rounded-2xl bg-accent/[0.055] p-4">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-accent">Exam mode</p>
        <p className="mt-2 text-sm font-semibold text-content-primary">
          Question {questionIndex + 1} stays sealed
        </p>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Hints, walkthroughs and the tutor are paused for this sitting. Nothing in the workspace can reveal
          an answer before you submit.
        </p>
      </div>

      <ul className="mt-5 space-y-3 text-[0.8125rem] leading-relaxed text-content-secondary">
        <li className="flex gap-2.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          Answer at your own pace. Every choice saves automatically and survives a reload.
        </li>
        <li className="flex gap-2.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-caution" />
          Flag anything uncertain, then use the session map to come back before time runs out.
        </li>
        <li className="flex gap-2.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
          Submit from the bottom of the worksheet. The score report opens the full review and tutor.
        </li>
      </ul>

      <p className="mt-auto pt-6 text-[0.6875rem] leading-relaxed text-content-muted">
        Tip: the session map filters to open or flagged items, so a final pass is quick.
      </p>
    </div>
  );
}
