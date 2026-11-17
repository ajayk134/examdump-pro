'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, useTheme, useToast } from '@/components/providers';
import { apiBase, del, get, patch, post } from '@/lib/api';
import type { Entitlements, Invoice, Payment, Plan, Subscription, User } from '@/lib/types';
import { Alert, Avatar, PremiumBadge, Spinner, Tabs } from '@/components/ui';
import { IconAlertCircle, IconMoon, IconSettings, IconShield, IconStar, IconSun, IconUser } from '@/components/icons';
import { cn, formatDate, formatDateTime, formatMoneyMinor } from '@/lib/format';

type Tab = 'profile' | 'billing' | 'preferences' | 'security' | 'data';

interface SessionRow {
  id: string;
  userAgent: string;
  ip: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

/** The settings sections, shared by the desktop sub-nav and the mobile tab bar. */
const SECTIONS: Array<{ id: Tab; label: string; icon: typeof IconSun }> = [
  { id: 'profile', label: 'Profile', icon: IconUser },
  { id: 'billing', label: 'Billing', icon: IconStar },
  { id: 'preferences', label: 'Preferences', icon: IconSettings },
  { id: 'security', label: 'Security', icon: IconShield },
  { id: 'data', label: 'Data & account', icon: IconAlertCircle },
];

/** Titled region inside a settings panel. Keeps every section self-describing. */
function SectionHeading({ id, title, description }: { id?: string; title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="heading-2">
        {title}
      </h2>
      {description ? <p className="caption mt-1">{description}</p> : null}
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading, refresh, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('profile');

  if (loading) return <Spinner label="Loading profile..." />;
  if (!user) return <Alert tone="warning">Please <Link href="/login" className="link">sign in</Link> to manage your profile.</Alert>;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="panel-lg relative isolate flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center">
        <div aria-hidden="true" className="orb -z-10 -right-16 -top-20 h-44 w-44 bg-accent/20" />
        <Avatar name={user.name} src={user.avatarUrl} size={64} />
        <div className="relative min-w-0 flex-1">
          <h1 className="heading-1 truncate">{user.name}</h1>
          <p className="caption mt-1 truncate">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {user.premiumActive ? <PremiumBadge /> : <span className="badge">Free plan</span>}
            <span className={user.emailVerified ? 'badge badge-success' : 'badge badge-warning'}>
              {user.emailVerified ? 'Email verified' : 'Email unverified'}
            </span>
            {user.role === 'admin' ? <span className="badge">Admin</span> : null}
          </div>
        </div>
        <p className="caption relative sm:shrink-0 sm:text-right">Member since {formatDate(user.createdAt)}</p>
      </header>

      {/* Phones: a sticky, swipeable tab bar. */}
      <Tabs
        className="sticky top-14 z-30 lg:hidden sm:top-16"
        tabs={SECTIONS.map(({ id, label }) => ({ id, label }))}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* Desktop: a sticky settings sub-nav rather than another card grid. */}
        <aside className="sticky top-20 hidden lg:block">
          <nav aria-label="Settings sections" className="panel p-2">
            <ul className="flex flex-col gap-1">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const active = tab === section.id;
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setTab(section.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[1rem] px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                        active
                          ? 'bg-accent/10 text-accent'
                          : 'text-content-secondary hover:bg-surface-overlay hover:text-content-primary',
                      )}
                    >
                      <Icon width={17} height={17} aria-hidden="true" />
                      {section.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0">
          {tab === 'profile' ? <ProfileForm user={user} onSaved={refresh} /> : null}
          {tab === 'billing' ? <BillingPanel /> : null}
          {tab === 'preferences' ? <PreferencesForm user={user} onSaved={refresh} theme={theme} setTheme={setTheme} /> : null}
          {tab === 'security' ? <SecurityPanel onLogout={logout} /> : null}
          {tab === 'data' ? <DataPanel onLogout={logout} router={router} /> : null}
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ user, onSaved }: { user: User; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: user.name, bio: user.bio, avatarUrl: user.avatarUrl, timezone: user.timezone });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await patch('/users/me', form);
      await onSaved();
      toast('Profile updated', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="panel flex flex-col gap-5 p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <SectionHeading title="Identity" description="How your name appears on the leaderboard and in your account." />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="label">Full name</label>
            <input id="name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="avatar" className="label">Avatar URL</label>
            <input id="avatar" className="input" value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} placeholder="https://..." inputMode="url" />
          </div>
          <div>
            <label htmlFor="bio" className="label">Bio</label>
            <textarea id="bio" className="input min-h-24" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={500} />
            <p className="caption mt-1.5 numeric">{form.bio.length}/500</p>
          </div>
        </div>
      </div>

      <div className="hairline" role="presentation" />

      <div>
        <SectionHeading title="Locale" description="Used for study streaks and dated activity." />
        <label htmlFor="timezone" className="label">Timezone</label>
        <input id="timezone" className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Europe/London" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <p className="caption">Changes apply to your account immediately.</p>
      </div>
    </form>
  );
}

