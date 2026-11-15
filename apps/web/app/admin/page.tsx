'use client';

import { useCallback, useEffect, useId, useState, type ComponentType, type SVGProps } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { get, patch, post, del } from '@/lib/api';
import type { Paginated, Plan, User } from '@/lib/types';
import { Alert, EmptyIcon, EmptyState, PageShell, Spinner, StatStrip, TableScroll } from '@/components/ui';
import { cn, formatDate, formatMoneyMinor, formatNumber } from '@/lib/format';
import {
  IconBell,
  IconBook,
  IconChart,
  IconCheckCircle,
  IconGrid,
  IconHistory,
  IconMessage,
  IconRefresh,
  IconSend,
  IconSettings,
  IconShield,
  IconStar,
  IconTrophy,
  IconUser,
} from '@/components/icons';
import {
  AnnouncementsPanel,
  IntegrationsPanel,
  PaymentsPanel,
  TicketsPanel,
  Toolbar,
  WebhooksPanel,
} from '@/components/admin-ops';
import { EmailCenterPanel } from '@/components/admin-email';

type Tab =
  | 'overview'
  | 'users'
  | 'payments'
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

const TABS: Array<{ id: Tab; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { id: 'overview', label: 'Overview', icon: IconGrid },
  { id: 'users', label: 'Users', icon: IconUser },
  { id: 'payments', label: 'Payments', icon: IconChart },
  { id: 'webhooks', label: 'Webhooks', icon: IconRefresh },
  { id: 'coupons', label: 'Coupons', icon: IconStar },
  { id: 'plans', label: 'Plans', icon: IconTrophy },
  { id: 'tickets', label: 'Tickets', icon: IconMessage },
  { id: 'announcements', label: 'Announcements', icon: IconBell },
  { id: 'email', label: 'Email center', icon: IconSend },
  { id: 'integrations', label: 'Integrations', icon: IconCheckCircle },
  { id: 'settings', label: 'Settings', icon: IconSettings },
  { id: 'audit', label: 'Audit log', icon: IconHistory },
  { id: 'dataset', label: 'Dataset', icon: IconBook },
];

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
    return (
      <EmptyState
        title="Administrator access required"
        description="This area is restricted to platform administrators."
        icon={<IconShield width={36} height={36} />}
      />
    );
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <PageShell>
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
          <IconShield width={22} height={22} />
        </span>
        <div className="min-w-0">
          <p className="eyebrow mb-1">Operator</p>
          <h1 className="display-2 text-balance">Admin console</h1>
          <p className="body-text mt-1.5">Operate the platform, users and catalogue.</p>
        </div>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-6">
        {/* Section rail: vertical on desktop, a scrollable tab strip on phones. */}
        <nav
          aria-label="Admin sections"
          className="lg:sticky lg:top-20 lg:self-start lg:rounded-2xl lg:border lg:border-surface-border lg:bg-surface-raised lg:p-2 lg:shadow-xs"
        >
          <div
            role="tablist"
            aria-label="Admin sections"
            className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {TABS.map((item) => {
              const Icon = item.icon;
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  id={`admin-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="admin-panel"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors lg:w-full lg:justify-start',
                    selected
                      ? 'bg-accent/10 text-accent'
                      : 'text-content-secondary hover:bg-surface-overlay hover:text-content-primary',
                  )}
                >
                  <Icon width={17} height={17} className="shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div
          id="admin-panel"
          role="tabpanel"
          aria-labelledby={`admin-tab-${active.id}`}
          tabIndex={0}
          className="min-w-0 animate-rise"
        >
          {tab === 'overview' ? <Overview /> : null}
          {tab === 'users' ? <UsersPanel /> : null}
          {tab === 'payments' ? <PaymentsPanel /> : null}
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
      </div>
    </PageShell>
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
    <div className="flex flex-col gap-4">
      <div className="panel overflow-hidden p-0">
        <StatStrip
          items={[
            {
              label: 'Total users',
              value: formatNumber(stats.users.total),
              hint: `${stats.users.premium} premium · ${stats.users.verified} verified`,
            },
            {
              label: stats.revenue.mock ? 'Mock revenue' : 'Revenue',
              value: formatMoneyMinor(stats.revenue.netMinor, stats.revenue.currency),
              hint: stats.revenue.mock ? 'Simulated (no processor)' : 'Net of refunds',
              tone: 'success',
            },
            {
              label: 'Active subscriptions',
              value: formatNumber(stats.subscriptions.active),
              hint: 'Premium members',
              tone: 'brand',
            },
            {
              label: 'Attempts',
              value: formatNumber(stats.attempts.total),
              hint: `${stats.attempts.completed} completed`,
            },
          ]}
          columns={4}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5" aria-labelledby="catalogue-heading">
          <h2 id="catalogue-heading" className="heading-3 mb-3">
            Catalogue
          </h2>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="flex flex-col-reverse gap-1">
              <dt className="metric-label">Providers</dt>
              <dd className="metric-value">{formatNumber(stats.catalog.providers)}</dd>
            </div>
            <div className="flex flex-col-reverse gap-1">
              <dt className="metric-label">Exams</dt>
              <dd className="metric-value">{formatNumber(stats.catalog.exams)}</dd>
            </div>
            <div className="flex flex-col-reverse gap-1">
              <dt className="metric-label">Questions</dt>
              <dd className="metric-value">{formatNumber(stats.catalog.totalQuestions)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel p-5" aria-labelledby="signups-heading">
          <h2 id="signups-heading" className="heading-3 mb-3">
            Signups (14 days)
          </h2>
          <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Daily signups for the last 14 days">
            {stats.signups.length === 0 ? (
              <p className="text-sm text-content-muted">No signups yet.</p>
            ) : (
              stats.signups.map((s) => (
                <div
                  key={s.date}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${s.date}: ${s.count}`}
                >
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-brand-600 to-sky-400"
                    style={{ height: `${Math.max(6, (s.count / maxSignup) * 100)}%` }}
                  />
                  <span className="text-[9px] text-content-muted">{s.date.slice(5)}</span>
                </div>
              ))
            )}
          </div>
        </section>
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

  useEffect(() => {
    load();
  }, [load]);

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

      <Toolbar>
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="users-q">
            Search
          </label>
          <input
            id="users-q"
            className="input"
            placeholder="Search name or email..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Toolbar>

      {!data ? (
        <Spinner />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-medium text-content-primary">{u.name}</p>
                    <p className="text-xs text-content-muted">{u.email}</p>
                  </td>
                  <td>
                    {u.premiumActive ? (
                      <span className="badge badge-accent">Premium</span>
                    ) : (
                      <span className="badge">Free</span>
                    )}
                  </td>
                  <td className="capitalize">{u.role}</td>
                  <td>
                    {u.suspended ? (
                      <span className="badge badge-danger">Suspended</span>
                    ) : (
                      <span className="badge badge-success">Active</span>
                    )}
                  </td>
                  <td className="numeric whitespace-nowrap text-content-muted">{formatDate(u.createdAt)}</td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => update(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
                      >
                        {u.role === 'admin' ? 'Demote' : 'Make admin'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => update(u.id, { plan: u.plan === 'premium' ? 'free' : 'premium' })}
                      >
                        {u.plan === 'premium' ? 'Remove premium' : 'Grant premium'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-negative"
                        onClick={() => update(u.id, { suspended: !u.suspended })}
                      >
                        {u.suspended ? 'Unsuspend' : 'Suspend'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {data ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!data.pagination.hasPrev}
          >
            Previous
          </button>
          <span className="numeric text-sm text-content-muted">
            Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} users
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!data.pagination.hasNext}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CouponsPanel() {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [form, setForm] = useState({ code: '', percentOff: 20, maxRedemptions: 0, description: '' });

  const load = () =>
    get<{ coupons: Coupon[] }>('/admin/coupons')
      .then((d) => setCoupons(d.coupons))
      .catch(() => setCoupons([]));
  useEffect(() => {
    void load();
  }, []);

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
      <div className="panel grid gap-3 p-5 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="coupon-code">
            Code
          </label>
          <input
            id="coupon-code"
            className="input"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="SAVE20"
          />
        </div>
        <div>
          <label className="label" htmlFor="coupon-percent">
            % off
          </label>
          <input
            id="coupon-percent"
            type="number"
            className="input"
            value={form.percentOff}
            min={1}
            max={100}
            onChange={(e) => setForm({ ...form, percentOff: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label" htmlFor="coupon-max">
            Max uses (0 = ∞)
          </label>
          <input
            id="coupon-max"
            type="number"
            className="input"
            value={form.maxRedemptions}
            min={0}
            onChange={(e) => setForm({ ...form, maxRedemptions: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-end">
          <button type="button" className="btn-primary btn-block" onClick={create} disabled={!form.code}>
            Create coupon
          </button>
        </div>
      </div>

      {!coupons ? (
        <Spinner />
      ) : coupons.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon name="spark" />}
          title="No coupons"
          description="Create one to offer a discount at checkout."
        />
      ) : (
        <TableScroll>
          <table className="tbl min-w-[560px]">
            <thead>
              <tr>
                <th>Code</th>
                <th>Off</th>
                <th>Used</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td className="font-mono font-semibold text-content-primary">{coupon.code}</td>
                  <td className="numeric">{coupon.percentOff}%</td>
                  <td className="numeric">
                    {coupon.redemptionCount}
                    {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}
                  </td>
                  <td>
                    {coupon.active ? (
                      <span className="badge badge-success">Active</span>
                    ) : (
                      <span className="badge">Inactive</span>
                    )}
                  </td>
                  <td className="text-right">
                    {coupon.active ? (
                      <button
                        type="button"
                        onClick={() => deactivate(coupon.id)}
                        className="btn-ghost btn-sm text-negative"
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
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

  const load = () =>
    get<{ plans: Plan[] }>('/admin/plans')
      .then((d) => setPlans(d.plans))
      .catch(() => setPlans([]));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    try {
      await post('/admin/plans', { ...form, currency: 'INR', features: [], active: true });
      toast('Plan created', 'success');
      setForm({
        id: '',
        name: '',
        description: '',
        scope: 'single',
        durationDays: 30,
        earlyAccess: false,
        priceMinor: 50_000,
        sortOrder: 10,
      });
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel grid gap-3 p-5 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="plan-id">
            Plan id
          </label>
          <input
            id="plan-id"
            className="input"
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="team-30"
          />
        </div>
        <div>
          <label className="label" htmlFor="plan-name">
            Name
          </label>
          <input
            id="plan-name"
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="plan-scope">
            Scope
          </label>
          <select
            id="plan-scope"
            className="select"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value as 'single' | 'all' })}
          >
            <option value="single">Single exam</option>
            <option value="all">All exams</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="plan-duration">
            Duration (days)
          </label>
          <input
            id="plan-duration"
            type="number"
            className="input"
            value={form.durationDays}
            onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label" htmlFor="plan-price">
            Price (₹)
          </label>
          <input
            id="plan-price"
            type="number"
            className="input"
            value={form.priceMinor / 100}
            onChange={(e) => setForm({ ...form, priceMinor: Math.round(Number(e.target.value) * 100) })}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-content-secondary">
          <input
            type="checkbox"
            checked={form.earlyAccess}
            onChange={(e) => setForm({ ...form, earlyAccess: e.target.checked })}
          />
          Early access
        </label>
        <div className="flex items-end sm:col-span-3">
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={create}
            disabled={!form.id || !form.name}
          >
            Create plan
          </button>
        </div>
      </div>

      {!plans ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <div key={plan.id} className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-content-primary">{plan.name}</p>
                <span className={plan.active ? 'badge badge-success' : 'badge'}>
                  {plan.active ? 'active' : 'inactive'}
                </span>
              </div>
              <p className="numeric mt-1 text-xs text-content-muted">
                {plan.id} · {plan.scope === 'all' ? 'All exams' : 'Single exam'} · {plan.durationDays}d ·{' '}
                {formatMoneyMinor(plan.priceMinor, plan.currency)}
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
    get<{ settings: Settings }>('/admin/settings')
      .then((d) => setSettings(d.settings))
      .catch(() => undefined);
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
    <div className="panel flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="Free questions per exam"
          value={settings.freeQuestionsPerExam}
          onChange={(v) => setSettings({ ...settings, freeQuestionsPerExam: v })}
        />
        <NumberField
          label="Free mock exams / day"
          value={settings.freeMockExamsPerDay}
          onChange={(v) => setSettings({ ...settings, freeMockExamsPerDay: v })}
        />
        <NumberField
          label="Free random questions / day"
          value={settings.freeRandomQuestionsPerDay}
          onChange={(v) => setSettings({ ...settings, freeRandomQuestionsPerDay: v })}
        />
        <NumberField
          label="Premium daily question limit (0 = ∞)"
          value={settings.premiumDailyQuestionLimit}
          onChange={(v) => setSettings({ ...settings, premiumDailyQuestionLimit: v })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-content-secondary">
        <input
          type="checkbox"
          checked={settings.registrationsOpen}
          onChange={(e) => setSettings({ ...settings, registrationsOpen: e.target.checked })}
        />
        Registrations open
      </label>
      <label className="flex items-center gap-2 text-sm text-content-secondary">
        <input
          type="checkbox"
          checked={settings.maintenanceMode}
          onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
        />
        Maintenance mode
      </label>
      <div>
        <label className="label" htmlFor="settings-announcement">
          Announcement banner
        </label>
        <input
          id="settings-announcement"
          className="input"
          value={settings.announcement}
          onChange={(e) => setSettings({ ...settings, announcement: e.target.value })}
        />
      </div>
      <button type="button" className="btn-primary self-start" onClick={save}>
        Save settings
      </button>
    </div>
  );
}

function AuditPanel() {
  const [data, setData] = useState<Paginated<AuditRow> | null>(null);
  useEffect(() => {
    get<Paginated<AuditRow>>('/admin/audit?pageSize=50')
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return <Spinner />;
  if (data.items.length === 0) return <EmptyState title="No audit events yet" />;
  return (
    <TableScroll>
      <table className="tbl min-w-[640px]">
        <thead>
          <tr>
            <th>Action</th>
            <th>Actor</th>
            <th>Target</th>
            <th>IP</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.id}>
              <td className="font-mono text-xs text-content-primary">{row.action}</td>
              <td className="text-content-secondary">{row.actorEmail ?? '—'}</td>
              <td className="text-content-muted">
                {row.targetType}:{row.targetId?.slice(-6) ?? '—'}
              </td>
              <td className="numeric text-content-muted">{row.ip ?? '—'}</td>
              <td className="numeric whitespace-nowrap text-content-muted">{formatDate(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function DatasetPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{
    branch: string;
    owner: string;
    repo: string;
    providers: number;
    exams: number;
    lastSyncedAt: string | null;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = () =>
    get<typeof status>('/admin/dataset/status')
      .then(setStatus)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await post<{ result: { providers: number; exams: number; durationMs: number; errors: string[] } }>(
        '/admin/dataset/sync',
      );
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
    <div className="panel flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <IconTrophy className="text-accent" width={20} height={20} />
        <h2 className="heading-3">Exam dataset</h2>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <div className="flex flex-col-reverse gap-1">
          <dt className="metric-label">Providers</dt>
          <dd className="metric-value">{formatNumber(status.providers)}</dd>
        </div>
        <div className="flex flex-col-reverse gap-1">
          <dt className="metric-label">Exams</dt>
          <dd className="metric-value">{formatNumber(status.exams)}</dd>
        </div>
        <div className="flex flex-col-reverse gap-1">
          <dt className="metric-label">Branch</dt>
          <dd className="text-lg font-bold text-content-primary">{status.branch}</dd>
        </div>
        <div className="flex flex-col-reverse gap-1">
          <dt className="metric-label">Last synced</dt>
          <dd className="text-sm font-bold text-content-primary">
            {status.lastSyncedAt ? formatDate(status.lastSyncedAt) : 'Never'}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-content-muted">
        Questions are fetched from GitHub at request time and never stored in the database. Only catalogue
        metadata is indexed in PostgreSQL.
      </p>
      <button type="button" className="btn-primary self-start" onClick={sync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Sync catalogue now'}
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="input"
        value={value}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
