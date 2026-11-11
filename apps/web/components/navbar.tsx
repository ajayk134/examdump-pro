'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { Avatar } from '@/components/ui';
import {
  IconBook,
  IconChart,
  IconHome,
  IconLogout,
  IconMessage,
  IconMoon,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
  IconUser,
  IconX,
  IconMenu,
} from '@/components/icons';
import { cn } from '@/lib/format';
import { api } from '@/lib/api';

type NavItem = { href: string; label: string; icon: 'home' | 'search' | 'book' | 'spark' | 'chart' | 'star' };
type IconComp = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const ICONS: Record<NavItem['icon'], IconComp> = {
  home: IconHome,
  search: IconSearch,
  book: IconBook,
  spark: IconMessage,
  chart: IconChart,
  star: IconStar,
};

/** Primary destinations shared by the desktop bar and the mobile tab bar. */
const PRIMARY: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/exams', label: 'Exams', icon: 'search' },
  { href: '/practice', label: 'Practice', icon: 'book' },
  { href: '/ask', label: 'Ask AI', icon: 'spark' },
  { href: '/dashboard', label: 'Dashboard', icon: 'chart' },
];

/** Only four tabs fit comfortably on a phone; Dashboard lives in the sheet there. */
const MOBILE_TABS: NavItem[] = PRIMARY.filter((i) => i.href !== '/dashboard');

const SECONDARY = [
  { href: '/mock', label: 'Mock tests' },
  { href: '/bookmarks', label: 'Bookmarks' },
  { href: '/history', label: 'History' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/support', label: 'Support' },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  // Close the sheet whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.colorScheme = next ? 'dark' : 'light';
    try {
      localStorage.setItem('examdump-theme', next ? 'dark' : 'light');
    } catch {
      /* storage may be blocked; theme still applies for this session */
    }
  }

  async function signOut() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore network errors on logout */
    }
    await refresh();
    setMenuOpen(false);
    toast('Signed out', 'success');
    router.push('/');
  }

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      {/* ---------------- Top bar (all breakpoints) ---------------- */}
      <header
        className="sticky top-0 z-50 border-b border-surface-border/80 glass"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <nav className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-6" aria-label="Main">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2 lg:min-h-0" aria-label="ExamDump Pro home">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 text-sm font-black text-white shadow-glow sm:h-9 sm:w-9 sm:text-base">
              E
            </span>
            <span className="hidden text-[0.95rem] font-bold tracking-tight sm:block">
              ExamDump
              <span className="bg-gradient-to-r from-brand-500 to-sky-400 bg-clip-text text-transparent dark:from-brand-300 dark:to-sky-300">
                {' '}
                Pro
              </span>
            </span>
          </Link>

          {/* Desktop primary nav */}
          <div className="ml-2 hidden items-center gap-0.5 lg:flex">
            {PRIMARY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-2.5 py-2 text-[0.8125rem] font-semibold transition-colors',
                  isActive(item.href)
                    ? 'bg-surface-overlay text-content-primary'
                    : 'text-content-secondary hover:bg-surface-overlay/60 hover:text-content-primary',
                )}
              >
                {item.label}
              </Link>
            ))}
            {user?.role === 'admin' ? (
              <Link
                href="/admin"
                className={cn(
                  'rounded-lg px-2.5 py-2 text-[0.8125rem] font-semibold transition-colors',
                  isActive('/admin')
                    ? 'bg-surface-overlay text-content-primary'
                    : 'text-content-secondary hover:bg-surface-overlay/60 hover:text-content-primary',
                )}
              >
                Admin
              </Link>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="icon-btn"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {dark ? <IconSun /> : <IconMoon />}
            </button>

            {user ? (
              <Link
                href="/profile"
                className="hidden items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-surface-overlay sm:flex"
                aria-label="Your profile"
              >
                <Avatar name={user.name ?? user.email ?? 'You'} size={30} />
                <span className="max-w-[9rem] truncate text-[0.8125rem] font-semibold">
                  {user.name ?? user.email}
                </span>
              </Link>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Link href="/login" className="btn-ghost btn-sm">
                  Sign in
                </Link>
                <Link href="/register" className="btn-primary btn-sm">
                  Get started
                </Link>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="icon-btn lg:hidden"
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <IconMenu />
            </button>
          </div>
        </nav>
      </header>

      {/* ---------------- Mobile sheet menu ---------------- */}
      {menuOpen ? (
        <div className="fixed inset-0 z-[110] lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] animate-sheet overflow-y-auto rounded-t-3xl border-t border-surface-border bg-surface-raised"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-surface-border bg-surface-raised px-4 py-3">
              <span className="heading-3">Menu</span>
              <button type="button" onClick={() => setMenuOpen(false)} className="icon-btn" aria-label="Close menu">
                <IconX />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3">
              {[...PRIMARY, { href: '/mock', label: 'Mock tests', icon: 'book' as const }].map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border p-3 text-sm font-semibold transition-colors',
                      isActive(item.href)
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-surface-border bg-surface-overlay text-content-secondary',
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="px-3 pb-1">
              <p className="eyebrow mb-2 px-1">More</p>
              <div className="flex flex-col">
                {SECONDARY.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive(item.href) ? 'text-accent' : 'text-content-secondary hover:bg-surface-overlay',
                    )}
                  >
                    {item.label}
                    <span className="text-content-muted" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ))}
                {user?.role === 'admin' ? (
                  <Link href="/admin" className="rounded-lg px-3 py-2.5 text-sm font-medium text-content-secondary">
                    Admin console
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="border-t border-surface-border p-3">
              {user ? (
                <div className="flex flex-col gap-2">
                  <Link href="/profile" className="flex items-center gap-3 rounded-xl bg-surface-overlay p-3">
                    <Avatar name={user.name ?? user.email ?? 'You'} size={36} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{user.name ?? 'Your account'}</p>
                      <p className="truncate text-xs text-content-muted">{user.email}</p>
                    </div>
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href="/profile" className="btn-secondary btn-sm">
                      <IconUser /> Profile
                    </Link>
                    <Link href="/security" className="btn-secondary btn-sm">
                      <IconSettings /> Security
                    </Link>
                  </div>
                  <button type="button" onClick={signOut} className="btn-ghost btn-sm justify-start text-negative">
                    <IconLogout /> Sign out
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/login" className="btn-secondary">
                    Sign in
                  </Link>
                  <Link href="/register" className="btn-primary">
                    Get started
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------- Mobile bottom tab bar ---------------- */}
      <BottomNav pathname={pathname} />
    </>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-surface-border/80 glass lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="mx-auto flex h-[var(--bottom-nav-h)] max-w-md items-stretch">
        {MOBILE_TABS.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-full flex-col items-center justify-center gap-1 text-[0.625rem] font-semibold transition-colors',
                  active ? 'text-accent' : 'text-content-muted',
                )}
              >
                {active ? (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />
                ) : null}
                <Icon className="h-[22px] w-[22px]" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
