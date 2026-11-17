'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { del, get } from '@/lib/api';
import type { Bookmark, Paginated } from '@/lib/types';
import { Alert, Dialog, EmptyState, EmptyIcon, PageHeader, Spinner } from '@/components/ui';
import { IconBookmark, IconChevronRight } from '@/components/icons';
import { relativeTime } from '@/lib/format';

export default function BookmarksPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Bookmark[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Bookmark | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    get<Paginated<Bookmark>>('/bookmarks?pageSize=100')
      .then((data) => setItems(data.items))
      .catch((err) => setError((err as Error).message));
  }, [user]);

  const remove = async (bookmark: Bookmark) => {
    setBusy(true);
    try {
      await del(`/bookmarks/${bookmark.id}`);
      setItems((prev) => (prev ? prev.filter((b) => b.id !== bookmark.id) : prev));
      toast('Bookmark removed', 'info');
      setPending(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (!user) return <EmptyState title="Sign in to view bookmarks" action={<Link href="/login" className="btn-primary">Sign in</Link>} />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Saved"
        title="Bookmarks"
        description={
          items && items.length > 0
            ? `${items.length} question${items.length === 1 ? '' : 's'} saved for later.`
            : 'Questions you save from practice appear here.'
        }
        actions={
          <Link href="/exams" className="btn-secondary btn-sm">
            Browse exams
          </Link>
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="book" />}
          title="No bookmarks yet"
          description="Tap the bookmark icon on any question to save it here."
          action={<Link href="/exams" className="btn-primary">Browse exams</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((bookmark) => (
            <li
              key={bookmark.id}
              className="panel flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:hover:border-accent/40"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[0.9rem] bg-caution/[0.12] text-caution"
                >
                  <IconBookmark width={16} height={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content-primary">{bookmark.examKey}</p>
                  <p className="truncate font-mono text-[0.6875rem] text-content-muted">
                    Question {bookmark.questionId}
                  </p>
                  <p className="caption mt-0.5">Saved {relativeTime(bookmark.createdAt)}</p>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/study?provider=${encodeURIComponent(bookmark.providerId)}&exam=${encodeURIComponent(bookmark.examKey)}&mode=practice`}
                  className="btn-secondary btn-sm flex-1 sm:flex-none"
                >
                  Open
                  <IconChevronRight width={14} height={14} aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  className="btn-ghost btn-sm flex-1 sm:flex-none"
                  onClick={() => setPending(bookmark)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Remove this bookmark?"
        description={
          pending
            ? `${pending.examKey} · question ${pending.questionId}. You can save it again from practice at any time.`
            : undefined
        }
        footer={
          <>
            <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger w-full sm:w-auto"
              disabled={busy}
              onClick={() => pending && void remove(pending)}
            >
              {busy ? 'Removing...' : 'Remove bookmark'}
            </button>
          </>
        }
      />
    </div>
  );
}
