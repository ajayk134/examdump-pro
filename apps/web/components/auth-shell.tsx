import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark, Wordmark } from '@/components/brand';
import { IconChart, IconSparkles, IconTrophy } from '@/components/icons';

/**
 * Shared frame for every account page (sign in, sign up, password reset,
 * email verification, email preferences).
 *
 * A premium split shell: on desktop a full-height branded panel — mesh
 * gradient, mark, wordmark and the product's value line — sits beside the
 * form. On phones the panel is dropped (it is decorative) and the page
 * collapses to a single centred column with a compact mark, so nothing is
 * lost at 360 px.
 *
 * The public API — `title`, `subtitle`, `children`, `footer` — is unchanged.
 * The brand panel is `aria-hidden` because it repeats marketing copy that the
 * form column already provides as the page's heading.
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
    <div className="mx-auto grid w-full max-w-6xl items-center gap-10 py-2 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14 lg:py-10">
      {/* Decorative brand panel. Not interactive, so it never traps focus. */}
      <aside
        aria-hidden="true"
        className="relative isolate hidden overflow-hidden rounded-[2rem] border border-surface-border bg-ink-950 p-9 text-white shadow-lg lg:flex lg:min-h-[34rem] lg:flex-col lg:justify-between lg:p-10"
      >
        <span className="mesh absolute inset-0 -z-10 opacity-80" />
        <span className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-700/55 via-transparent to-accent-2/35" />
        <span className="grid-fade absolute inset-0 -z-10 opacity-20" />
        <span className="orb -right-12 -top-16 h-56 w-56 bg-aqua-400/25" />
        <span className="orb -left-16 bottom-0 h-52 w-52 bg-brand-400/20" />

        <span className="relative inline-flex items-center gap-2.5">
          <BrandMark size={38} />
          <Wordmark className="text-white" />
        </span>

        <div className="relative mt-10 max-w-sm">
          <h2 className="display-2 text-balance">
            Pass your next certification with{' '}
            <span className="bg-gradient-to-r from-white via-aqua-200 to-flare-200 bg-clip-text text-transparent">
              confidence
            </span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/85 text-pretty">
            Real exam questions, timed mock exams and an AI tutor that explains every answer.
          </p>
        </div>

        <ul className="relative mt-10 flex flex-col gap-4">
          {HIGHLIGHTS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title} className="flex items-start gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/20">
                  <Icon width={19} height={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-white/75">{item.body}</p>
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
            className="mx-auto mb-5 inline-flex items-center gap-2.5 rounded-2xl lg:hidden"
          >
            <BrandMark size={40} />
            <Wordmark />
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
