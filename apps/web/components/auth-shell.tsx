import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconChart, IconSparkles, IconTrophy } from '@/components/icons';

/**
 * Shared frame for every account page (sign in, sign up, password reset,
 * email verification, email preferences).
 *
 * Two columns on desktop: a quiet brand panel that sets expectation on the
 * left, and the form on the right. On phones it collapses to a single centred
 * column with a compact mark, so nothing is lost at 360 px.
 *
 * The public API — `title`, `subtitle`, `children`, `footer` — is unchanged.
 */
const HIGHLIGHTS = [
  {
    icon: IconSparkles,
    title: 'AI explanations',
    body: 'Understand why an answer is right, not just which option to pick.',
  },
  {
    icon: IconTrophy,
    title: 'Timed mock exams',
    body: 'Rehearse under real exam conditions with a countdown and review.',
  },
  {
    icon: IconChart,
    title: 'Progress analytics',
    body: 'Track accuracy over time and surface the topics holding you back.',
  },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl items-center gap-10 py-4 sm:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16 lg:py-12">
      {/* Decorative brand panel. Not interactive, so it never traps focus. */}
      <aside aria-hidden="true" className="hidden lg:block">
        <span className="inline-flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 text-lg font-black text-white">
            E
          </span>
          <span className="text-sm font-bold tracking-tight text-content-primary">ExamDump Pro</span>
        </span>

        <h2 className="display-2 mt-8 text-balance">
          Pass your next certification with{' '}
          <span className="bg-gradient-to-r from-brand-500 via-brand-400 to-sky-400 bg-clip-text text-transparent dark:from-brand-300 dark:via-sky-300 dark:to-brand-400">
            confidence
          </span>
        </h2>
        <p className="body-text mt-4 max-w-md text-pretty">
          Real exam questions, timed mock exams and an AI tutor that explains every answer.
        </p>

        <ul className="mt-9 flex flex-col gap-5">
          {HIGHLIGHTS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title} className="flex items-start gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Icon width={19} height={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-content-primary">{item.title}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-content-muted">{item.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="mx-auto w-full max-w-md min-w-0">
        <div className="mb-6 text-center">
          <Link
            href="/"
            aria-label="ExamDump Pro home"
            className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-sky-400 text-xl font-black text-white lg:hidden"
          >
            E
          </Link>
          <h1 className="heading-1 text-balance">{title}</h1>
          <p className="body-text mt-1.5 text-pretty">{subtitle}</p>
        </div>

        <div className="panel-lg p-5 sm:p-6">{children}</div>

        {footer ? <div className="mt-5 text-center text-sm text-content-secondary">{footer}</div> : null}
      </div>
    </div>
  );
}
