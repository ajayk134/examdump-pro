'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam } from '@/lib/types';
import { AiChat } from '@/components/ai-chat';
import { Alert, PageHeader, Spinner } from '@/components/ui';
import { IconSearch, IconSparkles } from '@/components/icons';

const POPULAR = ['cisco', 'aws', 'microsoft', 'comptia', 'google', 'pmi'];

function AskInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const questionId = params.get('question') ?? undefined;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exam[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await get<{ items: Exam[] }>(
          `/exams/search?q=${encodeURIComponent(query.trim())}&pageSize=8`,
        );
        setResults(data.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  if (provider && exam) {
    return (
      // Anchor the chat to the viewport instead of the document flow: this is
      // the only reliable way to keep the composer pinned above the mobile
      // bottom nav regardless of how tall the transcript grows.
      <div
        className="fixed inset-x-0 bottom-0 flex flex-col overflow-hidden"
        style={{
          top: 'calc(var(--header-h) + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-1.5 pb-1 sm:px-0 [@media(max-height:480px)]:hidden">
          <Link
            href="/ask"
            className="inline-flex min-h-10 items-center gap-1 text-xs text-content-muted transition-colors hover:text-content-primary"
          >
            ← All conversations
          </Link>
        </div>
        <div className="surface mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col overflow-hidden rounded-none md:mb-4 md:rounded-2xl">
          <AiChat
            key={`${provider}:${exam}:${questionId ?? ''}`}
            providerId={provider}
            examKey={exam}
            questionId={questionId}
            examLabel={exam}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-sky-400 text-white shadow-lg shadow-brand-500/25">
          <IconSparkles width={26} height={26} />
        </span>
        <h1 className="display-2 text-balance">Ask the AI tutor</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-content-secondary">
          Understand any concept, unpack a tricky question, or get a study plan. Grounded in the exam you
          choose.
        </p>
      </header>

      <div className="surface p-4 sm:p-5">
        <label htmlFor="ask-search" className="label">
          Which exam are you studying for?
        </label>
        <div className="relative">
          <IconSearch
            width={18}
            height={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
          />
          <input
            id="ask-search"
            className="input pl-10"
            placeholder="Search by exam code, name or vendor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="mt-4">
          {searching ? (
            <Spinner label="Searching…" />
          ) : results && results.length > 0 ? (
            <ul className="divide-y divide-surface-border">
              {results.map((item) => (
                <li key={`${item.providerId}:${item.key}`}>
                  <Link
                    href={`/ask?provider=${encodeURIComponent(item.providerId)}&exam=${encodeURIComponent(item.key)}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-overlay"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-content-primary">
                        {item.code}
                      </span>
                      <span className="block truncate text-xs text-content-muted">
                        {item.title} · {item.providerTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-brand-600 dark:text-brand-300">Chat →</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : results && results.length === 0 ? (
            <Alert tone="warning">No exams matched that search.</Alert>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {POPULAR.map((slug) => (
                <Link
                  key={slug}
                  href={`/exams/${encodeURIComponent(slug)}`}
                  className="inline-flex min-h-9 items-center rounded-full border border-surface-border-strong bg-surface-raised px-3 text-xs font-medium text-content-secondary transition-colors hover:border-accent/50 hover:text-content-primary"
                >
                  {slug}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-content-muted">
        Every question also has an <strong className="font-semibold">Ask AI</strong> button, so the tutor
        already knows what you are looking at.
      </p>
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <AskInner />
    </Suspense>
  );
}
