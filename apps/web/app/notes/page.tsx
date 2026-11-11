'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { del, get } from '@/lib/api';
import type { Note, Paginated } from '@/lib/types';
import { Alert, EmptyState, Spinner } from '@/components/ui';
import { IconNote } from '@/components/icons';
import { relativeTime } from '@/lib/format';

export default function NotesPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Note[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    get<Paginated<Note>>('/notes?pageSize=100')
      .then((data) => setItems(data.items))
      .catch((err) => setError((err as Error).message));
  }, [user]);

  const remove = async (note: Note) => {
    try {
      await del(`/notes/${note.id}`);
      setItems((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
      toast('Note deleted', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (loading) return <Spinner />;
  if (!user) return <EmptyState title="Sign in to view notes" action={<Link href="/login" className="btn-primary">Sign in</Link>} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="heading-1 flex items-center gap-2"><IconNote className="text-brand-400" /> Notes</h1>
        <p className="mt-1 text-content-muted">Your personal study notes.</p>
      </header>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No notes yet" description="Add a note from any question to build your own study guide." action={<Link href="/exams" className="btn-primary">Browse exams</Link>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((note) => (
            <li key={note.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{note.questionId}</p>
                  <p className="text-xs text-content-muted">{note.examKey} · updated {relativeTime(note.updatedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/study?provider=${encodeURIComponent(note.providerId)}&exam=${encodeURIComponent(note.examKey)}&mode=practice`} className="btn-secondary !px-3 !py-1.5 text-xs">Open</Link>
                  <button onClick={() => remove(note)} className="btn-ghost !px-3 !py-1.5 text-xs">Delete</button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-content-secondary">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}