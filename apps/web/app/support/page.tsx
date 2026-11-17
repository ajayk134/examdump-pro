'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, post } from '@/lib/api';
import type { SupportTicket, TicketMessage } from '@/lib/types';
import { Alert, Badge, EmptyState, EmptyIcon, PageHeader, Spinner } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { IconChevronDown, IconMessage, IconSend, IconTrophy } from '@/components/icons';
import { formatDateTime } from '@/lib/format';

const CATEGORIES = ['general', 'billing', 'payments', 'refund', 'account', 'content', 'technical'] as const;

type Category = (typeof CATEGORIES)[number];

interface TicketListResponse {
  tickets: SupportTicket[];
}

interface TicketDetailResponse {
  ticket: SupportTicket;
  messages: TicketMessage[];
}

/** Questions that are answerable without opening a ticket. */
const FAQ = [
  {
    q: 'How soon will I get a reply?',
    a: 'Support replies arrive by email, and every reply also appears in the conversation below if you are signed in.',
  },
  {
    q: 'What should I include in a ticket?',
    a: 'A clear subject and the exact detail get the fastest answer. For a charge, include the payment reference shown on your invoice.',
  },
  {
    q: 'Can I track my ticket?',
    a: 'Yes. Sign in and your conversations appear on this page with their current status, so you can follow up in one place.',
  },
  {
    q: 'Do I need an account to contact you?',
    a: 'No. You can submit a ticket with just an email address. Signing in is what lets you read the replies here as well as by email.',
  },
  {
    q: 'Where do I compare passes before buying?',
    a: 'Every pass, its scope and its price are listed on the pricing page. Open it from the card above or the link in the footer.',
  },
];

