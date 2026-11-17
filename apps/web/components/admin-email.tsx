'use client';

/**
 * Admin Email Center.
 *
 * One panel, five sub-views: overview, campaigns, templates, queue and
 * suppression. Kept responsive throughout — the campaign editor collapses to a
 * single column and preview opens in a drawer on small screens.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { del, get, patch, post } from '@/lib/api';
import { Alert, Badge, Dialog, Drawer, EmptyIcon, EmptyState, Spinner, StatStrip, TableScroll, Tabs } from '@/components/ui';
import { Toolbar } from '@/components/admin-ops';
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
  deliverability: {
    fromDomain: string;
    ownedDomain: boolean;
    sharedConsumerDomain: boolean;
    risk: 'low' | 'high';
    summary: string;
    recommendations: string[];
    authentication: {
      spf: { status: string; detail: string };
      dkim: { status: string; detail: string };
      dmarc: { status: string; detail: string };
    };
  };
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
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-content-secondary">{label}</span>
      {children}
      {hint ? <span className="text-xs text-content-muted">{hint}</span> : null}
    </label>
  );
}

function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const totalPages = Math.ceil(total / pageSize);
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="numeric text-content-muted">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={page === 1}
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
    <div className="flex flex-col gap-4">
      {!data.configured ? (
        <Alert tone="warning">
          SMTP is not configured, so messages are being stored but not delivered. Set the SMTP
          credentials and redeploy.
        </Alert>
      ) : null}
      {data.worker.lastError ? <Alert tone="error">Worker error: {data.worker.lastError}</Alert> : null}
      {data.health.dead > 0 ? (
        <Alert tone="warning">
          {formatNumber(data.health.dead)} message{data.health.dead === 1 ? '' : 's'} in the
          dead-letter queue.{' '}
          <button className="link" onClick={() => onGo('queue')}>
            Review them
          </button>
          .
        </Alert>
      ) : null}

      <div className="panel overflow-hidden p-0">
        <StatStrip
          items={[
            { label: 'Queued', value: formatNumber(data.queue.queued), hint: 'Waiting to send' },
            { label: 'Sent', value: formatNumber(data.queue.sent), hint: 'All time' },
            {
              label: 'Dead letter',
              value: formatNumber(data.queue.dead),
              hint: data.queue.dead > 0 ? 'Needs attention' : 'All healthy',
              tone: data.queue.dead > 0 ? 'warning' : 'default',
            },
            { label: 'Suppressed', value: formatNumber(data.suppressions), hint: 'Opt-outs & bounces' },
          ]}
          columns={4}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel p-4" aria-labelledby="email-worker-heading">
          <h3 id="email-worker-heading" className="heading-3">
            Queue worker
          </h3>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
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
              <dd className="numeric text-right">
                {data.worker.lastRunAt ? new Date(data.worker.lastRunAt).toLocaleTimeString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Batch / interval</dt>
              <dd className="numeric">
                {data.worker.batchSize} every {data.worker.intervalSeconds}s
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Hourly ceiling</dt>
              <dd className="numeric">{formatNumber(data.worker.hourlyLimit)} messages</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Sent by this process</dt>
              <dd className="numeric">{formatNumber(data.worker.totalSent)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel p-4" aria-labelledby="email-delivery-heading">
          <h3 id="email-delivery-heading" className="heading-3">
            Delivery (30 days)
          </h3>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Accepted by SMTP</dt>
              <dd className="numeric">{formatNumber(data.delivery.sent)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Failed</dt>
              <dd className="numeric">{formatNumber(data.delivery.failed)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Suppressed</dt>
              <dd className="numeric">{formatNumber(data.delivery.suppressed)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Acceptance rate</dt>
              <dd className="numeric">{successRate === null ? '—' : `${successRate}%`}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Campaigns</dt>
              <dd className="numeric">
                {data.campaigns.sent} sent · {data.campaigns.scheduled} scheduled
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-content-muted">
            «Accepted» means Gmail accepted the message. It does not guarantee inbox placement.
          </p>
        </section>
      </div>

      <DeliverabilityCard report={data.deliverability} />

      <section className="panel p-4" aria-labelledby="email-trend-heading">
        <h3 id="email-trend-heading" className="heading-3">
          Volume trend
        </h3>
        <p className="text-xs text-content-muted">{formatNumber(totalTrend)} messages queued in 30 days</p>
        <TrendChart rows={data.trend} />
      </section>
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
          className="flex-1 rounded-t bg-gradient-to-t from-brand-600 to-sky-400 opacity-80 transition-opacity hover:opacity-100"
          style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
          title={`${date}: ${value}`}
        />
      ))}
    </div>
  );
}

/**
 * Sender authentication panel.
 *
 * This states plainly what can and cannot be verified. It deliberately does not
 * show a reassuring green tick when we send from a shared consumer domain,
 * because that would misrepresent why mail is being filtered.
 */
