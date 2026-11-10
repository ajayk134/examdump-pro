'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, useTheme, useToast } from '@/components/providers';
import { apiBase, del, get, patch, post } from '@/lib/api';
import type { User } from '@/lib/types';
import { Alert, Avatar, PremiumBadge, Spinner, Tabs } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';

type Tab = 'profile' | 'preferences' | 'security' | 'data';

interface SessionRow {
  id: string;
  userAgent: string;
  ip: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export default function ProfilePage() {
  const { user, loading, refresh, logout } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('profile');

  if (loading) return <Spinner label="Loading profile…" />;
  if (!user) return <Alert tone="warning">Please <Link href="/login" className="link">sign in</Link> to manage your profile.</Alert>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex items-center gap-4">
        <Avatar name={user.name} src={user.avatarUrl} size={56} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
          <p className="text-sm text-content-muted">{user.email} {user.emailVerified ? '· verified' : '· unverified'}</p>
          <div className="mt-1 flex gap-2">
            {user.premiumActive ? <PremiumBadge /> : <span className="badge">Free plan</span>}
            {user.role === 'admin' ? <span className="badge">Admin</span> : null}
          </div>
        </div>
      </header>

      <Tabs
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'preferences', label: 'Preferences' },
          { id: 'security', label: 'Security' },
          { id: 'data', label: 'Data & account' },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'profile' ? <ProfileForm user={user} onSaved={refresh} /> : null}
      {tab === 'preferences' ? <PreferencesForm user={user} onSaved={refresh} theme={theme} setTheme={setTheme} /> : null}
      {tab === 'security' ? <SecurityPanel onLogout={logout} /> : null}
      {tab === 'data' ? <DataPanel onLogout={logout} router={router} /> : null}
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
    <div className="card flex flex-col gap-4 p-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <label htmlFor="name" className="label">Full name</label>
        <input id="name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="avatar" className="label">Avatar URL</label>
        <input id="avatar" className="input" value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} placeholder="https://…" />
      </div>
      <div>
        <label htmlFor="bio" className="label">Bio</label>
        <textarea id="bio" className="input min-h-20" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={500} />
      </div>
      <div>
        <label htmlFor="timezone" className="label">Timezone</label>
        <input id="timezone" className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Europe/London" />
      </div>
      <button onClick={save} className="btn-primary self-start" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      <p className="text-xs text-content-muted">Member since {formatDate(user.createdAt)}</p>
    </div>
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

  return (
    <div className="card flex flex-col gap-5 p-5">
      <div>
        <p className="label">Theme</p>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((option) => (
            <button
              key={option}
              onClick={() => { setTheme(option); void save({ ...prefs, theme: option }); }}
              className={theme === option ? 'btn-primary capitalize' : 'btn-secondary capitalize'}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Email notifications" description="Important account and subscription emails." checked={prefs.emailNotifications} onChange={(v) => save({ ...prefs, emailNotifications: v })} />
      <Toggle label="Product updates" description="Occasional news about new features." checked={prefs.productUpdates} onChange={(v) => save({ ...prefs, productUpdates: v })} />
      <Toggle label="Weekly progress report" description="A summary of your study progress each week." checked={prefs.weeklyReport} onChange={(v) => save({ ...prefs, weeklyReport: v })} />
      {saving ? <p className="text-xs text-content-muted">Saving…</p> : null}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-content-muted">{description}</span>
      </span>
      <input type="checkbox" className="mt-1 h-5 w-5 rounded border-surface-border" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
    await del(`/auth/sessions/${id}`);
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    toast('Session revoked', 'info');
  };

  const logoutAll = async () => {
    await post('/auth/logout-all');
    await onLogout();
    router.push('/login');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="card flex flex-col gap-4 p-5">
        <h2 className="text-lg font-semibold">Change password</h2>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label htmlFor="current" className="label">Current password</label>
          <input id="current" type="password" className="input" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
        </div>
        <div>
          <label htmlFor="new" className="label">New password</label>
          <input id="new" type="password" className="input" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
        </div>
        <button onClick={changePassword} className="btn-primary self-start" disabled={busy || !form.currentPassword || !form.newPassword}>{busy ? 'Updating…' : 'Update password'}</button>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active sessions</h2>
          <button onClick={logoutAll} className="btn-ghost text-sm text-rose-500">Sign out everywhere</button>
        </div>
        {!sessions ? <Spinner /> : (
          <ul className="divide-y divide-surface-border">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">{session.current ? 'This device' : session.userAgent?.slice(0, 60) || 'Unknown device'}</p>
                  <p className="text-xs text-content-muted">{session.ip} · last used {formatDateTime(session.lastUsedAt)}</p>
                </div>
                {!session.current ? <button onClick={() => revoke(session.id)} className="btn-ghost text-xs text-rose-500">Revoke</button> : <span className="badge">Current</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DataPanel({ onLogout, router }: { onLogout: () => Promise<void>; router: ReturnType<typeof useRouter> }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState('');

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
    try {
      await del('/users/me');
      await onLogout();
      toast('Your account has been deleted.', 'info');
      router.push('/');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <h2 className="text-lg font-semibold">Export your data</h2>
        <p className="mt-1 text-sm text-content-muted">Download your profile, attempts, bookmarks, notes and subscriptions as JSON.</p>
        <button onClick={exportData} className="btn-secondary mt-3">Download export</button>
      </div>
      <div className="card border-rose-400/40 p-5">
        <h2 className="text-lg font-semibold text-rose-500">Delete account</h2>
        <p className="mt-1 text-sm text-content-muted">This soft-deletes your account and signs you out. This action cannot be undone from the UI.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="input" placeholder='Type DELETE to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button onClick={deleteAccount} className="btn-danger">Delete account</button>
        </div>
      </div>
    </div>
  );
}