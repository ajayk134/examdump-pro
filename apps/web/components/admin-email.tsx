'use client';

/**
 * Admin Email Center.
 *
 * One panel, five sub-views: overview, campaigns, templates, queue and
 * suppression. Kept responsive throughout — the campaign editor collapses to a
 * single column and preview opens in a drawer on small screens.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { del, get, patch, post } from '@/lib/api';
import { Alert, Badge, Card, Drawer, EmptyState, Spinner, StatCard } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatNumber } from '@/lib/format';

/* -------------------------------- types -------------------------------- */

interface QueueStats {
  queued: number;
  sending: number;
  sent: number;
  dead: number;
  suppressed: number;
  cancelled: number;
}

interface Overview {
  queue: QueueStats;
  health: { ok: boolean; backlog: number; stuck: number; dead: number };
  worker: {
    enabled: boolean;
    running: boolean;
    lastRunAt: string | null;
    lastError: string | null;
    totalSent: number;
    batchSize: number;
    intervalSeconds: number;
    hourlyLimit: number;
  };
  configured: boolean;
  campaigns: { total: number; scheduled: number; sent: number; draft: number };
  delivery: { sent: number; failed: number; suppressed: number };
  suppressions: number;
  trend: Array<{ date: string; status: string; value: number }>;
}

interface Campaign {
  id: string;
  name: string;
  subject: string;
  html: string;
  text: string;
  category: 'transactional' | 'marketing';
  status: string;
  segment: Record<string, unknown>;
  scheduledFor: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  createdAt: string;
}

interface Template {
  key: string;
  subject: string;
  body: string;
  textBody: string;
  description: string;
  category: 'transactional' | 'marketing';
  variables: string[];
  isSystem: boolean;
  enabled: boolean;
  updatedAt: string;
}

interface QueueMessage {
  id: string;
  recipient: string;
  subject: string;
  template: string;
  category: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  messageId: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
}

interface Suppression {
  id: string;
  email: string;
  reason: string;
  scope: string;
  note: string;
  createdAt: string;
}

type View = 'overview' | 'campaigns' | 'templates' | 'queue' | 'suppression';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'templates', label: 'Templates' },
  { id: 'queue', label: 'Queue' },
  { id: 'suppression', label: 'Suppression' },
];

const STATUS_TONE: Record<string, 'default' | 'accent' | 'success' | 'warning' | 'danger'> = {
  queued: 'accent',
  sending: 'accent',
  sent: 'success',
  scheduled: 'accent',
  draft: 'default',
  failed: 'danger',
  dead: 'danger',
  cancelled: 'default',
  suppressed: 'warning',
};

function statusBadge(status: string) {
  return <Badge tone={STATUS_TONE[status] ?? 'default'}>{status}</Badge>;
}

/* ------------------------------- helpers ------------------------------- */

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Field wrapper matching the rest of the admin UI. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-content-subtle">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-content placeholder:text-content-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

/* ------------------------------- overview ------------------------------ */

