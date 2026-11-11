import Link from 'next/link';
import { LandingStats } from '@/components/landing-stats';

const features = [
  {
    title: 'Real exam questions',
    body: 'Thousands of community-verified questions across 160+ certification providers, with vote distribution and explanations.',
    icon: '📚',
  },
  {
    title: 'Mock & timed exams',
    body: 'Simulate the real thing with randomised mock tests, countdown timers and instant server-graded results.',
    icon: '⏱️',
  },
  {
    title: 'AI explanations',
    body: 'Ask the built-in tutor why an answer is correct. Get clear, conversational explanations on demand.',
    icon: '✨',
  },
  {
    title: 'Weak-topic analysis',
    body: 'We track every question you answer and surface the exact topics holding your score back.',
    icon: '🎯',
  },
  {
    title: 'Streaks & leaderboards',
    body: 'Build a daily habit, keep your streak alive and see how you rank against other learners.',
    icon: '🔥',
  },
  {
    title: 'Beautiful on every device',
    body: 'A mobile-first interface with dark and light themes, keyboard navigation and WCAG-minded contrast.',
    icon: '📱',
  },
];

const steps = [
  { title: 'Pick your certification', body: 'Browse by provider or search 1,800+ exams by code or title.' },
  { title: 'Practice or simulate', body: 'Study in reading mode, drill in practice mode, or sit a timed mock exam.' },
  { title: 'Track and improve', body: 'Review analytics, fix weak topics and watch your readiness score climb.' },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-20 pb-10">
      <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-surface-raised/60 px-6 py-16 text-center sm:px-12 sm:py-24">
        <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-500 dark:text-brand-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
            New · AI tutor, adaptive analytics and mock exams
          </p>
          <h1 className="text-balance text-4xl font-black leading-tight tracking-tight sm:text-6xl">
            Pass your next certification with{' '}
            <span className="bg-gradient-to-r from-brand-400 via-brand-300 to-cyan-300 bg-clip-text text-transparent">confidence</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-content-secondary sm:text-lg">
            Practice with real exam questions, take timed mock tests, and let AI explain every answer. Built for IT,
            cloud, security and business certifications.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="btn-primary w-full px-7 py-3 text-base sm:w-auto">
              Start free — no card needed
            </Link>
            <Link href="/browse" className="btn-secondary w-full px-7 py-3 text-base sm:w-auto">
              Browse exams
            </Link>
          </div>
          <p className="mt-4 text-xs text-content-muted">Free plan includes 5 questions per exam. Cancel Premium any time.</p>
        </div>
      </section>

      <LandingStats />

      <section>
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Everything you need to pass</h2>
          <p className="mt-3 text-content-muted">A complete study system, not just a question dump.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="card card-hover p-6">
              <span className="text-3xl" aria-hidden>{feature.icon}</span>
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-surface-border bg-surface-raised/50 px-6 py-12 sm:px-10">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
          <p className="mt-3 text-content-muted">From zero to exam-ready in three simple steps.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="relative rounded-2xl border border-surface-border bg-surface-base/50 p-6">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-sky-400 font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-content-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl border border-brand-400/30 bg-gradient-to-br from-brand-600/20 via-surface-raised to-cyan-500/10 px-6 py-14 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to make your next attempt your last?</h2>
        <p className="mx-auto mt-3 max-w-xl text-content-secondary">
          Join thousands of learners using ExamDump Pro to study smarter. Start free today.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/register" className="btn-primary px-7 py-3 text-base">Create your free account</Link>
          <Link href="/pricing" className="btn-secondary px-7 py-3 text-base">Compare plans</Link>
        </div>
      </section>
    </div>
  );
}