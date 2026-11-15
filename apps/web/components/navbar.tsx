'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useTheme, useToast } from '@/components/providers';
import { Avatar, Drawer } from '@/components/ui';
import {
  IconBook,
  IconBookmark,
  IconChart,
  IconHistory,
  IconHome,
  IconLogout,
  IconMenu,
  IconMessage,
  IconMoon,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
  IconUser,
  IconX,
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
  const { resolved, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
  const dark = resolved === 'dark';

  return (
    <>
      {/* ---------------- Top bar (all breakpoints) ---------------- */}
      <header
        className="sticky top-0 z-50 border-b border-surface-border/80 glass"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <nav className="mx-auto flex h-14 w-full max-w-7xl items-center gap-1.5 px-3 sm:h-16 sm:gap-3 sm:px-6" aria-label="Main">
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
                  'relative rounded-lg px-2.5 py-2 text-[0.8125rem] font-semibold transition-colors',
                  isActive(item.href)
                    ? 'bg-surface-overlay text-content-primary'
                    : 'text-content-secondary hover:bg-surface-overlay/60 hover:text-content-primary',
                )}
              >
                {item.label}
                {isActive(item.href) ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2.5 -bottom-[0.6rem] h-0.5 rounded-full bg-accent sm:-bottom-[0.85rem]"
                  />
                ) : null}
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
              onClick={toggle}
              className="icon-btn"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-pressed={dark}
            >
              {dark ? <IconSun /> : <IconMoon />}
            </button>

            {user ? (
              <AccountMenu user={user} onSignOut={signOut} />
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
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="bottom" className="lg:hidden">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-border bg-surface-raised px-4 py-3">
          <span className="heading-3">Menu</span>
          <button type="button" onClick={() => setMenuOpen(false)} className="icon-btn" aria-label="Close menu">
            <IconX />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
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
      </Drawer>

      {/* ---------------- Mobile bottom tab bar ---------------- */}
      <BottomNav pathname={pathname} />
    </>
  );
}

/** Desktop account dropdown. Hidden on phones (the sheet covers it there). */
function AccountMenu({
  user,
  onSignOut,
}: {
  user: { name: string | null; email: string | null; role?: string };
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = [
    { href: '/dashboard', label: 'Dashboard', icon: IconChart },
    { href: '/bookmarks', label: 'Bookmarks', icon: IconBookmark },
    { href: '/history', label: 'History', icon: IconHistory },
    { href: '/referrals', label: 'Refer a friend', icon: IconStar },
    { href: '/profile', label: 'Settings', icon: IconSettings },
  ];

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-surface-overlay"
      >
        <Avatar name={user.name ?? user.email ?? 'You'} size={30} />
        <span className="max-w-[9rem] truncate text-[0.8125rem] font-semibold">{user.name ?? user.email}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 animate-pop overflow-hidden rounded-xl border border-surface-border bg-surface-raised p-1.5 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.name ?? 'Your account'}</p>
            <p className="truncate text-xs text-content-muted">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-surface-border" />
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary"
              >
                <Icon width={16} height={16} />
                {item.label}
              </Link>
            );
          })}
          {user.role === 'admin' ? (
            <Link
              href="/admin"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary"
            >
              <IconSettings width={16} height={16} />
              Admin console
            </Link>
          ) : null}
          <div className="my-1 h-px bg-surface-border" />
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-negative transition-colors hover:bg-negative/10"
          >
            <IconLogout width={16} height={16} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
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
                  'relative flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold transition-colors',
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
