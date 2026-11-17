'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam, Paginated } from '@/lib/types';
import { Dialog } from './ui';
import { IconBook, IconCheck, IconChevronRight, IconSearch, IconX } from './icons';
import { cn, formatNumber } from '@/lib/format';
import { getRecentExams, pushRecentExam, type RecentExam } from '@/lib/local-store';

export interface SelectedExam {
  providerId: string;
  examKey: string;
  code: string;
  title: string;
  providerTitle: string;
  questionCount: number;
}

export function toSelectedExam(exam: Exam): SelectedExam {
  return {
    providerId: exam.providerId,
    examKey: exam.key,
    code: exam.code,
    title: exam.title,
    providerTitle: exam.providerTitle,
    questionCount: exam.questionCount,
  };
}

function fromRecent(recent: RecentExam): SelectedExam {
  return {
    providerId: recent.providerId,
    examKey: recent.examKey,
    code: recent.code,
    title: recent.title,
    providerTitle: recent.providerTitle,
    questionCount: recent.questionCount,
  };
}

const idOf = (exam: SelectedExam) => `${exam.providerId}:${exam.examKey}`;

/**
 * The one exam picker used by practice, mocks, the workspace and discovery.
 *
 * Opening it is a focused search rather than a page of scrolling: recents and
 * the most popular exams appear immediately, typing narrows to a compact list,
 * and the whole thing is keyboard navigable. On phones it becomes a bottom
 * sheet so the search field stays above the keyboard.
 */
