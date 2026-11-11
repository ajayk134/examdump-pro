'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type { SupportTicket, TicketMessage } from '@/lib/types';
import { Alert, EmptyState, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

const CATEGORIES = ['general', 'billing', 'payments', 'refund', 'account', 'content', 'technical'] as const;

interface TicketListResponse {
  tickets: SupportTicket[];
}

interface TicketDetailResponse {
  ticket: SupportTicket;
  messages: TicketMessage[];
}

export default function SupportPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState({
    subject: '',
    category: 'general' as (typeof CATEGORIES)[number],
    message: '',
    email: user?.email ?? '',
  });

  const loadTickets = useCallback(async () => {
    if (!user) return;
    try {
      const data = await get<TicketListResponse>('/support/tickets');
      setTickets(data.tickets);
    } catch (err) {
      toast((err as Error).message, 'error');
      setTickets([]);
    }
  }, [user, toast]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    void get<TicketDetailResponse>(`/support/tickets/${openId}`)
      .then(setDetail)
      .catch((err) => toast((err as Error).message, 'error'));
  }, [openId, toast]);

  async function createTicket() {
    if (draft.subject.trim().length < 4 || draft.message.trim().length < 10) {
      toast('Add a subject and a little more detail.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await post<{ ticket: SupportTicket }>('/support/tickets', {
        subject: draft.subject.trim(),
        category: draft.category,
        message: draft.message.trim(),
        ...(user ? {} : { email: draft.email.trim() }),
      });
      toast('Ticket created — we will reply by email.', 'success');
      setDraft({ subject: '', category: 'general', message: '', email: user?.email ?? '' });
      await loadTickets();
      setOpenId(created.ticket.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!openId || !reply.trim()) return;
    setBusy(true);
    try {
      await post(`/support/tickets/${openId}/messages`, { message: reply.trim() });
      setReply('');
      const fresh = await get<TicketDetailResponse>(`/support/tickets/${openId}`);
      setDetail(fresh);
      await loadTickets();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Questions about billing, access or content? Open a ticket and we will reply by email.
        </p>
      </header>

      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold">New ticket</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ticket-subject">
              Subject
            </label>
            <input
              id="ticket-subject"
              className="input"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Short summary"
            />
          </div>
          <div>
            <label className="label" htmlFor="ticket-category">
              Category
            </label>
            <select
              id="ticket-category"
              className="input"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as (typeof CATEGORIES)[number] })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {!user ? (
            <div>
              <label className="label" htmlFor="ticket-email">
                Email
              </label>
              <input
                id="ticket-email"
                type="email"
                className="input"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ticket-message">
              Message
            </label>
            <textarea
              id="ticket-message"
              className="input min-h-28"
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              placeholder="Include your payment reference if this is about a charge."
            />
          </div>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void createTicket()}>
          {busy ? 'Sending…' : 'Submit ticket'}
        </button>
      </section>

      {!user ? (
        <Alert tone="info">
          <Link href="/login" className="link">
            Sign in
          </Link>{' '}
          to track replies from this page.
        </Alert>
      ) : loading || tickets === null ? (
        <Spinner label="Loading your tickets…" />
      ) : tickets.length === 0 ? (
        <EmptyState title="No tickets yet" description="Your support conversations will appear here." />
      ) : (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your tickets</h2>
          {tickets.map((t) => (
            <div key={t.id} className="card">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
                onClick={() => setOpenId(openId === t.id ? null : t.id)}
                aria-expanded={openId === t.id}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t.subject}</span>
                  <span className="text-xs text-content-muted">
                    {t.category} · updated {formatDateTime(t.updatedAt)}
                  </span>
                </span>
                <span className="badge shrink-0">{t.status}</span>
              </button>

              {openId === t.id ? (
                <div className="space-y-3 border-t border-surface-border p-4">
                  {!detail ? (
                    <Spinner />
                  ) : (
                    <>
                      {detail.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-xl border p-3 text-sm ${
                            m.authorRole === 'admin'
                              ? 'border-brand-400/40 bg-brand-500/5'
                              : 'border-surface-border bg-surface-overlay/60'
                          }`}
                        >
                          <p className="mb-1 text-xs font-semibold text-content-muted">
                            {m.authorRole === 'admin' ? 'Support' : 'You'} · {formatDateTime(m.createdAt)}
                          </p>
                          <p className="whitespace-pre-wrap text-content-secondary">{m.body}</p>
                        </div>
                      ))}
                      {detail.ticket.status !== 'closed' ? (
                        <div className="space-y-2">
                          <textarea
                            className="input min-h-20"
                            placeholder="Add a reply…"
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn-primary text-sm"
                            disabled={busy || !reply.trim()}
                            onClick={() => void sendReply()}
                          >
                            Send reply
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-content-muted">This ticket is closed.</p>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
