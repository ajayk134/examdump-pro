'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Exam } from '@/lib/types';
import { AiChat } from '@/components/ai-chat';
import { Alert, PageShell, Spinner } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import {
  IconBook,
  IconChart,
  IconChevronRight,
  IconMessage,
  IconSearch,
  IconSparkles,
} from '@/components/icons';

const POPULAR = ['cisco', 'aws', 'microsoft', 'comptia', 'google', 'pmi'];

const CAPABILITIES = [
  {
    icon: IconBook,
    title: 'Grounded in your exam',
    body: 'Open a conversation from any exam and the tutor stays on that syllabus.',
  },
  {
    icon: IconChart,
    title: 'Step-by-step reasoning',
    body: 'See how an answer is reached, why the distractors fail, and a memory hook.',
  },
  {
    icon: IconMessage,
    title: 'Ask about a question',
    body: 'Every practice question has an Ask AI button that carries its context along.',
  },
];

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
            className="inline-flex min-h-10 items-center gap-1 text-xs text-content-muted transition-colors hover:text-content-primary touch:min-h-11"
          >
            ← All conversations
          </Link>
        </div>
        <div className="panel mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col overflow-hidden rounded-none pt-0 md:mb-4 md:rounded-[2rem] md:shadow-lg">
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
    <PageShell className="max-w-3xl">
      <header className="relative isolate overflow-hidden pt-2 text-center sm:pt-6">
        <div aria-hidden="true" className="mesh pointer-events-none absolute inset-x-0 -top-10 h-56 opacity-[0.16]" />
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-8 h-56 opacity-70" />
        <div aria-hidden="true" className="orb -left-12 -top-6 h-48 w-48 bg-brand-500/25 animate-glow" />
        <div aria-hidden="true" className="orb -right-10 top-8 h-56 w-56 bg-accent-2/20" />

        <span className="relative mx-auto mb-4 grid h-16 w-16 place-items-center rounded-[1.1rem] bg-gradient-to-br from-brand-500 via-accent-2 to-accent-3 text-white shadow-glow-sm ring-1 ring-inset ring-white/25">
          <IconSparkles width={30} height={30} />
        </span>
        <p className="eyebrow relative">AI tutor</p>
        <h1 className="display-1 relative mt-3 text-balance">
          Ask the <span className="gradient-text animate-gradient">AI tutor</span>
        </h1>
        <p className="relative mx-auto mt-4 max-w-md text-pretty text-sm leading-relaxed text-content-secondary sm:text-base">
          Understand any concept, unpack a tricky question, or get a study plan. Grounded in the exam you
          choose.
        </p>
      </header>

      <section className="panel mt-8 p-4 sm:p-5" aria-labelledby="ask-search-heading">
        <label htmlFor="ask-search" className="label" id="ask-search-heading">
          Which exam are you studying for?
        </label>
        <div className="relative">
          <IconSearch
            width={18}
            height={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted"
          />
          <input
            id="ask-search"
            className="input pl-10"
            placeholder="Search by exam code, name or vendor..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="mt-4" aria-live="polite">
          {searching ? (
            <Spinner label="Searching..." />
          ) : results && results.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {results.map((item) => (
                <li key={`${item.providerId}:${item.key}`}>
                  <Link
                    href={`/ask?provider=${encodeURIComponent(item.providerId)}&exam=${encodeURIComponent(item.key)}`}
                    className="tile tile-interactive group flex min-h-14 items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-content-primary">
                        {item.code}
                      </span>
                      <span className="block truncate text-xs text-content-muted">
                        {item.title} · {item.providerTitle}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
                      Chat
                      <IconChevronRight
                        width={14}
                        height={14}
                        className="transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : results && results.length === 0 ? (
            <Alert tone="warning">No exams matched that search.</Alert>
          ) : (
            <div>
              <p className="eyebrow mb-2.5">Popular providers</p>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR.map((slug) => (
                  <Link key={slug} href={`/exams/${encodeURIComponent(slug)}`} className="chip">
                    {slug}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <Reveal delay={80}>
        <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="How the tutor helps">
          {CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="tile flex items-start gap-3 p-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[0.9rem] bg-accent/10 text-accent">
                  <Icon width={17} height={17} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-content-primary">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{item.body}</p>
                </div>
              </div>
            );
          })}
        </section>
      </Reveal>

      <p className="mt-6 text-center text-xs text-content-muted">
        Every question also has an <strong className="font-semibold text-content-secondary">Ask AI</strong>{' '}
        button, so the tutor already knows what you are looking at.
      </p>
    </PageShell>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<Spinner label="Loading..." />}>
      <AskInner />
    </Suspense>
  );
}