export function ExamSelect({
  value,
  onChange,
  label = 'Exam',
  placeholder = 'Search exams by code or name',
  className,
  disabled = false,
}: {
  value: SelectedExam | null;
  onChange: (exam: SelectedExam) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exam[] | null>(null);
  const [error, setError] = useState('');
  const [recents, setRecents] = useState<RecentExam[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRecents(getRecentExams());
    setQuery('');
    setActive(0);
    setResults(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const trimmed = query.trim();
    const timer = setTimeout(
      () => {
        setError('');
        const params = new URLSearchParams({
          sort: trimmed.length >= 2 ? 'title' : 'popular',
          pageSize: '20',
        });
        if (trimmed.length >= 2) params.set('q', trimmed);
        get<Paginated<Exam>>(`/exams/search?${params.toString()}`)
          .then((data) => {
            if (!cancelled) {
              setResults(data.items);
              setActive(0);
            }
          })
          .catch((err) => {
            if (!cancelled) setError((err as Error).message);
          });
      },
      trimmed.length >= 2 ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const choose = useCallback(
    (exam: SelectedExam) => {
      pushRecentExam({
        providerId: exam.providerId,
        examKey: exam.examKey,
        code: exam.code,
        title: exam.title,
        providerTitle: exam.providerTitle,
        questionCount: exam.questionCount,
      });
      onChange(exam);
      setOpen(false);
    },
    [onChange],
  );

  const searching = query.trim().length >= 2;
  const recentRows = searching ? [] : recents.map(fromRecent);
  const recentIds = new Set(recentRows.map(idOf));
  const resultRows = (results ?? []).map(toSelectedExam).filter((exam) => !recentIds.has(idOf(exam)));
  const rows = [...recentRows, ...resultRows];

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && rows[active]) {
      event.preventDefault();
      choose(rows[active]!);
    }
  }

  function renderRow(exam: SelectedExam, index: number) {
    const isActive = index === active;
    const isSelected = value ? idOf(value) === idOf(exam) : false;
    return (
      <li key={idOf(exam)} role="option" aria-selected={isSelected}>
        <button
          type="button"
          onClick={() => choose(exam)}
          onMouseEnter={() => setActive(index)}
          className={cn(
            'flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-colors',
            isActive ? 'bg-accent/10' : 'hover:bg-surface-overlay',
          )}
        >
          <span className="grid h-9 w-14 shrink-0 place-items-center rounded-[0.6rem] border border-surface-border bg-surface-inset font-mono text-[0.62rem] font-bold uppercase tracking-wide text-content-secondary">
            {exam.code.slice(0, 8)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{exam.title}</span>
            <span className="block truncate text-xs text-content-muted">
              {exam.providerTitle} · {formatNumber(exam.questionCount)} questions
            </span>
          </span>
          {isSelected ? (
            <IconCheck className="h-4 w-4 shrink-0 text-accent" />
          ) : (
            <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted" />
          )}
        </button>
      </li>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={value ? `${label}: ${value.title}. Change exam` : placeholder}
        className={cn(
          'group flex w-full items-center gap-3 rounded-[1.25rem] border border-surface-border bg-surface-raised p-3 text-left shadow-xs transition-all duration-200',
          'hover:border-accent/45 hover:shadow-sm disabled:opacity-60',
          className,
        )}
      >
        {value ? (
          <>
            <span
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-[0.9rem] bg-gradient-to-br from-brand-500 to-accent-2 font-display text-sm font-bold text-white shadow-glow-sm"
            >
              {value.code.slice(0, 3).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-accent">
                {value.code}
              </span>
              <span className="block truncate font-display text-[1.05rem] font-semibold leading-tight">
                {value.title}
              </span>
              <span className="block truncate text-xs text-content-muted">
                {value.providerTitle} · {formatNumber(value.questionCount)} questions
              </span>
            </span>
            <span className="hidden shrink-0 rounded-full border border-surface-border px-3 py-1.5 text-xs font-semibold text-content-secondary group-hover:border-accent/50 group-hover:text-accent sm:block">
              Change
            </span>
            <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted sm:hidden" />
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[0.9rem] bg-accent/10 text-accent"
            >
              <IconSearch className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{placeholder}</span>
              <span className="block text-xs text-content-muted">
                Search the full catalogue by code or name
              </span>
            </span>
            <IconChevronRight className="h-4 w-4 shrink-0 text-content-muted" />
          </>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Choose an exam"
        description="Search by exam code or name. Your recent exams are at the top."
        className="sm:max-w-2xl"
        footer={
          <button type="button" onClick={() => setOpen(false)} className="btn-ghost w-full sm:w-auto">
            Cancel
          </button>
        }
      >
        <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
          <div className="sticky -top-4 z-10 -mx-1 bg-surface-raised px-1 pb-2 pt-1">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
              <input
                ref={inputRef}
                type="search"
                inputMode="search"
                autoComplete="off"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search exams"
                aria-controls="exam-select-results"
                placeholder="e.g. CISA, 200-301, Security+"
                className="input pl-10 pr-10"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                  aria-label="Clear search"
                >
                  <IconX className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <p className="rounded-xl border border-negative/30 bg-negative/[0.06] px-3 py-2 text-sm text-negative">
              {error}
            </p>
          ) : null}

          {results === null && rows.length === 0 ? (
            <div className="flex flex-col gap-1.5" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="skeleton h-[3.4rem] rounded-[0.9rem]" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-inset text-content-muted">
                <IconBook className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold">No exams matched “{query.trim()}”</p>
              <p className="text-xs text-content-muted">Try a code such as 200-301, SY0-701 or PMP.</p>
            </div>
          ) : (
            <div id="exam-select-results" role="listbox" aria-label="Exams" className="flex flex-col gap-1">
              {recentRows.length > 0 ? (
                <>
                  <p className="px-2 pb-1 pt-0.5 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-content-muted">
                    Recent
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {recentRows.map((exam, index) => renderRow(exam, index))}
                  </ul>
                </>
              ) : null}

              <p className="px-2 pb-1 pt-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-content-muted">
                {searching ? 'Results' : 'Popular exams'}
              </p>
              <ul className="flex flex-col gap-0.5">
                {resultRows.map((exam, index) => renderRow(exam, recentRows.length + index))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}