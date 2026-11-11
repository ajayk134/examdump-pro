'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, patch, post, del } from '@/lib/api';
import type { Paginated, Plan, User } from '@/lib/types';
import { Alert, EmptyState, Spinner, StatCard, TableScroll, Tabs } from '@/components/ui';
import { AdminUpiPanel } from '@/components/admin-upi';
import { formatDate, formatMoneyMinor, formatNumber } from '@/lib/format';
import { IconShield, IconTrophy } from '@/components/icons';
import {
  AnnouncementsPanel,
  IntegrationsPanel,
  PaymentsPanel,
  TicketsPanel,
  WebhooksPanel,
} from '@/components/admin-ops';
import { EmailCenterPanel } from '@/components/admin-email';

type Tab =
  | 'overview'
  | 'users'
  | 'payments'
  | 'upi'
  | 'webhooks'
  | 'coupons'
  | 'plans'
  | 'tickets'
  | 'announcements'
  | 'email'
  | 'integrations'
  | 'settings'
  | 'audit'
  | 'dataset';

interface AdminStats {
  users: { total: number; premium: number; verified: number; suspended: number };
  attempts: { total: number; completed: number };
  revenue: { grossMinor: number; refundedMinor: number; netMinor: number; currency: string; mock: boolean };
  subscriptions: { active: number };
  catalog: { providers: number; exams: number; totalQuestions: number };
  signups: Array<{ date: string; count: number }>;
}

interface Coupon {
  id: string;
  code: string;
  description: string;
  percentOff: number;
  maxRedemptions: number;
  redemptionCount: number;
  expiresAt?: string | null;
  active: boolean;
}

interface Settings {
  freeQuestionsPerExam: number;
  freeMockExamsPerDay: number;
  freeRandomQuestionsPerDay: number;
  premiumDailyQuestionLimit: number;
  maintenanceMode: boolean;
  registrationsOpen: boolean;
  announcement: string;
}

interface AuditRow {
  id: string;
  action: string;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string;
  createdAt: string;
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');

  if (loading) return <Spinner />;
  if (!user || user.role !== 'admin') {
    return <EmptyState title="Administrator access required" description="This area is restricted to platform administrators." icon={<IconShield width={36} height={36} />} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-2">
        <IconShield className="text-brand-400" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin console</h1>
          <p className="text-sm text-content-muted">Operate the platform, users and catalogue.</p>
        </div>
      </header>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'users', label: 'Users' },
          { id: 'payments', label: 'Payments' },
          { id: 'upi', label: 'UPI collections' },
          { id: 'webhooks', label: 'Webhooks' },
          { id: 'coupons', label: 'Coupons' },
          { id: 'plans', label: 'Plans' },
          { id: 'tickets', label: 'Tickets' },
          { id: 'announcements', label: 'Announcements' },
          { id: 'email', label: 'Email center' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'settings', label: 'Settings' },
          { id: 'audit', label: 'Audit log' },
          { id: 'dataset', label: 'Dataset' },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'overview' ? <Overview /> : null}
      {tab === 'users' ? <UsersPanel /> : null}
      {tab === 'payments' ? <PaymentsPanel /> : null}
      {tab === 'upi' ? <AdminUpiPanel /> : null}
      {tab === 'webhooks' ? <WebhooksPanel /> : null}
      {tab === 'coupons' ? <CouponsPanel /> : null}
      {tab === 'plans' ? <PlansPanel /> : null}
      {tab === 'tickets' ? <TicketsPanel /> : null}
      {tab === 'announcements' ? <AnnouncementsPanel /> : null}
      {tab === 'email' ? <EmailCenterPanel /> : null}
      {tab === 'integrations' ? <IntegrationsPanel /> : null}
      {tab === 'settings' ? <SettingsPanel /> : null}
      {tab === 'audit' ? <AuditPanel /> : null}
      {tab === 'dataset' ? <DatasetPanel /> : null}
    </div>
  );
}