function PreferencesForm({
  user,
  onSaved,
  theme,
  setTheme,
}: {
  user: User;
  onSaved: () => Promise<void>;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
}) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState(user.preferences);
  const [saving, setSaving] = useState(false);

  const save = async (next: typeof prefs) => {
    setPrefs(next);
    setSaving(true);
    try {
      await patch('/users/me/preferences', next);
      await onSaved();
      toast('Preferences saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const themes: Array<{ id: 'light' | 'dark' | 'system'; label: string; icon: typeof IconSun }> = [
    { id: 'light', label: 'Light', icon: IconSun },
    { id: 'dark', label: 'Dark', icon: IconMoon },
    { id: 'system', label: 'System', icon: IconSettings },
  ];

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="appearance-heading" className="panel p-4 sm:p-5">
        <SectionHeading
          id="appearance-heading"
          title="Appearance"
          description="Follows your device by default, and applies immediately."
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
          {themes.map((option) => {
            const Icon = option.icon;
            const active = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTheme(option.id);
                  void save({ ...prefs, theme: option.id });
                }}
                className={active ? 'btn-primary' : 'btn-secondary'}
              >
                <Icon width={16} height={16} aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="notifications-heading" className="panel p-4 sm:p-5">
        <SectionHeading
          id="notifications-heading"
          title="Notifications"
          description="Everything here is optional, and changes are saved as you tap."
        />
        <div className="flex flex-col gap-4">
          <Toggle label="Email notifications" description="Important account and subscription emails." checked={prefs.emailNotifications} onChange={(v) => void save({ ...prefs, emailNotifications: v })} />
          <Toggle label="Product updates" description="Occasional news about new features." checked={prefs.productUpdates} onChange={(v) => void save({ ...prefs, productUpdates: v })} />
          <Toggle label="Weekly progress report" description="A summary of your study progress each week." checked={prefs.weeklyReport} onChange={(v) => void save({ ...prefs, weeklyReport: v })} />
        </div>
        {saving ? (
          <p className="caption mt-3" role="status" aria-live="polite">
            Saving...
          </p>
        ) : null}
      </section>

      <EmailPreferenceToggles />
    </div>
  );
}

/**
 * Email consent controls.
 *
 * Separate from the general toggles above because this feed is auditable: the
 * API records when consent was granted, and essential mail is shown as locked
 * so nobody expects a password reset to stop arriving after opting out.
 */
function EmailPreferenceToggles() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<{
    marketingOptIn: boolean;
    productUpdates: boolean;
    subscriptionReminders: boolean;
    weeklyReport: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<{ preferences: typeof prefs }>('/email/preferences')
      .then((res) => setPrefs(res.preferences))
      .catch(() => setPrefs(null));
  }, []);

  async function update(changes: Partial<NonNullable<typeof prefs>>) {
    if (!prefs) return;
    setPrefs({ ...prefs, ...changes });
    setSaving(true);
    try {
      await patch('/email/preferences', changes);
      toast('Email preferences saved', 'success');
    } catch (err) {
      toast('Could not save: ' + (err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return null;

  return (
    <section aria-labelledby="email-prefs-heading" className="panel-sunken p-4 sm:p-5">
      <SectionHeading
        id="email-prefs-heading"
        title="Email preferences"
        description="Choose which optional email you receive. Security and account email is always sent."
      />
      <div className="flex flex-col gap-4">
        <Toggle
          label="Announcements and offers"
          description="Product announcements, promotions and occasional offers."
          checked={prefs.marketingOptIn}
          onChange={(v) => void update({ marketingOptIn: v })}
        />
        <Toggle
          label="Product updates"
          description="News about new features and exams."
          checked={prefs.productUpdates}
          onChange={(v) => void update({ productUpdates: v })}
        />
        <Toggle
          label="Subscription reminders"
          description="Renewal reminders before your plan expires."
          checked={prefs.subscriptionReminders}
          onChange={(v) => void update({ subscriptionReminders: v })}
        />
        <Toggle
          label="Weekly progress summary"
          description="A summary of your study progress each week."
          checked={prefs.weeklyReport}
          onChange={(v) => void update({ weeklyReport: v })}
        />
      </div>
      <p className="caption mt-4">
        Verification links, password resets, security alerts and payment receipts are always sent because they are part
        of your account.
      </p>
      {saving ? (
        <p className="caption mt-3" role="status" aria-live="polite">
          Saving...
        </p>
      ) : null}
    </section>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl px-1 py-1 transition-colors hover:bg-surface-overlay/60 focus-within:ring-2 focus-within:ring-accent/60">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-content-primary">{label}</span>
        <span className="caption mt-0.5 block">{description}</span>
      </span>
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-surface-border-strong [accent-color:rgb(var(--accent))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function SecurityPanel({ onLogout }: { onLogout: () => Promise<void> }) {
  const { toast } = useToast();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ sessions: SessionRow[] }>('/auth/sessions').then((data) => setSessions(data.sessions)).catch(() => setSessions([]));
  }, []);

  const changePassword = async () => {
    setBusy(true);
    setError('');
    try {
      await post('/auth/change-password', form);
      toast('Password changed. Please sign in again.', 'success');
      await onLogout();
      router.push('/login');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await del(`/auth/sessions/${id}`);
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      toast('Session revoked', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const logoutAll = async () => {
    try {
      await post('/auth/logout-all');
      await onLogout();
      router.push('/login');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        className="panel flex flex-col gap-4 p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void changePassword();
        }}
      >
        <SectionHeading
          title="Password"
          description="You will be signed out of this device and asked to sign in again."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label htmlFor="current" className="label">Current password</label>
          <input id="current" type="password" className="input" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
        </div>
        <div>
          <label htmlFor="new" className="label">New password</label>
          <input id="new" type="password" className="input" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={busy || !form.currentPassword || !form.newPassword}>
          {busy ? 'Updating...' : 'Update password'}
        </button>
      </form>

      <section aria-labelledby="sessions-heading" className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            id="sessions-heading"
            title="Active sessions"
            description="Devices currently signed in to your account."
          />
          <button type="button" onClick={() => void logoutAll()} className="btn-ghost btn-sm text-negative">
            Sign out everywhere
          </button>
        </div>

        {!sessions ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-content-muted">No other sessions are signed in.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {session.current ? 'This device' : session.userAgent?.slice(0, 60) || 'Unknown device'}
                  </p>
                  <p className="caption mt-0.5">{[session.ip, `last used ${formatDateTime(session.lastUsedAt)}`].filter(Boolean).join(' · ')}</p>
                </div>
                {session.current ? (
                  <span className="badge badge-accent shrink-0">Current</span>
                ) : (
                  <button type="button" onClick={() => void revoke(session.id)} className="btn-ghost btn-sm shrink-0 text-negative">
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DataPanel({ onLogout, router }: { onLogout: () => Promise<void>; router: ReturnType<typeof useRouter> }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    try {
      const response = await fetch(`${apiBase()}/users/me/export`, { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'examdump-pro-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const deleteAccount = async () => {
    if (confirm !== 'DELETE') {
      toast('Type DELETE to confirm', 'error');
      return;
    }
    setBusy(true);
    try {
      await del('/users/me');
      await onLogout();
      toast('Your account has been deleted.', 'info');
      router.push('/');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="export-heading" className="panel p-4 sm:p-5">
        <SectionHeading
          id="export-heading"
          title="Export your data"
          description="Download your profile, attempts, bookmarks, notes and subscriptions as JSON."
        />
        <button type="button" onClick={() => void exportData()} className="btn-secondary">
          Download export
        </button>
      </section>

      <section aria-labelledby="danger-heading" className="panel border-negative/40 p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-negative/10 text-negative">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z" />
              <path d="M12 8.5v4M12 15.7v.1" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="danger-heading" className="heading-2 text-negative">
              Danger zone
            </h2>
            <p className="caption mt-1">
              This soft-deletes your account and signs you out. It cannot be undone from the interface.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="delete-confirm" className="label">
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirm"
              className="input"
              placeholder="DELETE"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </div>
          <button type="button" onClick={() => void deleteAccount()} className="btn-danger" disabled={busy || confirm !== 'DELETE'}>
            {busy ? 'Deleting...' : 'Delete account'}
          </button>
        </div>
      </section>
    </div>
  );
}

interface BillingMe {
  subscription: Subscription | null;
  subscriptions: Subscription[];
  payments: Payment[];
  invoices: Invoice[];
  entitlements: Entitlements;
  paymentsEnabled: boolean;
}

function BillingPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<BillingMe | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [me, planList] = await Promise.all([
      get<BillingMe>('/subscriptions/me'),
      get<{ plans: Plan[] }>('/subscriptions/plans'),
    ]);
    setData(me);
    setPlans(planList.plans);
  };

  useEffect(() => {
    void load().catch((err) => toast((err as Error).message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = async (subscriptionId: string) => {
    setBusy(subscriptionId);
    try {
      await post(`/subscriptions/${subscriptionId}/cancel`, {});
      toast('Your pass will end at the current period.', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const resume = async (subscriptionId: string) => {
    setBusy(subscriptionId);
    try {
      await post(`/subscriptions/${subscriptionId}/resume`, {});
      toast('Renewal restored.', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Spinner label="Loading billing..." />;

  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="access-heading" className="panel p-4 sm:p-5">
        <SectionHeading id="access-heading" title="Current access" />
        {data.entitlements.plan === 'premium' ? (
          <p className="text-sm text-content-secondary">
            {data.entitlements.scope === 'all'
              ? 'All exams unlocked'
              : data.entitlements.scope === 'multi'
                ? `Unlocked exams: ${data.entitlements.examKeys.join(', ')}`
                : `Unlocked exam: ${data.entitlements.examKeys[0] ?? '—'}`}
            {data.entitlements.expiresAt ? ` · until ${formatDate(data.entitlements.expiresAt)}` : ''}
          </p>
        ) : (
          <p className="text-sm text-content-secondary">
            You are on the free tier. <Link href="/pricing" className="link">See passes</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="subscriptions-heading" className="flex flex-col gap-3">
        <h2 id="subscriptions-heading" className="heading-2">
          Subscriptions
        </h2>
        {data.subscriptions.length === 0 ? (
          <p className="text-sm text-content-muted">No subscriptions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{planName(s.planId)}</p>
                  <p className="caption mt-0.5">
                    <span className="capitalize">{s.status}</span> · {s.cancelAtPeriodEnd ? 'ends' : 'renews'}{' '}
                    {formatDate(s.currentPeriodEnd)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {s.status === 'active' && !s.cancelAtPeriodEnd ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy === s.id}
                      onClick={() => void cancel(s.id)}
                    >
                      {busy === s.id ? 'Working...' : 'Cancel at period end'}
                    </button>
                  ) : null}
                  {s.status === 'active' && s.cancelAtPeriodEnd ? (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={busy === s.id}
                      onClick={() => void resume(s.id)}
                    >
                      Resume
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="invoices-heading" id="invoices" className="flex flex-col gap-3 scroll-mt-24">
        <h2 id="invoices-heading" className="heading-2">
          Invoices
        </h2>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-content-muted">No invoices yet.</p>
        ) : (
          <ul className="panel divide-y divide-surface-border overflow-hidden p-0">
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                <Link href={`/invoices/${inv.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-overlay">
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-content-muted">{inv.number}</span>
                    <span className="ml-2 font-medium">{inv.planName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-content-secondary">{formatDate(inv.issuedAt)}</span>
                    <span className="numeric font-medium">{formatMoneyMinor(inv.totalMinor, inv.currency)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
        <h2 id="payments-heading" className="heading-2">
          Payments
        </h2>
        {data.payments.length === 0 ? (
          <p className="text-sm text-content-muted">No payments recorded.</p>
        ) : (
          <ul className="panel divide-y divide-surface-border overflow-hidden p-0">
            {data.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-xs text-content-muted">{p.providerRef}</span>
                  <span className="ml-2">{p.description || 'Subscription'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="badge capitalize">{p.status}</span>
                  <span className="numeric font-medium">{formatMoneyMinor(p.amountMinor - p.refundedMinor, p.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="caption">
        Need a refund or an invoice correction?{' '}
        <Link href="/support" className="link">
          Open a support ticket
        </Link>{' '}
        with your payment reference.
      </p>
    </div>
  );
}
