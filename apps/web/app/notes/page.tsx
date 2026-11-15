'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { del, get } from '@/lib/api';
import type { Note, Paginated } from '@/lib/types';
import { Alert, Dialog, EmptyState, EmptyIcon, PageHeader, Spinner } from '@/components/ui';
import { IconNote } from '@/components/icons';
import { relativeTime } from '@/lib/format';

export default function NotesPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Note[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    get<Paginated<Note>>('/notes?pageSize=100')
      .then((data) => setItems(data.items))
      .catch((err) => setError((err as Error).message));
  }, [user]);

  const remove = async (note: Note) => {
    setBusy(true);
    try {
      await del(`/notes/${note.id}`);
      setItems((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
      toast('Note deleted', 'info');
      setPending(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (!user) return <EmptyState title="Sign in to view notes" action={<Link href="/login" className="btn-primary">Sign in</Link>} />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        eyebrow="Saved"
        title="Notes"
        description={
          items && items.length > 0
            ? `${items.length} note${items.length === 1 ? '' : 's'} in your study guide.`
            : 'Notes you add to a question appear here.'
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
          title="No notes yet"
          description="Add a note from any question to build your own study guide."
          action={<Link href="/exams" className="btn-primary">Browse exams</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((note) => (
            <li key={note.id} className="panel flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"
                  >
                    <IconNote width={16} height={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-content-primary">{note.examKey}</p>
                    <p className="truncate font-mono text-[0.6875rem] text-content-muted">Question {note.questionId}</p>
                    <p className="caption mt-0.5">Updated {relativeTime(note.updatedAt)}</p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/study?provider=${encodeURIComponent(note.providerId)}&exam=${encodeURIComponent(note.examKey)}&mode=practice`}
                    className="btn-secondary btn-sm"
                  >
                    Open
                  </Link>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setPending(note)}>
                    Delete
                  </button>
                </div>
              </div>

              <p className="panel-sunken whitespace-pre-wrap rounded-xl p-3 text-sm leading-relaxed text-content-secondary">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Delete this note?"
        description="The note is removed from your study guide. This cannot be undone."
        footer={
          <>
            <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setPending(null)} disabled={busy}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-danger w-full sm:w-auto"
              disabled={busy}
              onClick={() => pending && void remove(pending)}
            >
              {busy ? 'Deleting...' : 'Delete note'}
            </button>
          </>
        }
      />
    </div>
  );
}
