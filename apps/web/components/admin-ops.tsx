'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, apiBase, del, get, patch, post } from '@/lib/api';
import type { Paginated, Payment } from '@/lib/types';
import { Alert, Dialog, EmptyIcon, EmptyState, Spinner, StatStrip, TableScroll } from '@/components/ui';
import { cn, formatDate, formatDateTime, formatMoneyMinor } from '@/lib/format';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function usePaged<T>(path: string, initialQuery: Record<string, string> = {}, pageSize = 20) {
  const [query, setQuery] = useState<Record<string, string>>({ page: '1', pageSize: String(pageSize), ...initialQuery });
  const [data, setData] = useState<Paginated<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '')).toString();
    try {
      setData(await get<Paginated<T>>(`${path}?${qs}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, query, setQuery, reload };
}

/**
 * Filter bar for an admin table. A single tidy strip that stacks on phones and
 * lines up along the bottom edge from `sm` up, so dense tooling stays legible.
 */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'panel flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-2 sm:p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-surface-border px-4 py-3 text-sm">
      <span className="numeric text-content-muted">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function downloadCsv(resource: string) {
  // Exports are authenticated by cookie; use a hidden link so the browser
  // streams the file with the session cookie attached. `apiBase()` resolves to
  // same-origin in production, so this never points at a visitor's localhost.
  window.open(`${apiBase()}/admin-ops/export/${resource}`, '_blank', 'noopener');
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

interface AdminPaymentRow extends Payment {
  userEmail?: string;
  userName?: string;
}

export function PaymentsPanel() {
  const { data, loading, error, query, setQuery, reload } = usePaged<AdminPaymentRow>('/admin-ops/payments');
  const [refundTarget, setRefundTarget] = useState<AdminPaymentRow | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const totals = useMemo(() => {
    const rows = data?.items ?? [];
    const paid = rows.filter((r) => r.status === 'succeeded' || r.status === 'partially_refunded');
    return {
      count: data?.pagination.total ?? 0,
      gross: paid.reduce((sum, r) => sum + r.amountMinor, 0),
      refunded: rows.reduce((sum, r) => sum + r.refundedMinor, 0),
    };
  }, [data]);

  async function submitRefund() {
    if (!refundTarget) return;
    setBusy(true);
    try {
      await post(`/admin/payments/${refundTarget.id}/refund`, {
        ...(refundAmount.trim() ? { amountMinor: Math.round(Number(refundAmount) * 100) } : {}),
        reason: refundReason,
      });
      setNotice('Refund submitted. Access is revoked once the gateway confirms.');
      setRefundTarget(null);
      setRefundAmount('');
      setRefundReason('');
      await reload();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel overflow-hidden p-0">
        <StatStrip
          items={[
            { label: 'Payments', value: totals.count },
            { label: 'Collected (this page)', value: formatMoneyMinor(totals.gross, 'INR'), tone: 'success' },
            { label: 'Refunded (this page)', value: formatMoneyMinor(totals.refunded, 'INR'), tone: 'warning' },
          ]}
        />
      </div>

      <Toolbar>
        <div className="min-w-0 flex-1 sm:min-w-[200px]">
          <label className="label" htmlFor="pay-q">
            Search
          </label>
          <input
            id="pay-q"
            className="input"
            placeholder="Email, order ref, gateway id"
            value={query.q ?? ''}
            onChange={(e) => setQuery({ ...query, q: e.target.value, page: '1' })}
          />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="pay-status">
            Status
          </label>
          <select
            id="pay-status"
            className="select"
            value={query.status ?? ''}
            onChange={(e) => setQuery({ ...query, status: e.target.value, page: '1' })}
          >
            <option value="">All</option>
            {['pending', 'succeeded', 'failed', 'refunded', 'partially_refunded'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-secondary" onClick={() => downloadCsv('payments')}>
          Export CSV
        </button>
      </Toolbar>

      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Dialog
        open={Boolean(refundTarget)}
        onClose={() => setRefundTarget(null)}
        title="Refund payment"
        description={
          refundTarget
            ? `${refundTarget.userEmail ?? '—'} · ${formatMoneyMinor(refundTarget.amountMinor, refundTarget.currency)}`
            : undefined
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRefundTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void submitRefund()}>
              {busy ? 'Processing...' : 'Confirm refund'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="refund-amount">
              Amount in ₹ (blank = full remaining)
            </label>
            <input
              id="refund-amount"
              className="input"
              inputMode="decimal"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="refund-reason">
              Reason
            </label>
            <input
              id="refund-reason"
              className="input"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
            />
          </div>
        </div>
      </Dialog>

      {loading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No payments"
          description="Payments appear here as soon as checkout is live."
        />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Description</th>
                <th>Provider</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap text-content-muted">{formatDateTime(p.createdAt)}</td>
                  <td className="max-w-[220px] truncate">{p.userEmail ?? '—'}</td>
                  <td>
                    {p.description || 'Subscription'}
                    {p.providerPaymentId ? (
                      <span className="block font-mono text-[11px] text-content-muted">{p.providerPaymentId}</span>
                    ) : null}
                  </td>
                  <td className="text-content-secondary">{p.provider}</td>
                  <td>
                    <span className="badge">{p.status}</span>
                  </td>
                  <td className="numeric text-right font-medium">
                    {formatMoneyMinor(p.amountMinor - p.refundedMinor, p.currency)}
                    {p.refundedMinor > 0 ? (
                      <span className="block text-[11px] font-normal text-content-muted">
                        −{formatMoneyMinor(p.refundedMinor, p.currency)} refunded
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right">
                    {p.status === 'succeeded' || p.status === 'partially_refunded' ? (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setRefundTarget(p)}>
                        Refund
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onChange={(page) => setQuery({ ...query, page: String(page) })}
          />
        </TableScroll>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Webhooks + reconciliation                                           */
/* ------------------------------------------------------------------ */

interface WebhookRow {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  lastError: string | null;
}

export function WebhooksPanel() {
  const { data, loading, error, query, setQuery, reload } = usePaged<WebhookRow>('/admin-ops/webhooks');
  const [recon, setRecon] = useState<{ runs: Array<Record<string, unknown>> } | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');

  const loadRecon = useCallback(async () => {
    try {
      setRecon(await get<{ runs: Array<Record<string, unknown>> }>('/admin-ops/reconciliation'));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadRecon();
  }, [loadRecon]);

  async function replay(id: string) {
    try {
      await post(`/admin-ops/webhooks/${id}/replay`);
      setNotice('Webhook replayed.');
      await reload();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function runReconciliation() {
    setRunning(true);
    try {
      const result = await post<Record<string, unknown>>('/admin-ops/reconciliation/run');
      setNotice(`Reconciliation finished: ${JSON.stringify(result)}`);
      await loadRecon();
      await reload();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="heading-3">Payment reconciliation</p>
          <p className="mt-0.5 text-xs text-content-muted">
            Re-checks pending gateway payments and repairs access drift from missed webhooks.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={running}
          onClick={() => void runReconciliation()}
        >
          {running ? 'Running...' : 'Run now'}
        </button>
      </div>

      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {recon && recon.runs.length > 0 ? (
        <div className="section">
          <div className="section-head">
            <h3 className="heading-3">Recent runs</h3>
          </div>
          <TableScroll>
            <table className="tbl min-w-[520px]">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th className="text-right">Checked</th>
                  <th className="text-right">Repaired</th>
                  <th className="text-right">Mismatches</th>
                </tr>
              </thead>
              <tbody>
                {recon.runs.slice(0, 5).map((run, i) => (
                  <tr key={String(run.id ?? i)}>
                    <td className="numeric whitespace-nowrap">{formatDateTime(String(run.startedAt ?? ''))}</td>
                    <td>{String(run.trigger ?? '—')}</td>
                    <td className="numeric text-right">{String(run.checked ?? 0)}</td>
                    <td className="numeric text-right">{String(run.repaired ?? 0)}</td>
                    <td className="numeric text-right">{String(run.mismatches ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      ) : null}

      {loading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No webhooks received yet"
          description="Gateway callbacks appear here with signature status."
        />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>Received</th>
                <th>Event</th>
                <th>Status</th>
                <th className="text-right">Attempts</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr key={w.id}>
                  <td className="numeric whitespace-nowrap text-content-muted">{formatDateTime(w.receivedAt)}</td>
                  <td>
                    {w.eventType}
                    <span className="block font-mono text-[11px] text-content-muted">{w.eventId}</span>
                  </td>
                  <td>
                    <span className="badge">{w.status}</span>
                    {w.lastError ? (
                      <span className="block text-[11px] text-negative">{w.lastError.slice(0, 80)}</span>
                    ) : null}
                  </td>
                  <td className="numeric text-right">{w.attempts}</td>
                  <td className="text-right">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => void replay(w.id)}>
                      Replay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onChange={(page) => setQuery({ ...query, page: String(page) })}
          />
        </TableScroll>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  level: string;
  audience: string;
  active: boolean;
  createdAt: string;
}

export function AnnouncementsPanel() {
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ title: '', body: '', level: 'info', audience: 'all' });
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<AnnouncementRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<{ announcements: AnnouncementRow[] }>('/admin-ops/announcements');
      setItems(data.announcements);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!draft.title.trim() || !draft.body.trim()) return;
    try {
      await post('/admin-ops/announcements', { ...draft, active: true });
      setDraft({ title: '', body: '', level: 'info', audience: 'all' });
      setNotice('Announcement published.');
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function toggle(item: AnnouncementRow) {
    try {
      await patch(`/admin-ops/announcements/${item.id}`, { active: !item.active });
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await del(`/admin-ops/announcements/${id}`);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4">
        <p className="heading-3">New announcement</p>
        <div>
          <label className="label" htmlFor="ann-title">
            Title
          </label>
          <input
            id="ann-title"
            className="input"
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="ann-body">
            Message
          </label>
          <textarea
            id="ann-body"
            className="input min-h-20"
            placeholder="Message shown as a site-wide banner"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:max-w-[160px]">
            <label className="label" htmlFor="ann-level">
              Level
            </label>
            <select
              id="ann-level"
              className="select"
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            >
              {['info', 'success', 'warning', 'critical'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:max-w-[180px]">
            <label className="label" htmlFor="ann-audience">
              Audience
            </label>
            <select
              id="ann-audience"
              className="select"
              value={draft.audience}
              onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
            >
              <option value="all">Everyone</option>
              <option value="free">Free accounts</option>
              <option value="premium">Pass holders</option>
            </select>
          </div>
          <button type="button" className="btn-primary sm:ml-auto" onClick={() => void create()}>
            Publish
          </button>
        </div>
      </div>

      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="spark" />}
          title="No announcements"
          description="Publish one to show a banner across the site."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((a) => (
            <div key={a.id} className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold text-content-primary">{a.title}</p>
                  <span className="badge">{a.level}</span>
                  {!a.active ? <span className="badge">hidden</span> : null}
                </div>
                <p className="mt-1.5 text-sm text-content-secondary">{a.body}</p>
                <p className="mt-1 text-xs text-content-muted">
                  {a.audience} · {formatDate(a.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => void toggle(a)}>
                  {a.active ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="btn-ghost btn-sm text-negative" onClick={() => setConfirmDelete(a)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this announcement?"
        description={confirmDelete ? `“${confirmDelete.title}” will be removed for everyone.` : undefined}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (confirmDelete) void remove(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Support tickets                                                     */
/* ------------------------------------------------------------------ */

interface AdminTicketRow {
  id: string;
  subject: string;
  userEmail?: string;
  status: string;
  priority: string;
  updatedAt: string;
}

export function TicketsPanel() {
  const { data, loading, error, query, setQuery, reload } = usePaged<AdminTicketRow>('/admin-ops/tickets');
  const [notice, setNotice] = useState('');

  async function setStatus(id: string, status: string) {
    try {
      await patch(`/admin-ops/tickets/${id}`, { status });
      setNotice('Ticket updated.');
      await reload();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <div className="min-w-0 flex-1 sm:min-w-[200px]">
          <label className="label" htmlFor="ticket-q">
            Search
          </label>
          <input
            id="ticket-q"
            className="input"
            value={query.q ?? ''}
            onChange={(e) => setQuery({ ...query, q: e.target.value, page: '1' })}
            placeholder="Subject or email"
          />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="ticket-status">
            Status
          </label>
          <select
            id="ticket-status"
            className="select"
            value={query.status ?? ''}
            onChange={(e) => setQuery({ ...query, status: e.target.value, page: '1' })}
          >
            <option value="">All</option>
            {['open', 'pending', 'resolved', 'closed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </Toolbar>

      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No tickets"
          description="Requests raised from the support page appear here."
        />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>Updated</th>
                <th>Subject</th>
                <th>User</th>
                <th>Priority</th>
                <th>Status</th>
                <th className="text-right">Set status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td className="numeric whitespace-nowrap text-content-muted">{formatDateTime(t.updatedAt)}</td>
                  <td className="font-medium">{t.subject}</td>
                  <td className="text-content-secondary">{t.userEmail ?? '—'}</td>
                  <td>
                    <span className="badge">{t.priority}</span>
                  </td>
                  <td>
                    <span className="badge">{t.status}</span>
                  </td>
                  <td className="text-right">
                    <select
                      className="select max-w-[140px] text-xs"
                      value={t.status}
                      onChange={(e) => void setStatus(t.id, e.target.value)}
                      aria-label={`Set status for ${t.subject}`}
                    >
                      {['open', 'pending', 'resolved', 'closed'].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onChange={(page) => setQuery({ ...query, page: String(page) })}
          />
        </TableScroll>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Integrations health                                                 */
/* ------------------------------------------------------------------ */

interface IntegrationHealth {
  payments: { configured: boolean; webhooks: boolean; provider: string };
  ai: { configured: boolean; provider: string; model: string };
  dataset: { owner: string; repo: string; branch: string };
  version: string;
}

export function IntegrationsPanel() {
  const [data, setData] = useState<IntegrationHealth | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void get<IntegrationHealth>('/admin-ops/integrations')
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Spinner />;

  const rows = [
    {
      name: 'Payments gateway',
      status: data.payments.configured ? 'configured' : 'not configured',
      detail: `${data.payments.provider} · webhooks ${data.payments.webhooks ? 'verified' : 'missing secret'}`,
      ok: data.payments.configured && data.payments.webhooks,
    },
    {
      name: 'AI (NVIDIA NIM)',
      status: data.ai.configured ? 'configured' : 'fallback only',
      detail: `${data.ai.provider} · ${data.ai.model}`,
      ok: data.ai.configured,
    },
    {
      name: 'Question dataset',
      status: 'private repo',
      detail: `${data.dataset.owner}/${data.dataset.repo}@${data.dataset.branch}`,
      ok: true,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.name} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', r.ok ? 'bg-positive' : 'bg-caution')}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-medium text-content-primary">{r.name}</p>
              <p className="mt-0.5 font-mono text-xs text-content-muted">{r.detail}</p>
            </div>
          </div>
          <span className={r.ok ? 'badge badge-success' : 'badge badge-warning'}>{r.status}</span>
        </div>
      ))}
      <p className="text-xs text-content-muted">Server version {data.version}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk user actions                                                   */
/* ------------------------------------------------------------------ */

export function BulkUserActions({
  userIds,
  onDone,
}: {
  userIds: string[];
  onDone: () => void;
}) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const result = await api<{ affected: number }>('/admin-ops/users/bulk', {
        method: 'POST',
        body: { action, ids: userIds, ...payload },
      });
      setNotice(`${result.affected} account(s) updated.`);
      onDone();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (userIds.length === 0) return null;

  return (
    <div className="panel flex flex-wrap items-center gap-2 p-3 text-sm">
      <span className="chip chip-active" aria-live="polite">
        {userIds.length} selected
      </span>
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void run('suspend')}>
        Suspend
      </button>
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void run('unsuspend')}>
        Restore
      </button>
      <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void run('verify_email')}>
        Mark verified
      </button>
      {notice ? <span className="text-xs text-content-muted">{notice}</span> : null}
    </div>
  );
}