function OverviewView({ onGo }: { onGo: (view: View) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      get<Overview>('/admin-ops/email/overview')
        .then((res) => !cancelled && setData(res))
        .catch((err) => !cancelled && setError((err as Error).message));
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Spinner label="Loading email statistics" />;

  const totalTrend = data.trend.reduce((sum, row) => sum + Number(row.value), 0);
  const attempted = data.delivery.sent + data.delivery.failed;
  const successRate = attempted > 0 ? Math.round((data.delivery.sent / attempted) * 100) : null;

  return (
    <div className="space-y-4">
      {!data.configured ? (
        <Alert tone="warning">
          SMTP is not configured, so messages are being stored but not delivered. Set the SMTP
          credentials and redeploy.
        </Alert>
      ) : null}
      {data.worker.lastError ? (
        <Alert tone="error">Worker error: {data.worker.lastError}</Alert>
      ) : null}
      {data.health.dead > 0 ? (
        <Alert tone="warning">
          {formatNumber(data.health.dead)} message{data.health.dead === 1 ? '' : 's'} in the
          dead-letter queue.{' '}
          <button className="underline" onClick={() => onGo('queue')}>
            Review them
          </button>
          .
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Queued" value={formatNumber(data.queue.queued)} hint="Waiting to send" />
        <StatCard label="Sent" value={formatNumber(data.queue.sent)} hint="All time" />
        <StatCard
          label="Dead letter"
          value={formatNumber(data.queue.dead)}
          hint={data.queue.dead > 0 ? 'Needs attention' : 'All healthy'}
        />
        <StatCard label="Suppressed" value={formatNumber(data.suppressions)} hint="Opt-outs & bounces" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Queue worker</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Status</dt>
              <dd>
                <Badge tone={data.worker.enabled ? 'success' : 'default'}>
                  {data.worker.enabled ? 'enabled' : 'disabled'}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Last run</dt>
              <dd className="text-right">
                {data.worker.lastRunAt ? new Date(data.worker.lastRunAt).toLocaleTimeString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Batch / interval</dt>
              <dd>
                {data.worker.batchSize} every {data.worker.intervalSeconds}s
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Hourly ceiling</dt>
              <dd>{formatNumber(data.worker.hourlyLimit)} messages</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Sent by this process</dt>
              <dd>{formatNumber(data.worker.totalSent)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold">Delivery (30 days)</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Accepted by SMTP</dt>
              <dd>{formatNumber(data.delivery.sent)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Failed</dt>
              <dd>{formatNumber(data.delivery.failed)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Suppressed</dt>
              <dd>{formatNumber(data.delivery.suppressed)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Acceptance rate</dt>
              <dd>{successRate === null ? '—' : `${successRate}%`}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Campaigns</dt>
              <dd>
                {data.campaigns.sent} sent · {data.campaigns.scheduled} scheduled
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-content-subtle">
            «Accepted» means Gmail accepted the message. It does not guarantee inbox placement.
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Volume trend</h3>
        <p className="text-xs text-content-subtle">{formatNumber(totalTrend)} messages queued in 30 days</p>
        <TrendChart rows={data.trend} />
      </Card>
    </div>
  );
}

/** Minimal inline SVG bar chart - no charting dependency. */
function TrendChart({ rows }: { rows: Array<{ date: string; status: string; value: number }> }) {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.value));
  }
  const series = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  if (series.length === 0) {
    return <p className="mt-4 text-sm text-content-muted">No mail has been queued yet.</p>;
  }
  const max = Math.max(...series.map(([, value]) => value), 1);

  return (
    <div className="mt-4 flex h-24 items-end gap-1">
      {series.map(([date, value]) => (
        <div
          key={date}
          className="flex-1 rounded-t bg-brand-500/70 transition hover:bg-brand-500"
          style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
          title={`${date}: ${value}`}
        />
      ))}
    </div>
  );
}

/* ------------------------------- campaigns ----------------------------- */

const EMPTY_CAMPAIGN = {
  name: '',
  subject: '',
  html: '<p>Hi {{first_name}},</p>\n<p></p>',
  text: '',
  category: 'marketing' as 'marketing' | 'transactional',
  segment: { plan: 'any' as 'any' | 'free' | 'premium' },
  scheduledFor: '',
};

function CampaignsView() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<typeof EMPTY_CAMPAIGN | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const debouncedSearch = useDebounced(search);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (status) params.set('status', status);
      const res = await get<{ campaigns: Campaign[]; total: number }>(
        `/admin-ops/email/campaigns?${params.toString()}`,
      );
      setRows(res.campaigns);
      setTotal(res.total);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Audience count updates as the segment changes.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    post<{ total: number }>('/admin-ops/email/audience', {
      segment: editing.segment,
      marketing: editing.category === 'marketing',
    })
      .then((res) => !cancelled && setAudience(res.total))
      .catch(() => !cancelled && setAudience(null));
    return () => {
      cancelled = true;
    };
  }, [editing]);

  async function save(send: boolean) {
    if (!editing) return;
    setBusy(true);
    try {
      if (editingId) {
        await patch(`/admin-ops/email/campaigns/${editingId}`, editing);
        if (send) await post(`/admin-ops/email/campaigns/${editingId}/send`);
      } else {
        const created = await post<{ campaign: Campaign }>('/admin-ops/email/campaigns', editing);
        if (send && created.campaign) await post(`/admin-ops/email/campaigns/${created.campaign.id}/send`);
      }
      toast(send ? 'Campaign queued for sending' : 'Draft saved', 'success');
      setEditing(null);
      setEditingId(null);
      await load();
    } catch (err) {
      toast(`Could not save: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!editing) return;
    try {
      const res = await post<{ subject: string; html: string; text: string }>('/admin-ops/email/preview', {
        subject: editing.subject,
        html: editing.html,
        text: editing.text,
      });
      setPreview(res);
    } catch (err) {
      toast(`Preview failed: ${(err as Error).message}`, 'error');
    }
  }

  async function cancel(id: string) {
    try {
      await post(`/admin-ops/email/campaigns/${id}/cancel`);
      toast('Campaign cancelled', 'success');
      await load();
    } catch (err) {
      toast(`Could not cancel: ${(err as Error).message}`, 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Search campaigns"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={`${inputClass} max-w-[10rem]`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          className="ml-auto rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          onClick={() => {
            setEditing({ ...EMPTY_CAMPAIGN });
            setEditingId(null);
          }}
        >
          New campaign
        </button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {editing ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editingId ? 'Edit campaign' : 'New campaign'}</h3>
            <button className="text-xs text-content-muted underline" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Internal name">
              <input
                className={inputClass}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="Subject" hint="Placeholders like {{first_name}} are allowed.">
              <input
                className={inputClass}
                value={editing.subject}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
              />
            </Field>
            <Field label="Category" hint="Marketing requires opt-in and adds an unsubscribe link.">
              <select
                className={inputClass}
                value={editing.category}
                onChange={(e) =>
                  setEditing({ ...editing, category: e.target.value as 'marketing' | 'transactional' })
                }
              >
                <option value="marketing">Marketing</option>
                <option value="transactional">Transactional</option>
              </select>
            </Field>
            <Field label="Audience plan">
              <select
                className={inputClass}
                value={editing.segment.plan ?? 'any'}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    segment: { ...editing.segment, plan: e.target.value as 'any' },
                  })
                }
              >
                <option value="any">Everyone</option>
                <option value="free">Free plan</option>
                <option value="premium">Premium plan</option>
              </select>
            </Field>
          </div>

          <Field label="HTML body">
            <textarea
              className={`${inputClass} min-h-[180px] font-mono text-xs`}
              value={editing.html}
              onChange={(e) => setEditing({ ...editing, html: e.target.value })}
            />
          </Field>
          <Field label="Plain-text fallback" hint="Leave blank to generate automatically from the HTML.">
            <textarea
              className={`${inputClass} min-h-[80px] font-mono text-xs`}
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-content-muted">
              {audience === null ? 'Counting audience…' : `${formatNumber(audience)} eligible recipients`}
            </p>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="rounded-xl border border-border px-3 py-2 text-sm" onClick={runPreview}>
                Preview
              </button>
              <button
                className="rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={() => save(false)}
              >
                Save draft
              </button>
              <button
                className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => save(true)}
              >
                Queue for sending
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <Spinner label="Loading campaigns" />
      ) : rows.length === 0 ? (
        <EmptyState icon="inbox" title="No campaigns yet" description="Create one to reach your audience." />
      ) : (
        <div className="space-y-2">
          {rows.map((campaign) => (
            <Card key={campaign.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">{campaign.name}</p>
                  {statusBadge(campaign.status)}
                  <Badge tone={campaign.category === 'marketing' ? 'accent' : 'default'}>
                    {campaign.category}
                  </Badge>
                </div>
                <p className="truncate text-xs text-content-muted">{campaign.subject}</p>
                <p className="mt-1 text-xs text-content-subtle">
                  {formatNumber(campaign.sentCount)} sent · {formatNumber(campaign.failedCount)} failed ·{' '}
                  {formatNumber(campaign.suppressedCount)} skipped · {formatNumber(campaign.totalRecipients)} audience
                </p>
              </div>
              <div className="flex gap-2">
                {['draft', 'scheduled'].includes(campaign.status) ? (
                  <>
                    <button
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs"
                      onClick={() => {
                        setEditingId(campaign.id);
                        setEditing({
                          name: campaign.name,
                          subject: campaign.subject,
                          html: campaign.html,
                          text: campaign.text,
                          category: campaign.category,
                          segment: campaign.segment as typeof EMPTY_CAMPAIGN.segment,
                          scheduledFor: campaign.scheduledFor ?? '',
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white"
                      onClick={() => void post(`/admin-ops/email/campaigns/${campaign.id}/send`).then(load)}
                    >
                      Send
                    </button>
                  </>
                ) : null}
                {['sending', 'scheduled'].includes(campaign.status) ? (
                  <button
                    className="rounded-lg border border-danger-300 px-2.5 py-1.5 text-xs text-danger-600"
                    onClick={() => cancel(campaign.id)}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > pageSize ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-content-muted">
            Page {page} of {Math.ceil(total / pageSize)}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <Drawer open={Boolean(preview)} onClose={() => setPreview(null)} title="Email preview">
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{preview.subject}</p>
            {/* Sandboxed so template HTML can never run script in the admin app. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[420px] w-full rounded-xl border border-border bg-white"
            />
            <div>
              <p className="text-xs font-semibold uppercase text-content-muted">Plain text</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-2 text-xs">
                {preview.text}
              </pre>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* ------------------------------- templates ----------------------------- */

const BLANK_TEMPLATE = {
  key: '',
  subject: '',
  body: '',
  textBody: '',
  description: '',
  category: 'transactional' as 'transactional' | 'marketing',
  enabled: true,
};

function TemplatesView() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<typeof BLANK_TEMPLATE | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ templates: Template[] }>('/admin-ops/email/templates');
      setRows(res.templates);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await post('/admin-ops/email/templates', draft);
      toast('Template saved', 'success');
      setDraft(null);
      await load();
    } catch (err) {
      toast(`Could not save template: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!draft) return;
    try {
      const res = await post<{ subject: string; html: string; text: string }>('/admin-ops/email/preview', {
        subject: draft.subject,
        html: draft.body,
        text: draft.textBody,
      });
      setPreview(res);
    } catch (err) {
      toast(`Preview failed: ${(err as Error).message}`, 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-content-muted">
          Built-in templates render from code unless you supply an enabled override here.
        </p>
        <button
          className="ml-auto rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          onClick={() => setDraft({ ...BLANK_TEMPLATE, key: '' })}
        >
          New template
        </button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {draft ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{draft.key ? `Edit ${draft.key}` : 'New template'}</h3>
            <button className="text-xs text-content-muted underline" onClick={() => setDraft(null)}>
              Close
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Key" hint="Lowercase letters, numbers, underscores.">
              <input
                className={inputClass}
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              />
            </Field>
            <Field label="Subject">
              <input
                className={inputClass}
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </Field>
          </div>
          <Field label="HTML body">
            <textarea
              className={`${inputClass} min-h-[200px] font-mono text-xs`}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </Field>
          <Field label="Plain-text fallback" hint="Generated from the HTML when empty.">
            <textarea
              className={`${inputClass} min-h-[80px] font-mono text-xs`}
              value={draft.textBody}
              onChange={(e) => setDraft({ ...draft, textBody: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="ml-auto flex gap-2">
              <button className="rounded-xl border border-border px-3 py-2 text-sm" onClick={runPreview}>
                Preview
              </button>
              <button
                className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={busy}
                onClick={save}
              >
                Save
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <Spinner label="Loading templates" />
      ) : (
        <div className="space-y-2">
          {rows.map((template) => (
            <Card key={template.key} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-medium">{template.key}</p>
                  <Badge tone={template.enabled && template.body ? 'success' : 'default'}>
                    {template.body ? (template.enabled ? 'override on' : 'override off') : 'built-in'}
                  </Badge>
                  {template.isSystem ? <Badge tone="accent">system</Badge> : null}
                </div>
                <p className="text-xs text-content-muted">{template.description || template.subject || '—'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs"
                  onClick={() =>
                    setDraft({
                      key: template.key,
                      subject: template.subject,
                      body: template.body,
                      textBody: template.textBody,
                      description: template.description,
                      category: template.category,
                      enabled: template.enabled,
                    })
                  }
                >
                  Edit
                </button>
                {!template.isSystem ? (
                  <button
                    className="rounded-lg border border-danger-300 px-2.5 py-1.5 text-xs text-danger-600"
                    onClick={() =>
                      void del(`/admin-ops/email/templates/${template.key}`).then(load).catch(() =>
                        toast('Built-in templates cannot be deleted', 'error'),
                      )
                    }
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer open={Boolean(preview)} onClose={() => setPreview(null)} title="Template preview">
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{preview.subject}</p>
            <iframe
              title="Template preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[420px] w-full rounded-xl border border-border bg-white"
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* --------------------------------- queue ------------------------------- */

function QueueView() {
  const { toast } = useToast();
  const [rows, setRows] = useState<QueueMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('dead');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const debouncedSearch = useDebounced(search);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) params.set('status', status);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await get<{ messages: QueueMessage[]; total: number }>(
        `/admin-ops/email/queue?${params.toString()}`,
      );
      setRows(res.messages);
      setTotal(res.total);
      setSelected([]);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, status, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry() {
    if (selected.length === 0) return;
    try {
      const res = await post<{ requeued: number }>('/admin-ops/email/queue/retry', { ids: selected });
      toast(`${res.requeued} message(s) re-queued`, 'success');
      await load();
    } catch (err) {
      toast(`Retry failed: ${(err as Error).message}`, 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Search recipient or subject"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={`${inputClass} max-w-[10rem]`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['queued', 'sending', 'sent', 'failed', 'dead', 'suppressed', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {selected.length > 0 ? (
          <button className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white" onClick={retry}>
            Retry {selected.length}
          </button>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Spinner label="Loading queue" />
      ) : rows.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing here" description="No messages match this filter." />
      ) : (
        <div className="space-y-2">
          {rows.map((message) => (
            <Card key={message.id} className="flex flex-wrap items-start gap-3 p-3">
              {['dead', 'failed', 'cancelled'].includes(message.status) ? (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(message.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, message.id] : prev.filter((id) => id !== message.id),
                    )
                  }
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{message.subject}</p>
                  {statusBadge(message.status)}
                  <Badge tone={message.category === 'marketing' ? 'accent' : 'default'}>{message.category}</Badge>
                </div>
                <p className="truncate text-xs text-content-muted">
                  {message.recipient} · {message.template}
                </p>
                <p className="mt-1 text-xs text-content-subtle">
                  attempt {message.attempts}/{message.maxAttempts} ·{' '}
                  {new Date(message.createdAt).toLocaleString()}
                  {message.messageId ? ` · id ${message.messageId}` : ''}
                </p>
                {message.lastError ? (
                  <p className="mt-1 break-words rounded-lg bg-danger-50 px-2 py-1 text-xs text-danger-700">
                    {message.lastError}
                  </p>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > pageSize ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-content-muted">
            Page {page} of {Math.ceil(total / pageSize)} · {formatNumber(total)} total
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ suppression ---------------------------- */

function SuppressionView() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<'manual' | 'complaint' | 'hard_bounce'>('manual');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const debouncedSearch = useDebounced(search);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await get<{ suppressions: Suppression[]; total: number }>(
        `/admin-ops/email/suppressions?${params.toString()}`,
      );
      setRows(res.suppressions);
      setTotal(res.total);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <Field label="Suppress address">
          <input
            className={inputClass}
            placeholder="someone@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Reason">
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as 'manual')}>
            <option value="manual">Manual</option>
            <option value="hard_bounce">Hard bounce</option>
            <option value="complaint">Complaint</option>
          </select>
        </Field>
        <button
          className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
          onClick={() =>
            void post('/admin-ops/email/suppressions', { email, reason, scope: 'marketing' })
              .then(() => {
                setEmail('');
                toast('Address suppressed', 'success');
                return load();
              })
              .catch((err) => toast(`Failed: ${(err as Error).message}`, 'error'))
          }
        >
          Add
        </button>
        <input
          className={`${inputClass} ml-auto max-w-xs`}
          placeholder="Search suppressions"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Spinner label="Loading suppressions" />
      ) : rows.length === 0 ? (
        <EmptyState icon="inbox" title="No suppressed addresses" description="Opt-outs and bounces appear here." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.email}</p>
                <p className="text-xs text-content-muted">
                  {row.reason} · {row.scope === 'all' ? 'all mail' : 'marketing only'} ·{' '}
                  {new Date(row.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs"
                onClick={() =>
                  void del(`/admin-ops/email/suppressions/${encodeURIComponent(row.email)}`)
                    .then(() => load())
                    .catch((err) => toast(`Failed: ${(err as Error).message}`, 'error'))
                }
              >
                Remove
              </button>
            </Card>
          ))}
        </div>
      )}

      {total > pageSize ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-content-muted">
            Page {page} of {Math.ceil(total / pageSize)}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- shell ------------------------------- */

export function EmailCenterPanel() {
  const [view, setView] = useState<View>('overview');

  const views = useMemo(() => VIEWS, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {views.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium transition ${
              view === item.id
                ? 'bg-brand-600 text-white'
                : 'border border-border text-content-muted hover:text-content'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'overview' ? <OverviewView onGo={setView} /> : null}
      {view === 'campaigns' ? <CampaignsView /> : null}
      {view === 'templates' ? <TemplatesView /> : null}
      {view === 'queue' ? <QueueView /> : null}
      {view === 'suppression' ? <SuppressionView /> : null}
    </div>
  );
}
