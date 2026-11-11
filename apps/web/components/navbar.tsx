'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useTheme, useToast } from './providers';
import { Avatar } from './ui';
import {
  IconBell,
  IconBook,
  IconChart,
  IconHistory,
  IconMenu,
  IconMessage,
  IconMoon,
  IconSettings,
  IconShield,
  IconSun,
  IconTrophy,
  IconUser,
  IconX,
} from './icons';
import { get, post } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { cn, relativeTime } from '@/lib/format';

const primaryNav = [
  { href: '/browse', label: 'Browse exams' },
  { href: '/ask', label: 'Ask AI' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/support', label: 'Support' },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setUserOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await get<{ items: Notification[]; unread: number }>('/notifications?limit=8');
        if (!cancelled) {
          setNotifications(data.items);
          setUnread(data.unread);
        }
      } catch {
        /* ignore */
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userRef.current && !userRef.current.contains(target)) setUserOpen(false);
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markRead = async () => {
    try {
      await post('/notifications/read', { all: true });
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      /* ignore */
    }
  };

  const handleLogout = async () => {
    await logout();
    toast('Signed out', 'success');
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-surface-border/70 bg-surface-base/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 text-lg text-white shadow-lg shadow-brand-500/25">E</span>
          <span className="hidden text-lg md:block">
            ExamDump <span className="bg-gradient-to-r from-brand-500 to-sky-400 bg-clip-text text-transparent dark:from-brand-300 dark:to-sky-300">Pro</span>
          </span>
        </Link>

        <div className="ml-2 hidden items-center gap-1 lg:flex">
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition',
                pathname.startsWith(item.href)
                  ? 'bg-surface-overlay text-content-primary'
                  : 'text-content-secondary hover:text-content-primary',
              )}
            >
              {item.label}
            </Link>
          ))}
          {user?.role === 'admin' ? (
            <Link
              href="/admin"
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition',
                pathname.startsWith('/admin')
                  ? 'bg-surface-overlay text-content-primary'
                  : 'text-content-secondary hover:text-content-primary',
              )}
            >
              Admin
            </Link>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={toggle}
            className="btn-ghost h-10 w-10 !px-0"
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
          >
            {resolved === 'dark' ? <IconSun /> : <IconMoon />}
          </button>

          {user ? (
            <>
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => setNotifOpen((v) => !v)}
                  className="btn-ghost relative h-10 w-10 !px-0"
                  aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                  aria-expanded={notifOpen}
                >
                  <IconBell />
                  {unread > 0 ? (
                    <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                </button>
                {notifOpen ? (
                  <div className="absolute right-0 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-surface-border bg-surface-raised shadow-2xl">
                    <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                      <p className="text-sm font-semibold">Notifications</p>
                      <button onClick={markRead} className="text-xs text-brand-400 hover:underline">
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="p-4 text-sm text-content-muted">You are all caught up.</p>
                      ) : (
                        notifications.map((n) => (
                          <Link
                            key={n.id}
                            href={n.link || '/dashboard'}
                            className={cn('block border-b border-surface-border/60 px-4 py-3 last:border-0 hover:bg-surface-overlay', !n.read && 'bg-brand-500/5')}
                          >
                            <p className="text-sm font-medium">{n.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-content-muted">{n.body}</p>
                            <p className="mt-1 text-[11px] text-content-muted">{relativeTime(n.createdAt)}</p>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative" ref={userRef}>
                <button
                  onClick={() => setUserOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-surface-overlay"
                  aria-label="Account menu"
                  aria-expanded={userOpen}
                >
                  <Avatar name={user.name} src={user.avatarUrl} size={34} />
                  <span className="hidden text-sm font-medium sm:block">{user.name.split(' ')[0]}</span>
                </button>
                {userOpen ? (
                  <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-surface-border bg-surface-raised shadow-2xl">
                    <div className="border-b border-surface-border px-4 py-3">
                      <p className="truncate text-sm font-semibold">{user.name}</p>
                      <p className="truncate text-xs text-content-muted">{user.email}</p>
                      {user.premiumActive ? <p className="mt-1 text-xs font-semibold text-amber-400">★ Premium member</p> : null}
                    </div>
                    <div className="p-1.5">
                      <MenuLink href="/dashboard" icon={<IconChart />} label="Dashboard" />
                      <MenuLink href="/ask" icon={<IconMessage />} label="Ask AI" />
                      <MenuLink href="/bookmarks" icon={<IconBook />} label="Bookmarks" />
                      <MenuLink href="/notes" icon={<IconBook />} label="Notes" />
                      <MenuLink href="/history" icon={<IconHistory />} label="History" />
                      <MenuLink href="/referrals" icon={<IconTrophy />} label="Referrals" />
                      <MenuLink href="/support" icon={<IconBook />} label="Support" />
                      <MenuLink href="/profile" icon={<IconSettings />} label="Settings" />
                      {user.role === 'admin' ? <MenuLink href="/admin" icon={<IconShield />} label="Admin panel" /> : null}
                    </div>
                    <div className="border-t border-surface-border p-1.5">
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
                      >
                        <IconX /> Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              {!loading ? (
                <>
                  <Link href="/login" className="btn-ghost">Sign in</Link>
                  <Link href="/register" className="btn-primary">Get started</Link>
                </>
              ) : null}
            </div>
          )}

          <button className="btn-ghost h-10 w-10 !px-0 lg:hidden" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu" aria-expanded={mobileOpen}>
            {mobileOpen ? <IconX /> : <IconMenu />}
          </button>
        </div>
      </nav>

      {mobileOpen ? (
        <div className="border-t border-surface-border bg-surface-raised px-4 py-3 lg:hidden">
          <div className="flex flex-col gap-1">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-surface-overlay',
                  pathname.startsWith(item.href)
                    ? 'bg-surface-overlay text-content-primary'
                    : 'text-content-secondary',
                )}
              >
                {item.label}
              </Link>
            ))}
            {user?.role === 'admin' ? <Link href="/admin" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-overlay">Admin</Link> : null}
            {!user ? (
              <div className="mt-2 flex gap-2">
                <Link href="/login" className="btn-secondary flex-1">Sign in</Link>
                <Link href="/register" className="btn-primary flex-1">Get started</Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content-secondary hover:bg-surface-overlay hover:text-content-primary">
      <span className="text-content-muted">{icon}</span>
      {label}
    </Link>
  );
}