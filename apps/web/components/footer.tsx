'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './providers';
import { BrandMark, Wordmark } from './brand';

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
    <footer className="has-bottom-nav relative mt-20 overflow-hidden border-t border-surface-border/60">
      {/* Ambient brand glow across the top edge. */}
      <div
        aria-hidden="true"
        className="orb -top-28 left-1/2 h-72 w-[42rem] -translate-x-1/2 bg-gradient-to-r from-brand-500/30 via-accent-2/25 to-aqua-400/25"
      />

      <div className="relative mx-auto max-w-7xl px-4 pt-14 sm:px-6">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="max-w-md">
            <Link href="/" className="inline-flex items-center gap-3" aria-label="ExamDump Pro home">
              <BrandMark size={40} />
              <Wordmark className="text-xl" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-content-muted">
              Real practice questions, timed mock exams and an AI tutor that explains every answer — built for
              professionals preparing for certification.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/register" className="btn-primary btn-sm">
                Get started free
              </Link>
              <Link href="/exams" className="btn-secondary btn-sm">
                Browse exams
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:gap-x-16">
            <FooterColumn title="Product" links={PRODUCT} />
            <FooterColumn title="Account" links={ACCOUNT} signedIn={Boolean(user)} onSignOut={signOut} />
            <FooterColumn title="Legal" links={LEGAL} />
          </div>
        </div>

        {/* Oversized wordmark flourish — desktop only so it can never overflow. */}
        <p
          aria-hidden="true"
          className="mt-12 hidden select-none whitespace-nowrap bg-gradient-to-b from-content-primary/[0.10] to-transparent bg-clip-text font-display text-[8.5rem] font-bold leading-none tracking-[-0.05em] text-transparent lg:block"
        >
          ExamDump Pro
        </p>
      </div>

      <div className="relative mt-6 border-t border-surface-border/60">
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
      <p className="eyebrow">{title}</p>
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