function DeliverabilityCard({ report }: { report: Overview['deliverability'] }) {
  const [open, setOpen] = useState(false);
  const rows: Array<[string, { status: string; detail: string }]> = [
    ['SPF', report.authentication.spf],
    ['DKIM', report.authentication.dkim],
    ['DMARC', report.authentication.dmarc],
  ];
  const tone = report.risk === 'high' ? 'warning' : 'success';

  return (
    <section className="panel p-4" aria-labelledby="email-auth-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="email-auth-heading" className="heading-3">
          Sender authentication
        </h3>
        <Badge tone={tone}>{report.risk === 'high' ? 'limited' : 'authenticated'}</Badge>
        <span className="text-xs text-content-muted">From: {report.fromDomain}</span>
      </div>
      <p className="mt-2 text-sm text-content-muted">{report.summary}</p>

      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {rows.map(([name, entry]) => (
          <li key={name} className="flex gap-2">
            <Badge tone={entry.status === 'possible' ? 'success' : 'warning'}>
              {entry.status === 'possible' ? 'available' : 'not possible'}
            </Badge>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-content-primary">{name}</span>
              <span className="block text-xs text-content-muted">{entry.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {report.recommendations.length > 0 ? (
        <>
          <button
            type="button"
            className="link mt-3 text-xs"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'What can be fixed'}
          </button>
          {open ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-content-muted">
              {report.recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <p className="mt-3 text-xs text-content-muted">
        «Sent» means the SMTP server accepted the message. It does not prove inbox placement — spam
        filtering happens after acceptance.
      </p>
    </section>
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
  const [confirmCancel, setConfirmCancel] = useState<Campaign | null>(null);

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
    <div className="flex flex-col gap-4">
      <Toolbar>
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label className="label" htmlFor="campaign-search">
            Search
          </label>
          <input
            id="campaign-search"
            className="input"
            placeholder="Search campaigns"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="campaign-status">
            Status
          </label>
          <select
            id="campaign-status"
            className="select"
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
        </div>
        <button
          type="button"
          className="btn-primary sm:ml-auto"
          onClick={() => {
            setEditing({ ...EMPTY_CAMPAIGN });
            setEditingId(null);
          }}
        >
          New campaign
        </button>
      </Toolbar>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {editing ? (
        <section className="panel flex flex-col gap-3 p-4" aria-label="Campaign editor">
          <div className="flex items-center justify-between gap-3">
            <h3 className="heading-3">{editingId ? 'Edit campaign' : 'New campaign'}</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Internal name">
              <input
                className="input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="Subject" hint="Placeholders like {{first_name}} are allowed.">
              <input
                className="input"
                value={editing.subject}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
              />
            </Field>
            <Field label="Category" hint="Marketing requires opt-in and adds an unsubscribe link.">
              <select
                className="select"
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
                className="select"
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
              className="input min-h-[180px] font-mono text-xs"
              value={editing.html}
              onChange={(e) => setEditing({ ...editing, html: e.target.value })}
            />
          </Field>
          <Field label="Plain-text fallback" hint="Leave blank to generate automatically from the HTML.">
            <textarea
              className="input min-h-[80px] font-mono text-xs"
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
          </Field>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <p className="text-sm text-content-muted" aria-live="polite">
              {audience === null ? 'Counting audience...' : `${formatNumber(audience)} eligible recipients`}
            </p>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <button type="button" className="btn-secondary btn-sm" onClick={runPreview}>
                Preview
              </button>
              <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => save(false)}>
                Save draft
              </button>
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => save(true)}>
                Queue for sending
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? (
        <Spinner label="Loading campaigns" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No campaigns yet"
          description="Create one to reach your audience."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((campaign) => (
            <div key={campaign.id} className="panel flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-content-primary">{campaign.name}</p>
                  {statusBadge(campaign.status)}
                  <Badge tone={campaign.category === 'marketing' ? 'accent' : 'default'}>
                    {campaign.category}
                  </Badge>
                </div>
                <p className="truncate text-xs text-content-muted">{campaign.subject}</p>
                <p className="numeric mt-1 text-xs text-content-muted">
                  {formatNumber(campaign.sentCount)} sent · {formatNumber(campaign.failedCount)} failed ·{' '}
                  {formatNumber(campaign.suppressedCount)} skipped · {formatNumber(campaign.totalRecipients)}{' '}
                  audience
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {['draft', 'scheduled'].includes(campaign.status) ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
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
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => void post(`/admin-ops/email/campaigns/${campaign.id}/send`).then(load)}
                    >
                      Send
                    </button>
                  </>
                ) : null}
                {['sending', 'scheduled'].includes(campaign.status) ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-negative"
                    onClick={() => setConfirmCancel(campaign)}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} total={total} pageSize={pageSize} onChange={setPage} />

      <Dialog
        open={Boolean(confirmCancel)}
        onClose={() => setConfirmCancel(null)}
        title="Cancel this campaign?"
        description={
          confirmCancel ? `“${confirmCancel.name}” will stop sending to the remaining audience.` : undefined
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmCancel(null)}>
              Keep sending
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (confirmCancel) void cancel(confirmCancel.id);
                setConfirmCancel(null);
              }}
            >
              Cancel campaign
            </button>
          </>
        }
      />

      <Drawer open={Boolean(preview)} onClose={() => setPreview(null)} title="Email preview">
        {preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-content-primary">{preview.subject}</p>
            {/* Sandboxed so template HTML can never run script in the admin app. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[420px] w-full rounded-xl border border-surface-border bg-white"
            />
            <div>
              <p className="eyebrow">Plain text</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-sunken p-2 text-xs text-content-secondary">
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
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);

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

  function removeTemplate(key: string) {
    void del(`/admin-ops/email/templates/${key}`)
      .then(load)
      .catch(() => toast('Built-in templates cannot be deleted', 'error'));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm text-content-muted">
          Built-in templates render from code unless you supply an enabled override here.
        </p>
        <button
          type="button"
          className="btn-primary sm:ml-auto"
          onClick={() => setDraft({ ...BLANK_TEMPLATE, key: '' })}
        >
          New template
        </button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {draft ? (
        <section className="panel flex flex-col gap-3 p-4" aria-label="Template editor">
          <div className="flex items-center justify-between gap-3">
            <h3 className="heading-3">{draft.key ? `Edit ${draft.key}` : 'New template'}</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Close
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Key" hint="Lowercase letters, numbers, underscores.">
              <input
                className="input"
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              />
            </Field>
            <Field label="Subject">
              <input
                className="input"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </Field>
          </div>
          <Field label="HTML body">
            <textarea
              className="input min-h-[200px] font-mono text-xs"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </Field>
          <Field label="Plain-text fallback" hint="Generated from the HTML when empty.">
            <textarea
              className="input min-h-[80px] font-mono text-xs"
              value={draft.textBody}
              onChange={(e) => setDraft({ ...draft, textBody: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-content-secondary">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="flex gap-2 sm:ml-auto">
              <button type="button" className="btn-secondary btn-sm" onClick={runPreview}>
                Preview
              </button>
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>
                Save
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? (
        <Spinner label="Loading templates" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No templates"
          description="Built-in templates are used until you add an override."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((template) => (
            <div key={template.key} className="panel flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-medium text-content-primary">{template.key}</p>
                  <Badge tone={template.enabled && template.body ? 'success' : 'default'}>
                    {template.body ? (template.enabled ? 'override on' : 'override off') : 'built-in'}
                  </Badge>
                  {template.isSystem ? <Badge tone="accent">system</Badge> : null}
                </div>
                <p className="truncate text-xs text-content-muted">
                  {template.description || template.subject || '—'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
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
                    type="button"
                    className="btn-ghost btn-sm text-negative"
                    onClick={() => setConfirmDelete(template)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this template override?"
        description={
          confirmDelete ? `“${confirmDelete.key}” will revert to the built-in template.` : undefined
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (confirmDelete) removeTemplate(confirmDelete.key);
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </>
        }
      />

      <Drawer open={Boolean(preview)} onClose={() => setPreview(null)} title="Template preview">
        {preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-content-primary">{preview.subject}</p>
            <iframe
              title="Template preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[420px] w-full rounded-xl border border-surface-border bg-white"
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
    <div className="flex flex-col gap-4">
      <Toolbar>
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label className="label" htmlFor="queue-search">
            Search
          </label>
          <input
            id="queue-search"
            className="input"
            placeholder="Search recipient or subject"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="queue-status">
            Status
          </label>
          <select
            id="queue-status"
            className="select"
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
        </div>
        {selected.length > 0 ? (
          <button type="button" className="btn-primary sm:ml-auto" onClick={retry}>
            Retry {selected.length}
          </button>
        ) : null}
      </Toolbar>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Spinner label="Loading queue" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<EmptyIcon name="inbox" />} title="Nothing here" description="No messages match this filter." />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th className="w-12">
                  <span className="sr-only">Select</span>
                </th>
                <th>Message</th>
                <th>Recipient</th>
                <th>Attempts</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((message) => {
                const selectable = ['dead', 'failed', 'cancelled'].includes(message.status);
                return (
                  <tr key={message.id}>
                    <td>
                      {selectable ? (
                        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-[rgb(var(--accent))]"
                            aria-label={`Select ${message.subject}`}
                            checked={selected.includes(message.id)}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...prev, message.id]
                                  : prev.filter((id) => id !== message.id),
                              )
                            }
                          />
                        </label>
                      ) : null}
                    </td>
                    <td className="max-w-[280px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-content-primary">
                          {message.subject}
                        </span>
                        {statusBadge(message.status)}
                        <Badge tone={message.category === 'marketing' ? 'accent' : 'default'}>
                          {message.category}
                        </Badge>
                      </div>
                      <span className="block truncate text-xs text-content-muted">{message.template}</span>
                      {message.lastError ? (
                        <span className="mt-1 block break-words rounded-lg bg-negative/10 px-2 py-1 text-xs text-negative">
                          {message.lastError}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[200px] truncate text-content-secondary">{message.recipient}</td>
                    <td className="numeric whitespace-nowrap text-content-secondary">
                      {message.attempts}/{message.maxAttempts}
                    </td>
                    <td className="whitespace-nowrap text-xs text-content-muted">
                      {new Date(message.createdAt).toLocaleString()}
                      {message.messageId ? (
                        <span className="block font-mono text-[11px]">id {message.messageId}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      <Pagination page={page} total={total} pageSize={pageSize} onChange={setPage} />
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
  const [confirmRemove, setConfirmRemove] = useState<Suppression | null>(null);

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
    <div className="flex flex-col gap-4">
      <Toolbar>
        <div className="min-w-0 sm:flex-1">
          <label className="label" htmlFor="suppress-email">
            Suppress address
          </label>
          <input
            id="suppress-email"
            className="input"
            placeholder="someone@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="suppress-reason">
            Reason
          </label>
          <select
            id="suppress-reason"
            className="select"
            value={reason}
            onChange={(e) => setReason(e.target.value as 'manual')}
          >
            <option value="manual">Manual</option>
            <option value="hard_bounce">Hard bounce</option>
            <option value="complaint">Complaint</option>
          </select>
        </div>
        <button
          type="button"
          className="btn-primary"
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
        <div className="min-w-0 sm:ml-auto sm:w-56">
          <label className="label" htmlFor="suppress-search">
            Search
          </label>
          <input
            id="suppress-search"
            className="input"
            placeholder="Search suppressions"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Toolbar>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Spinner label="Loading suppressions" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="inbox" />}
          title="No suppressed addresses"
          description="Opt-outs and bounces appear here."
        />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th>Address</th>
                <th>Reason</th>
                <th>Scope</th>
                <th>Added</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="max-w-[260px] truncate font-medium text-content-primary">{row.email}</td>
                  <td className="text-content-secondary">{row.reason}</td>
                  <td className="text-content-muted">{row.scope === 'all' ? 'all mail' : 'marketing only'}</td>
                  <td className="numeric whitespace-nowrap text-content-muted">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setConfirmRemove(row)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      <Dialog
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        title="Remove this suppression?"
        description={confirmRemove ? `${confirmRemove.email} will become eligible for marketing mail again.` : undefined}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmRemove(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (confirmRemove) {
                  void del(`/admin-ops/email/suppressions/${encodeURIComponent(confirmRemove.email)}`)
                    .then(() => load())
                    .catch((err) => toast(`Failed: ${(err as Error).message}`, 'error'));
                }
                setConfirmRemove(null);
              }}
            >
              Remove
            </button>
          </>
        }
      />

      <Pagination page={page} total={total} pageSize={pageSize} onChange={setPage} />
    </div>
  );
}

/* --------------------------------- shell ------------------------------- */

export function EmailCenterPanel() {
  const [view, setView] = useState<View>('overview');

  return (
    <div className="flex flex-col gap-4">
      <Tabs<View> tabs={VIEWS} value={view} onChange={setView} />

      {view === 'overview' ? <OverviewView onGo={setView} /> : null}
      {view === 'campaigns' ? <CampaignsView /> : null}
      {view === 'templates' ? <TemplatesView /> : null}
      {view === 'queue' ? <QueueView /> : null}
      {view === 'suppression' ? <SuppressionView /> : null}
    </div>
  );
}
