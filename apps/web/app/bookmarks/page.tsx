'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { del, get } from '@/lib/api';
import type { Bookmark, Paginated } from '@/lib/types';
import { Alert, EmptyState, Spinner } from '@/components/ui';
import { IconBookmark } from '@/components/icons';
import { relativeTime } from '@/lib/format';

export default function BookmarksPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Bookmark[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    get<Paginated<Bookmark>>('/bookmarks?pageSize=100')
      .then((data) => setItems(data.items))
      .catch((err) => setError((err as Error).message));
  }, [user]);

  const remove = async (bookmark: Bookmark) => {
    try {
      await del(`/bookmarks/${bookmark.id}`);
      setItems((prev) => (prev ? prev.filter((b) => b.id !== bookmark.id) : prev));
      toast('Bookmark removed', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (loading) return <Spinner />;
  if (!user) return <EmptyState title="Sign in to view bookmarks" action={<Link href="/login" className="btn-primary">Sign in</Link>} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><IconBookmark className="text-amber-400" /> Bookmarks</h1>
        <p className="mt-1 text-content-muted">Questions you saved for later.</p>
      </header>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No bookmarks yet" description="Tap the bookmark icon on any question to save it here." action={<Link href="/browse" className="btn-primary">Browse exams</Link>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((bookmark) => (
            <li key={bookmark.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{bookmark.questionId}</p>
                <p className="truncate text-xs text-content-muted">{bookmark.examKey} · saved {relativeTime(bookmark.createdAt)}</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/study?provider=${encodeURIComponent(bookmark.providerId)}&exam=${encodeURIComponent(bookmark.examKey)}&mode=practice`} className="btn-secondary !px-3 !py-1.5 text-xs">Open</Link>
                <button onClick={() => remove(bookmark)} className="btn-ghost !px-3 !py-1.5 text-xs">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}