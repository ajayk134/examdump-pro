'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { get } from '@/lib/api';
import type { AiConversation, Exam } from '@/lib/types';
import { AiChat, TUTOR_MODES } from '@/components/ai-chat';
import { Alert, PageShell, Spinner } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { IconBook, IconChevronRight, IconClock, IconMessage, IconSearch, IconSparkles } from '@/components/icons';
import { relativeTime } from '@/lib/format';

const POPULAR = ['cisco', 'aws', 'microsoft', 'comptia', 'google', 'pmi'];

function AskInner() {
  const params = useSearchParams();
  const provider = params.get('provider');
  const exam = params.get('exam');
  const questionId = params.get('question') ?? undefined;
  const conversationId = params.get('conversation') ?? undefined;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exam[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<AiConversation[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await get<{ items: Exam[] }>(`/exams/search?q=${encodeURIComponent(query.trim())}&pageSize=8`);
        setResults(data.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    get<{ conversations: AiConversation[] }>('/ai/chat/conversations')
      .then((data) => {
        if (!cancelled) setRecent((data.conversations ?? []).slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (provider && exam) {
    const workspace = (
      // Anchor the workspace to the viewport so the composer stays above the
      // mobile bottom nav however tall the transcript grows.
      <div
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden"
        style={{
          top: 'calc(var(--header-h) + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 px-0 sm:px-5 md:pb-4">
          <div className="panel flex min-h-0 w-full flex-col overflow-hidden rounded-none bg-surface-raised pt-0 md:rounded-[2rem] md:shadow-lg">
            <AiChat
              key={`${provider}:${exam}:${questionId ?? ''}:${conversationId ?? ''}`}
              variant="workspace"
              conversationId={conversationId}
              providerId={provider}
              examKey={exam}
              questionId={questionId}
              examLabel={exam}
            />
          </div>
        </div>
      </div>
    );
    // Portalled to <body>: the page content lives in a stacking context, so an
    // in-flow fixed panel would be painted under the site footer.
    return mounted ? createPortal(workspace, document.body) : workspace;
  }

  return (
    <PageShell className="max-w-4xl">
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
        <p className="relative mx-auto mt-4 max-w-lg text-pretty text-sm leading-relaxed text-content-secondary sm:text-base">
          A workspace built for doubts: keep the conversation beside your questions, switch how the tutor
          teaches, and come back to any thread later.
        </p>
      </header>

      <section className="panel mt-8 p-4 sm:p-5" aria-labelledby="ask-search-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="ask-search" className="label" id="ask-search-heading">
            Which exam are you studying for?
          </label>
          <span className="caption">Grounds every answer in that syllabus</span>
        </div>
        <div className="relative mt-1.5">
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
            onChange={(event) => setQuery(event.target.value)}
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
                      <span className="block truncate text-sm font-semibold text-content-primary">{item.code}</span>
                      <span className="block truncate text-xs text-content-muted">
                        {item.title} · {item.providerTitle}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
                      Open tutor
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
        <section className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Teaching modes">
          <div className="panel p-4 sm:col-span-2">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-[0.9rem] bg-accent/10 text-accent">
                <IconBook width={17} height={17} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold">Five ways to be taught</p>
                <p className="caption">Switch modes mid-conversation without losing the thread.</p>
              </div>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {TUTOR_MODES.map((mode) => (
                <li key={mode.id} className="rounded-[0.9rem] border border-surface-border bg-surface-inset/50 px-3 py-2">
                  <p className="text-xs font-semibold text-content-primary">{mode.label}</p>
                  <p className="text-[0.6875rem] leading-snug text-content-muted">{mode.hint}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="tile flex items-start gap-3 p-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[0.9rem] bg-accent/10 text-accent">
              <IconMessage width={17} height={17} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold">Beside every question</p>
              <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
                Open the tutor from a practice question and it keeps that question, your selected options and
                the exam in context — without ending the session.
              </p>
            </div>
          </div>

          <div className="tile flex items-start gap-3 p-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[0.9rem] bg-accent/10 text-accent">
              <IconClock width={17} height={17} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold">Threads that persist</p>
              <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
                Conversations are saved per account, so a doubt you had last week is one tap away — with its
                full history.
              </p>
            </div>
          </div>
        </section>
      </Reveal>

      {recent.length > 0 ? (
        <section className="section" aria-labelledby="recent-chats-heading">
          <div className="section-head">
            <div>
              <p className="eyebrow mb-1">Continue</p>
              <h2 id="recent-chats-heading" className="heading-1">
                Recent conversations
              </h2>
            </div>
          </div>
          <ul className="panel divide-y divide-surface-border">
            {recent.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={
                    conversation.providerId && conversation.examKey
                      ? `/ask?provider=${encodeURIComponent(conversation.providerId)}&exam=${encodeURIComponent(
                          conversation.examKey,
                        )}&conversation=${encodeURIComponent(conversation.id)}`
                      : '/ask'
                  }
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-overlay/60"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
                    <IconSparkles width={15} height={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{conversation.title}</span>
                    <span className="block truncate text-[0.6875rem] text-content-muted">
                      {conversation.examTitle ?? conversation.examKey ?? 'General'} ·{' '}
                      {relativeTime(conversation.updatedAt)}
                    </span>
                  </span>
                  <IconChevronRight width={15} height={15} className="shrink-0 text-content-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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