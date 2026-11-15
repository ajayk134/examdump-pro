'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './providers';

const PRODUCT = [
  { href: '/exams', label: 'Browse exams' },
  { href: '/practice', label: 'Practice' },
  { href: '/mock', label: 'Mock tests' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/leaderboard', label: 'Leaderboard' },
];

const ACCOUNT = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/ask', label: 'Ask AI' },
  { href: '/bookmarks', label: 'Bookmarks' },
  { href: '/referrals', label: 'Refer a friend' },
  { href: '/support', label: 'Support' },
];

const LEGAL = [
  { href: '/terms', label: 'Terms of service' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/security', label: 'Security' },
  { href: '/api/docs', label: 'API docs' },
];

export function Footer() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function signOut() {
    await logout();
    router.push('/');
    router.refresh();
  }

  return (
    <footer className="has-bottom-nav mt-16 border-t border-surface-border/70 bg-surface-base/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Link href="/" className="inline-flex items-center gap-2.5" aria-label="ExamDump Pro home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 text-base font-black text-white shadow-glow">
              E
            </span>
            <span className="text-base font-bold tracking-tight">
              ExamDump
              <span className="bg-gradient-to-r from-brand-500 to-sky-400 bg-clip-text text-transparent dark:from-brand-300 dark:to-sky-300">
                {' '}
                Pro
              </span>
            </span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-content-muted">
            Real practice questions, timed mock exams and an AI tutor that explains every answer — built for
            professionals preparing for certification.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/register" className="btn-primary btn-sm">
              Get started free
            </Link>
            <Link href="/exams" className="btn-secondary btn-sm">
              Browse exams
            </Link>
          </div>
        </div>

        <FooterColumn title="Product" links={PRODUCT} />
        <FooterColumn title="Account" links={ACCOUNT} signedIn={Boolean(user)} onSignOut={signOut} />
        <FooterColumn title="Legal" links={LEGAL} />
      </div>

      <div className="border-t border-surface-border/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-content-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} ExamDump Pro. All rights reserved.</p>
          <p className="sm:text-right">
            Exam names and trademarks belong to their respective owners. Study material is for educational use only.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  signedIn,
  onSignOut,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
  signedIn?: boolean;
  onSignOut?: () => void;
}) {
  return (
    <nav aria-label={title}>
      <p className="heading-3">{title}</p>
      <ul className="mt-4 flex flex-col gap-2.5 text-sm text-content-muted">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="link-quiet">
              {link.label}
            </Link>
          </li>
        ))}
        {/*
          Render the signed-out link only once we know there is no session.
          Before /auth/me resolves `user` is null, which is also what the server
          renders, so this cannot cause a hydration mismatch.
        */}
        {onSignOut ? (
          <li>
            {signedIn ? (
              <button type="button" onClick={onSignOut} className="link-quiet">
                Sign out
              </button>
            ) : (
              <Link href="/login" className="link-quiet">
                Sign in
              </Link>
            )}
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
