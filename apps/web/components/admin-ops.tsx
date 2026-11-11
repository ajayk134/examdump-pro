'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, del, get, patch, post } from '@/lib/api';
import type { Paginated, Payment } from '@/lib/types';
import { Alert, EmptyState, Spinner, StatCard } from '@/components/ui';
import { formatDate, formatDateTime, formatMoneyMinor } from '@/lib/format';

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
      <span className="text-content-muted">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
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
  // streams the file with the session cookie attached.
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  window.open(`${base}/api/admin-ops/export/${resource}`, '_blank', 'noopener');
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
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Payments" value={totals.count} />
        <StatCard label="Collected (this page)" value={formatMoneyMinor(totals.gross, 'INR')} tone="success" />
        <StatCard label="Refunded (this page)" value={formatMoneyMinor(totals.refunded, 'INR')} tone="warning" />
      </div>

      <div className="card flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[200px] flex-1">
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
        <div>
          <label className="label" htmlFor="pay-status">
            Status
          </label>
          <select
            id="pay-status"
            className="input"
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
      </div>

      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {refundTarget ? (
        <div className="card space-y-3 p-4">
          <p className="font-medium">
            Refund {refundTarget.userEmail} · {formatMoneyMinor(refundTarget.amountMinor, refundTarget.currency)}
          </p>
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
          <div className="flex gap-2">
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void submitRefund()}>
              {busy ? 'Processing…' : 'Confirm refund'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRefundTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No payments" description="Payments appear here as soon as checkout is live." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-t border-surface-border">
                  <td className="px-4 py-2 text-content-muted">{formatDateTime(p.createdAt)}</td>
                  <td className="px-4 py-2">{p.userEmail ?? '—'}</td>
                  <td className="px-4 py-2">
                    {p.description || 'Subscription'}
                    {p.providerPaymentId ? (
                      <span className="block font-mono text-[11px] text-content-muted">{p.providerPaymentId}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-content-secondary">{p.provider}</td>
                  <td className="px-4 py-2">
                    <span className="badge">{p.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatMoneyMinor(p.amountMinor - p.refundedMinor, p.currency)}
                    {p.refundedMinor > 0 ? (
                      <span className="block text-[11px] text-content-muted">
                        −{formatMoneyMinor(p.refundedMinor, p.currency)} refunded
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {p.status === 'succeeded' || p.status === 'partially_refunded' ? (
                      <button type="button" className="btn-ghost text-xs" onClick={() => setRefundTarget(p)}>
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
        </div>
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
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-medium">Payment reconciliation</p>
          <p className="text-xs text-content-muted">
            Re-checks pending gateway payments and repairs access drift from missed webhooks.
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={running} onClick={() => void runReconciliation()}>
          {running ? 'Running…' : 'Run now'}
        </button>
      </div>

      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {recon && recon.runs.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Trigger</th>
                <th className="px-4 py-2 text-right">Checked</th>
                <th className="px-4 py-2 text-right">Repaired</th>
                <th className="px-4 py-2 text-right">Mismatches</th>
              </tr>
            </thead>
            <tbody>
              {recon.runs.slice(0, 5).map((run, i) => (
                <tr key={String(run.id ?? i)} className="border-t border-surface-border">
                  <td className="px-4 py-2">{formatDateTime(String(run.startedAt ?? ''))}</td>
                  <td className="px-4 py-2">{String(run.trigger ?? '—')}</td>
                  <td className="px-4 py-2 text-right">{String(run.checked ?? 0)}</td>
                  <td className="px-4 py-2 text-right">{String(run.repaired ?? 0)}</td>
                  <td className="px-4 py-2 text-right">{String(run.mismatches ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {loading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No webhooks received yet" description="Gateway callbacks appear here with signature status." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th className="px-4 py-2">Received</th>
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Attempts</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr key={w.id} className="border-t border-surface-border">
                  <td className="px-4 py-2 text-content-muted">{formatDateTime(w.receivedAt)}</td>
                  <td className="px-4 py-2">
                    {w.eventType}
                    <span className="block font-mono text-[11px] text-content-muted">{w.eventId}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="badge">{w.status}</span>
                    {w.lastError ? (
                      <span className="block text-[11px] text-rose-500">{w.lastError.slice(0, 80)}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">{w.attempts}</td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" className="btn-ghost text-xs" onClick={() => void replay(w.id)}>
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
        </div>
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
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <p className="font-medium">New announcement</p>
        <input
          className="input"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          className="input min-h-20"
          placeholder="Message shown as a site-wide banner"
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        <div className="flex flex-wrap gap-2">
          <select className="input max-w-[160px]" value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>
            {['info', 'success', 'warning', 'critical'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select
            className="input max-w-[180px]"
            value={draft.audience}
            onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
          >
            <option value="all">Everyone</option>
            <option value="free">Free accounts</option>
            <option value="premium">Pass holders</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => void create()}>
            Publish
          </button>
        </div>
      </div>

      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No announcements" description="Publish one to show a banner across the site." />
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">
                  {a.title} <span className="badge ml-1">{a.level}</span>
                  {!a.active ? <span className="badge ml-1">hidden</span> : null}
                </p>
                <p className="mt-1 text-sm text-content-secondary">{a.body}</p>
                <p className="mt-1 text-xs text-content-muted">
                  {a.audience} · {formatDate(a.createdAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => void toggle(a)}>
                  {a.active ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => void remove(a.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[200px] flex-1">
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
        <div>
          <label className="label" htmlFor="ticket-status">
            Status
          </label>
          <select
            id="ticket-status"
            className="input"
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
      </div>

      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No tickets" description="Requests raised from the support page appear here." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface-overlay text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th className="px-4 py-2">Updated</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="border-t border-surface-border">
                  <td className="px-4 py-2 text-content-muted">{formatDateTime(t.updatedAt)}</td>
                  <td className="px-4 py-2">{t.subject}</td>
                  <td className="px-4 py-2 text-content-secondary">{t.userEmail ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className="badge">{t.priority}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="badge">{t.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <select
                      className="input max-w-[140px] text-xs"
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
        </div>
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
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.name} className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">{r.name}</p>
            <p className="text-xs text-content-muted">{r.detail}</p>
          </div>
          <span className={r.ok ? 'badge-premium' : 'badge'}>{r.status}</span>
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
    <div className="card flex flex-wrap items-center gap-2 p-3 text-sm">
      <span className="text-content-muted">{userIds.length} selected</span>
      <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void run('suspend')}>
        Suspend
      </button>
      <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void run('unsuspend')}>
        Restore
      </button>
      <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void run('verify_email')}>
        Mark verified
      </button>
      {notice ? <span className="text-xs text-content-muted">{notice}</span> : null}
    </div>
  );
}