function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get<AdminStats>('/admin/stats').then(setStats).catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!stats) return <Spinner />;

  const maxSignup = Math.max(1, ...stats.signups.map((s) => s.count));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total users" value={formatNumber(stats.users.total)} hint={`${stats.users.premium} premium · ${stats.users.verified} verified`} />
        <StatCard label={stats.revenue.mock ? 'Mock revenue' : 'Revenue'} value={formatMoneyMinor(stats.revenue.netMinor, stats.revenue.currency)} hint={stats.revenue.mock ? 'Simulated (no processor)' : 'Net of refunds'} tone="success" />
        <StatCard label="Active subscriptions" value={formatNumber(stats.subscriptions.active)} hint="Premium members" tone="brand" />
        <StatCard label="Attempts" value={formatNumber(stats.attempts.total)} hint={`${stats.attempts.completed} completed`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Catalogue</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-bold">{formatNumber(stats.catalog.providers)}</p><p className="text-xs text-content-muted">Providers</p></div>
            <div><p className="text-2xl font-bold">{formatNumber(stats.catalog.exams)}</p><p className="text-xs text-content-muted">Exams</p></div>
            <div><p className="text-2xl font-bold">{formatNumber(stats.catalog.totalQuestions)}</p><p className="text-xs text-content-muted">Questions</p></div>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Signups (14 days)</h2>
          <div className="flex h-32 items-end gap-1.5">
            {stats.signups.length === 0 ? <p className="text-sm text-content-muted">No signups yet.</p> : stats.signups.map((s) => (
              <div key={s.date} className="flex flex-1 flex-col items-center gap-1" title={`${s.date}: ${s.count}`}>
                <div className="w-full rounded-t bg-gradient-to-t from-brand-600 to-cyan-400" style={{ height: `${Math.max(6, (s.count / maxSignup) * 100)}%` }} />
                <span className="text-[9px] text-content-muted">{s.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<Paginated<User> | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    get<Paginated<User>>(`/admin/users?page=${page}&pageSize=20${query ? `&q=${encodeURIComponent(query)}` : ''}`)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [page, query]);

  useEffect(() => { load(); }, [load]);

  const update = async (id: string, body: Record<string, unknown>) => {
    try {
      await patch(`/admin/users/${id}`, body);
      toast('User updated', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <input className="input max-w-xs" placeholder="Search name or email…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
      </div>
      {!data ? <Spinner /> : (
        <TableScroll>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted">
              <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><p className="font-medium">{u.name}</p><p className="text-xs text-content-muted">{u.email}</p></td>
                  <td className="px-4 py-3">{u.premiumActive ? <span className="badge-premium">Premium</span> : <span className="badge">Free</span>}</td>
                  <td className="px-4 py-3 capitalize">{u.role}</td>
                  <td className="px-4 py-3">{u.suspended ? <span className="badge text-rose-500">Suspended</span> : <span className="badge text-emerald-500">Active</span>}</td>
                  <td className="px-4 py-3 text-content-muted">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => update(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? 'Demote' : 'Make admin'}</button>
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => update(u.id, { plan: u.plan === 'premium' ? 'free' : 'premium' })}>{u.plan === 'premium' ? 'Remove premium' : 'Grant premium'}</button>
                      <button className="btn-ghost !px-2 !py-1 text-xs text-rose-500" onClick={() => update(u.id, { suspended: !u.suspended })}>{u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {data ? (
        <div className="flex items-center justify-between">
          <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!data.pagination.hasPrev}>Previous</button>
          <span className="text-sm text-content-muted">Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} users</span>
          <button className="btn-secondary" onClick={() => setPage((p) => p + 1)} disabled={!data.pagination.hasNext}>Next</button>
        </div>
      ) : null}
    </div>
  );
}

function CouponsPanel() {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [form, setForm] = useState({ code: '', percentOff: 20, maxRedemptions: 0, description: '' });

  const load = () => get<{ coupons: Coupon[] }>('/admin/coupons').then((d) => setCoupons(d.coupons)).catch(() => setCoupons([]));
  useEffect(() => { void load(); }, []);

  const create = async () => {
    try {
      await post('/admin/coupons', { ...form, active: true });
      toast('Coupon created', 'success');
      setForm({ code: '', percentOff: 20, maxRedemptions: 0, description: '' });
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const deactivate = async (id: string) => {
    await del(`/admin/coupons/${id}`);
    await load();
    toast('Coupon deactivated', 'info');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="card grid gap-3 p-5 sm:grid-cols-4">
        <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SAVE20" /></div>
        <div><label className="label">% off</label><input type="number" className="input" value={form.percentOff} min={1} max={100} onChange={(e) => setForm({ ...form, percentOff: Number(e.target.value) })} /></div>
        <div><label className="label">Max uses (0 = ∞)</label><input type="number" className="input" value={form.maxRedemptions} min={0} onChange={(e) => setForm({ ...form, maxRedemptions: Number(e.target.value) })} /></div>
        <div className="flex items-end"><button className="btn-primary w-full" onClick={create} disabled={!form.code}>Create coupon</button></div>
      </div>
      {!coupons ? <Spinner /> : (
        <TableScroll>
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Off</th><th className="px-4 py-3">Used</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-surface-border">
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{coupon.code}</td>
                  <td className="px-4 py-3">{coupon.percentOff}%</td>
                  <td className="px-4 py-3">{coupon.redemptionCount}{coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}</td>
                  <td className="px-4 py-3">{coupon.active ? <span className="badge text-emerald-500">Active</span> : <span className="badge">Inactive</span>}</td>
                  <td className="px-4 py-3 text-right">{coupon.active ? <button onClick={() => deactivate(coupon.id)} className="btn-ghost text-xs text-rose-500">Deactivate</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

function PlansPanel() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [form, setForm] = useState({
    id: '',
    name: '',
    description: '',
    scope: 'single' as 'single' | 'all',
    durationDays: 30,
    earlyAccess: false,
    priceMinor: 50_000,
    sortOrder: 10,
  });

  const load = () => get<{ plans: Plan[] }>('/admin/plans').then((d) => setPlans(d.plans)).catch(() => setPlans([]));
  useEffect(() => { void load(); }, []);

  const create = async () => {
    try {
      await post('/admin/plans', { ...form, currency: 'INR', features: [], active: true });
      toast('Plan created', 'success');
      setForm({ id: '', name: '', description: '', scope: 'single', durationDays: 30, earlyAccess: false, priceMinor: 50_000, sortOrder: 10 });
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="card grid gap-3 p-5 sm:grid-cols-3">
        <div><label className="label">Plan id</label><input className="input" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="team-30" /></div>
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div>
          <label className="label">Scope</label>
          <select className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as 'single' | 'all' })}>
            <option value="single">Single exam</option>
            <option value="all">All exams</option>
          </select>
        </div>
        <div><label className="label">Duration (days)</label><input type="number" className="input" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} /></div>
        <div><label className="label">Price (₹)</label><input type="number" className="input" value={form.priceMinor / 100} onChange={(e) => setForm({ ...form, priceMinor: Math.round(Number(e.target.value) * 100) })} /></div>
        <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={form.earlyAccess} onChange={(e) => setForm({ ...form, earlyAccess: e.target.checked })} /> Early access</label>
        <div className="flex items-end"><button className="btn-primary w-full" onClick={create} disabled={!form.id || !form.name}>Create plan</button></div>
      </div>
      {!plans ? <Spinner /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <div key={plan.id} className="card p-4">
              <div className="flex items-center justify-between"><p className="font-semibold">{plan.name}</p><span className="badge">{plan.active ? 'active' : 'inactive'}</span></div>
              <p className="mt-1 text-xs text-content-muted">
                {plan.id} · {plan.scope === 'all' ? 'All exams' : 'Single exam'} · {plan.durationDays}d · {formatMoneyMinor(plan.priceMinor, plan.currency)}
                {plan.earlyAccess ? ' · early access' : ''}
              </p>
              <p className="mt-2 text-sm text-content-secondary">{plan.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    get<{ settings: Settings }>('/admin/settings').then((d) => setSettings(d.settings)).catch(() => undefined);
  }, []);

  const save = async () => {
    if (!settings) return;
    try {
      await patch('/admin/settings', settings);
      toast('Settings saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (!settings) return <Spinner />;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Free questions per exam" value={settings.freeQuestionsPerExam} onChange={(v) => setSettings({ ...settings, freeQuestionsPerExam: v })} />
        <NumberField label="Free mock exams / day" value={settings.freeMockExamsPerDay} onChange={(v) => setSettings({ ...settings, freeMockExamsPerDay: v })} />
        <NumberField label="Free random questions / day" value={settings.freeRandomQuestionsPerDay} onChange={(v) => setSettings({ ...settings, freeRandomQuestionsPerDay: v })} />
        <NumberField label="Premium daily question limit (0 = ∞)" value={settings.premiumDailyQuestionLimit} onChange={(v) => setSettings({ ...settings, premiumDailyQuestionLimit: v })} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.registrationsOpen} onChange={(e) => setSettings({ ...settings, registrationsOpen: e.target.checked })} /> Registrations open</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.maintenanceMode} onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })} /> Maintenance mode</label>
      <div><label className="label">Announcement banner</label><input className="input" value={settings.announcement} onChange={(e) => setSettings({ ...settings, announcement: e.target.value })} /></div>
      <button className="btn-primary self-start" onClick={save}>Save settings</button>
    </div>
  );
}

function AuditPanel() {
  const [data, setData] = useState<Paginated<AuditRow> | null>(null);
  useEffect(() => { get<Paginated<AuditRow>>('/admin/audit?pageSize=50').then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Spinner />;
  if (data.items.length === 0) return <EmptyState title="No audit events yet" />;
  return (
    <TableScroll>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted"><tr><th className="px-4 py-3">Action</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">When</th></tr></thead>
        <tbody className="divide-y divide-surface-border">
          {data.items.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 font-mono text-xs">{row.action}</td>
              <td className="px-4 py-3">{row.actorEmail ?? '—'}</td>
              <td className="px-4 py-3 text-content-muted">{row.targetType}:{row.targetId?.slice(-6) ?? '—'}</td>
              <td className="px-4 py-3 text-content-muted">{row.ip ?? '—'}</td>
              <td className="px-4 py-3 text-content-muted">{formatDate(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function DatasetPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ branch: string; owner: string; repo: string; providers: number; exams: number; lastSyncedAt: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = () => get<typeof status>('/admin/dataset/status').then(setStatus).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await post<{ result: { providers: number; exams: number; durationMs: number; errors: string[] } }>('/admin/dataset/sync');
      toast(`Synced ${result.result.providers} providers and ${result.result.exams} exams`, 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  if (!status) return <Spinner />;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2"><IconTrophy className="text-brand-400" /><h2 className="text-lg font-semibold">Exam dataset</h2></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
        <div><p className="text-2xl font-bold">{formatNumber(status.providers)}</p><p className="text-xs text-content-muted">Providers</p></div>
        <div><p className="text-2xl font-bold">{formatNumber(status.exams)}</p><p className="text-xs text-content-muted">Exams</p></div>
        <div><p className="text-2xl font-bold">{status.branch}</p><p className="text-xs text-content-muted">Branch</p></div>
        <div><p className="text-sm font-bold">{status.lastSyncedAt ? formatDate(status.lastSyncedAt) : 'Never'}</p><p className="text-xs text-content-muted">Last synced</p></div>
      </div>
      <p className="text-xs text-content-muted">Questions are fetched from GitHub at request time and never stored in the database. Only catalogue metadata is indexed in PostgreSQL.</p>
      <button className="btn-primary self-start" onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync catalogue now'}</button>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" className="input" value={value} min={0} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}