function statusTone(status: SupportTicket['status']): 'accent' | 'warning' | 'success' | 'default' {
  if (status === 'open') return 'accent';
  if (status === 'pending') return 'warning';
  if (status === 'resolved') return 'success';
  return 'default';
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
    category: 'general' as Category,
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Help"
        title="Support"
        description="Questions about billing, access or content? Open a ticket and we will reply by email."
      />

      <Reveal>
        {/* Three real routes to help, so nobody has to guess what to do first. */}
        <section aria-label="Ways to get help" className="grid gap-2.5 sm:grid-cols-3">
          <a
            href="#new-ticket"
            className="panel flex items-start gap-3 p-4 transition-colors hover:border-accent/45"
          >
            <IconSend width={18} height={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Open a ticket</span>
              <span className="block text-xs leading-relaxed text-content-muted">
                Best for billing, payments and account questions.
              </span>
            </span>
          </a>
          <a
            href="mailto:support@examdump.pro"
            className="panel flex items-start gap-3 p-4 transition-colors hover:border-accent/45"
          >
            <IconMessage width={18} height={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Email us</span>
              <span className="block text-xs leading-relaxed text-content-muted">support@examdump.pro</span>
            </span>
          </a>
          <Link href="/pricing" className="panel flex items-start gap-3 p-4 transition-colors hover:border-accent/45">
            <IconTrophy width={18} height={18} className="mt-0.5 shrink-0 text-caution" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Passes and plans</span>
              <span className="block text-xs leading-relaxed text-content-muted">
                Compare passes before you buy or upgrade.
              </span>
            </span>
          </Link>
        </section>
      </Reveal>

      <Reveal>
        {/* Self-serve first: the most common questions, answered in place. */}
        <section aria-labelledby="faq-heading" className="section">
          <div className="section-head">
            <div>
              <p className="eyebrow mb-1">Quick answers</p>
              <h2 id="faq-heading" className="heading-2">
                Frequently asked
              </h2>
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.5rem] border border-surface-border bg-surface-raised">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-t border-surface-border first:border-t-0">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-sm font-semibold text-content-primary transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <IconChevronDown
                    width={18}
                    height={18}
                    className="shrink-0 text-content-muted transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="px-4 pb-4 text-sm leading-relaxed text-content-secondary sm:px-5">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="new-ticket" aria-labelledby="new-ticket-heading" className="panel scroll-mt-24 p-4 sm:p-5">
          <div className="mb-4">
            <p className="eyebrow mb-1">Write to us</p>
            <h2 id="new-ticket-heading" className="heading-2">
              New ticket
            </h2>
            <p className="caption mt-1">A clear subject and the exact error get the fastest answer.</p>
          </div>

          <div className="flex flex-col gap-4">
            <div>
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
                className="select"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <p className="caption mt-1.5">Pick the closest match.</p>
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

            <div>
              <label className="label" htmlFor="ticket-message">
                Message
              </label>
              <textarea
                id="ticket-message"
                className="input min-h-32"
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                placeholder="Include your payment reference if this is about a charge."
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void createTicket()}>
                {busy ? 'Sending...' : 'Submit ticket'}
              </button>
              <p className="text-xs text-content-muted">Replies arrive by email, and appear below.</p>
            </div>
          </div>
        </section>
      </Reveal>

      {!user ? (
        <Alert tone="info">
          <Link href="/login" className="link">
            Sign in
          </Link>{' '}
          to track replies from this page.
        </Alert>
      ) : loading || tickets === null ? (
        <Spinner label="Loading your tickets..." />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No tickets yet"
          description="Your support conversations will appear here."
        />
      ) : (
        <section aria-labelledby="tickets-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="tickets-heading" className="heading-2">
              Your tickets
            </h2>
            <span className="badge numeric shrink-0">{tickets.length}</span>
          </div>

          <ul className="flex flex-col gap-2.5">
            {tickets.map((ticket) => {
              const expanded = openId === ticket.id;
              const panelId = `ticket-panel-${ticket.id}`;
              const replyId = `ticket-reply-${ticket.id}`;
              return (
                <li key={ticket.id} className="panel overflow-hidden p-0">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-surface-overlay/60"
                    onClick={() => setOpenId(expanded ? null : ticket.id)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{ticket.subject}</span>
                      <span className="caption block capitalize">
                        {ticket.category} · updated {formatDateTime(ticket.updatedAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>
                      <IconChevronDown
                        width={16}
                        height={16}
                        aria-hidden="true"
                        className={`text-content-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                    </span>
                  </button>

                  <div id={panelId} hidden={!expanded} className="border-t border-surface-border p-4">
                    {!detail ? (
                      <Spinner />
                    ) : (
                      <div className="flex flex-col gap-3">
                        {detail.messages.map((message) => {
                          const fromSupport = message.authorRole === 'admin';
                          return (
                            <div
                              key={message.id}
                              className={
                                fromSupport
                                  ? 'rounded-xl border border-accent/30 bg-accent/[0.06] p-3 text-sm'
                                  : 'rounded-xl border border-surface-border bg-surface-overlay/60 p-3 text-sm'
                              }
                            >
                              <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-content-muted">
                                <span>{fromSupport ? 'Support' : 'You'}</span>
                                <span className="font-normal">{formatDateTime(message.createdAt)}</span>
                              </p>
                              <p className="whitespace-pre-wrap text-content-secondary">{message.body}</p>
                            </div>
                          );
                        })}

                        {detail.ticket.status !== 'closed' ? (
                          <div className="flex flex-col gap-2">
                            <label className="label" htmlFor={replyId}>
                              Add a reply
                            </label>
                            <textarea
                              id={replyId}
                              className="input min-h-24"
                              placeholder="Add a reply..."
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn-primary btn-sm self-start"
                              disabled={busy || !reply.trim()}
                              onClick={() => void sendReply()}
                            >
                              {busy ? 'Sending...' : 'Send reply'}
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-content-muted">
                            This ticket is closed. Open a new ticket if you need help with something else.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* What to include, so a ticket can be answered on the first reply. */}
      <Reveal>
        <section aria-labelledby="before-heading" className="panel-sunken p-4 sm:p-5">
          <h2 id="before-heading" className="heading-3">
            Before you write
          </h2>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-xs leading-relaxed text-content-secondary">
            <li>For a charge or refund, include your payment reference from the invoice.</li>
            <li>For a content problem, include the exam code and the question number.</li>
            <li>For a technical problem, describe what you tapped and what you expected to happen.</li>
          </ul>
        </section>
      </Reveal>
    </div>
  );
}
