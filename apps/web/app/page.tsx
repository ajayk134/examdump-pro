import Link from 'next/link';
import { LandingStats } from '@/components/landing-stats';
import { HeroCta } from '@/components/hero-cta';
import { IconArrowRight, IconBook, IconChart, IconCheckCircle, IconLightning, IconMessage, IconTrophy } from '@/components/icons';

const features = [
  {
    title: 'Real exam questions',
    body: 'Community-verified questions across 160+ certification providers, with vote distribution and explanations.',
    icon: IconBook,
  },
  {
    title: 'Mock & timed exams',
    body: 'Randomised mock tests, countdown timers, autosave and server-graded score reports.',
    icon: IconTrophy,
  },
  {
    title: 'AI tutor on every question',
    body: 'Ask why an answer is right, get a hint before answering, or open a full chat about the topic.',
    icon: IconMessage,
  },
  {
    title: 'Weak-topic analysis',
    body: 'Every answer is tracked so you can see exactly which topics are holding your score back.',
    icon: IconChart,
  },
  {
    title: 'Built for momentum',
    body: 'Session progress, streaks and leaderboards keep a daily habit going without guilt-tripping you.',
    icon: IconLightning,
  },
  {
    title: 'Excellent on a phone',
    body: 'Bottom navigation, swipe between questions and thumb-sized controls. Desktop gets the same care.',
    icon: IconCheckCircle,
  },
];

const steps = [
  { n: '01', title: 'Pick your certification', body: 'Search 1,800+ exams by code or title, or browse by provider.' },
  { n: '02', title: 'Practice or simulate', body: 'Drill with instant feedback, then sit a timed mock under real conditions.' },
  { n: '03', title: 'Track and improve', body: 'Review analytics, fix weak topics and watch your readiness climb.' },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12 pb-8 sm:gap-16 lg:gap-20">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-surface-raised px-4 py-10 sm:px-10 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl"
        />

        <div className="relative mx-auto max-w-3xl text-center">
          <p className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-wider text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            AI tutor included on every plan
          </p>

          <h1 className="display-1 text-balance">
            Pass your next certification with{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-400 to-sky-400 bg-clip-text text-transparent dark:from-brand-300 dark:via-sky-300 dark:to-brand-400">
              confidence
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-content-secondary sm:mt-5 sm:text-lg">
            Real exam questions, timed mock tests, and an AI tutor that explains every answer — built for IT, cloud,
            security and business certifications.
          </p>

          <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">
            <HeroCta />
            <Link href="/exams" className="btn-secondary btn-lg">
              Browse exams
            </Link>
          </div>

          <p className="mt-3.5 text-xs text-content-muted">
            5 questions per exam free · AI tutor included · cancel any time
          </p>
        </div>
      </section>

      <LandingStats />

      {/* ---------------- Features ---------------- */}
      <section aria-labelledby="features-heading">
        <div className="mx-auto mb-7 max-w-xl text-center sm:mb-9">
          <p className="eyebrow mb-2">Why ExamDump Pro</p>
          <h2 id="features-heading" className="display-2 text-balance">
            Everything you need to pass
          </h2>
          <p className="body-text mt-2.5">A complete study system, not just a question dump.</p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title} className="surface p-4 transition-colors sm:p-5">
                <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="heading-3">{feature.title}</h3>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-content-muted">{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section aria-labelledby="steps-heading">
        <div className="mx-auto mb-7 max-w-xl text-center">
          <p className="eyebrow mb-2">How it works</p>
          <h2 id="steps-heading" className="display-2 text-balance">
            Three steps to exam-ready
          </h2>
        </div>

        <ol className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
          {steps.map((step) => (
            <li key={step.n} className="surface relative p-4 sm:p-5">
              <span className="numeric text-[2rem] font-black leading-none text-accent/25">{step.n}</span>
              <h3 className="heading-3 mt-2">{step.title}</h3>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-content-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- Closing CTA ---------------- */}
      <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-gradient-to-br from-brand-600 via-brand-500 to-sky-400 px-5 py-10 text-center text-white sm:px-10 sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_-20%,rgba(255,255,255,0.28),transparent_60%)]" />
        <div className="relative mx-auto max-w-xl">
          <h2 className="text-[1.6rem] font-extrabold leading-tight tracking-tight sm:text-4xl">
            Your exam date is already set
          </h2>
          <p className="mx-auto mt-2.5 max-w-md text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
            Start with the free questions today. Upgrade only when you want the full bank and analytics.
          </p>
          <div className="mt-6 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row">
            <Link href="/register" className="btn bg-white px-6 text-brand-700 hover:bg-white/90">
              Create free account
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
