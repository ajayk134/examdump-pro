import Link from 'next/link';
import { LandingStats } from '@/components/landing-stats';
import { LandingDiscovery } from '@/components/landing-discovery';
import { LandingPricing } from '@/components/landing-pricing';
import { HeroCta } from '@/components/hero-cta';
import {
  IconArrowRight,
  IconBook,
  IconChart,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconLightning,
  IconMessage,
  IconShield,
  IconSparkles,
  IconTrophy,
} from '@/components/icons';

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16 pb-6 sm:gap-24 lg:gap-28">
      <Hero />
      <LandingStats />
      <DiscoverySection />
      <HowItWorks />
      <FeatureStory />
      <PricingPreview />
      <ClosingCta />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative isolate pt-2 sm:pt-6">
      {/* Ambient technical grid, clipped to the hero. */}
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-10 h-72 opacity-60" />

      <div className="relative grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <div className="max-w-xl">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-accent">
            <IconSparkles width={13} height={13} />
            AI tutor on every plan
          </p>

          <h1 className="display-1 text-balance">
            Pass your next certification with{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-400 to-sky-400 bg-clip-text text-transparent dark:from-brand-300 dark:via-sky-300 dark:to-brand-400">
              confidence
            </span>
          </h1>

          <p className="mt-5 max-w-lg text-pretty text-[0.9375rem] leading-relaxed text-content-secondary sm:text-lg">
            Real exam questions, timed mock exams and an AI tutor that explains every answer — built for the way
            working professionals actually study.
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
            <HeroCta />
            <Link href="/exams" className="btn-secondary btn-lg">
              Browse exams
            </Link>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-content-muted">
            {['5 questions free on every exam', 'No card to start', 'Cancel any time'].map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <IconCheck width={14} height={14} className="text-positive" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <HeroMock />
      </div>
    </section>
  );
}

/**
 * Illustrative product preview.
 *
 * Structural chrome only — no real question content, scores or names — so the
 * page never presents invented data as fact.
 */
function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:mx-0">
      {/*
        The halo is inset rather than a plain `-inset-6`: a decorative box that
        bleeds past the viewport widens the layout viewport on a phone, which
        drags the fixed bottom nav out to the document width. 12 px each side is
        invisible for a blurred glow at 360 px; the full bleed returns at `sm`,
        where the centred card leaves room for it.
      */}
      <div aria-hidden="true" className="absolute -inset-x-3 -inset-y-6 -z-10 rounded-[2rem] bg-accent/[0.07] blur-2xl sm:-inset-x-6" />

      <div className="panel-lg overflow-hidden p-0 shadow-lg">
        <div className="flex items-center gap-2 border-b border-surface-border bg-surface-overlay/70 px-4 py-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-negative/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-caution/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-positive/50" />
          </span>
          <span className="ml-1 text-[0.6875rem] font-semibold text-content-muted">Practice · Question 12 of 60</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-[0.6875rem] font-bold tabular-nums text-content-secondary">
            <IconClock width={12} height={12} /> 42:10
          </span>
        </div>

        <div className="p-4 sm:p-5">
          <div className="progress-track h-1.5">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-sky-400" style={{ width: '20%' }} />
          </div>

          <p className="eyebrow mt-5">Cloud architecture</p>
          <p className="mt-2 text-sm font-semibold leading-snug">
            Which design meets the resilience requirement for the described workload?
          </p>

          <ul className="mt-4 flex flex-col gap-2">
            {['A', 'B', 'C', 'D'].map((letter, index) => (
              <li
                key={letter}
                className={[
                  'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm',
                  index === 1
                    ? 'border-accent/50 bg-accent/[0.07] font-medium'
                    : 'border-surface-border text-content-secondary',
                ].join(' ')}
              >
                <span
                  className={[
                    'grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[0.6875rem] font-bold',
                    index === 1 ? 'bg-accent text-white' : 'bg-surface-inset text-content-muted',
                  ].join(' ')}
                >
                  {letter}
                </span>
                <span className="h-2.5 flex-1 rounded-full bg-surface-inset" aria-hidden="true" />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent/[0.06] p-3">
            <IconSparkles width={16} height={16} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-semibold text-accent">AI explanation</p>
              <span className="block h-2 w-11/12 rounded-full bg-accent/20" aria-hidden="true" />
              <span className="block h-2 w-3/4 rounded-full bg-accent/20" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[0.6875rem] text-content-muted lg:text-left">Illustrative interface</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

function DiscoverySection() {
  return (
    <section className="section" aria-labelledby="discovery-heading">
      <div className="section-head">
        <div>
          <p className="eyebrow mb-2">Find your exam</p>
          <h2 id="discovery-heading" className="display-2 text-balance">
            Start from the catalogue
          </h2>
          <p className="body-text mt-2 max-w-xl">
            160+ certification providers, 1,800+ exams. Search by code or title, or jump straight into what is popular.
          </p>
        </div>
        <Link href="/exams" className="btn-secondary btn-sm hidden shrink-0 sm:inline-flex">
          Browse all
          <IconArrowRight width={15} height={15} />
        </Link>
      </div>

      <LandingDiscovery />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    n: '01',
    title: 'Pick your certification',
    body: 'Search by exam code or title, or browse by provider. Your recently visited exams stay one tap away.',
    icon: IconBook,
  },
  {
    n: '02',
    title: 'Practise or simulate',
    body: 'Drill with instant feedback and AI explanations, then sit a timed mock under real exam conditions.',
    icon: IconTrophy,
  },
  {
    n: '03',
    title: 'Track and improve',
    body: 'Review accuracy trends and weak topics after every session, and let recommendations point to the next win.',
    icon: IconChart,
  },
];

function HowItWorks() {
  return (
    <section className="section" aria-labelledby="steps-heading">
      <div className="mx-auto max-w-xl text-center">
        <p className="eyebrow mb-2">How it works</p>
        <h2 id="steps-heading" className="display-2 text-balance">
          Three steps to exam-ready
        </h2>
      </div>

      <ol className="relative grid gap-6 sm:grid-cols-3 sm:gap-8">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.n} className="relative flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
                  <Icon width={20} height={20} />
                </span>
                <span className="numeric text-3xl font-black leading-none text-accent/20">{step.n}</span>
              </div>
              <h3 className="heading-2">{step.title}</h3>
              <p className="text-[0.8125rem] leading-relaxed text-content-muted">{step.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Feature storytelling                                                */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    eyebrow: 'Practice',
    title: 'A study interface built for focus',
    body: 'Comfortable reading width, keyboard shortcuts, instant grading and explanations that stay on screen while you think.',
    points: ['1–9 answer shortcuts', 'Bookmark and revisit', 'Explanation after every answer'],
    icon: IconBook,
    tone: 'accent' as const,
  },
  {
    eyebrow: 'Mock exams',
    title: 'Sit the real thing before you sit the real thing',
    body: 'Randomised 60-question mocks with a countdown timer, question navigator and server-graded score report.',
    points: ['Countdown timer', 'Flag and review', 'Pass/fail readiness report'],
    icon: IconTrophy,
    tone: 'caution' as const,
  },
  {
    eyebrow: 'Analytics',
    title: 'Know exactly what to fix next',
    body: 'Every answer is tracked, so your dashboard can point at the weak topics holding your score back.',
    points: ['Accuracy trend', 'Weak-topic breakdown', 'Recommendations that adapt'],
    icon: IconChart,
    tone: 'positive' as const,
  },
  {
    eyebrow: 'AI tutor',
    title: 'Ask why, not just what',
    body: 'Get a hint before answering, a plain-language explanation after, or open a full conversation about the topic.',
    points: ['Hints before you commit', 'Step-by-step reasoning', 'Chat about any question'],
    icon: IconMessage,
    tone: 'accent' as const,
  },
];

function FeatureStory() {
  return (
    <section className="section" aria-labelledby="features-heading">
      <div className="mx-auto max-w-xl text-center">
        <p className="eyebrow mb-2">Why ExamDump Pro</p>
        <h2 id="features-heading" className="display-2 text-balance">
          One system, not a question dump
        </h2>
        <p className="body-text mt-2.5">Practice, simulation, analysis and tutoring share one coherent workflow.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          const tone = {
            accent: 'text-accent bg-accent/10',
            caution: 'text-caution bg-caution/[0.12]',
            positive: 'text-positive bg-positive/[0.12]',
          }[feature.tone];
          return (
            <article key={feature.title} className="panel flex flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center rounded-2xl ${tone}`}>
                  <Icon width={20} height={20} />
                </span>
                <p className="eyebrow">{feature.eyebrow}</p>
              </div>
              <div>
                <h3 className="heading-1 text-balance">{feature.title}</h3>
                <p className="body-text mt-2">{feature.body}</p>
              </div>
              <ul className="mt-auto flex flex-col gap-2 border-t border-surface-border pt-4">
                {feature.points.map((point) => (
                  <li key={point} className="flex items-center gap-2 text-[0.8125rem] text-content-secondary">
                    <IconCheckCircle width={16} height={16} className="shrink-0 text-positive" />
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <ul className="mt-2 grid gap-3 sm:grid-cols-3">
        {[
          { icon: IconLightning, title: 'Built for momentum', body: 'Streaks, session progress and leaderboards keep a daily habit going.' },
          { icon: IconCheckCircle, title: 'Excellent on a phone', body: 'Bottom navigation, swipe between questions and thumb-sized controls.' },
          { icon: IconShield, title: 'Private by default', body: 'Your answers and notes stay yours. No ads, no data selling.' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="tile flex items-start gap-3 p-4">
              <Icon width={18} height={18} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{item.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing + closing CTA                                               */
/* ------------------------------------------------------------------ */

function PricingPreview() {
  return (
    <section className="section" aria-labelledby="pricing-heading">
      <div className="mx-auto max-w-xl text-center">
        <p className="eyebrow mb-2">Pricing</p>
        <h2 id="pricing-heading" className="display-2 text-balance">
          Start free, upgrade when it counts
        </h2>
        <p className="body-text mt-2.5">
          Every plan includes the AI tutor and the full practice interface. Pricing is decided on our secure checkout.
        </p>
      </div>

      <LandingPricing />

      <div className="text-center">
        <Link href="/pricing" className="link text-sm">
          Compare every plan and what is included →
        </Link>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-gradient-to-br from-brand-600 via-brand-500 to-sky-400 px-5 py-12 text-center text-white sm:px-10 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_-20%,rgba(255,255,255,0.28),transparent_60%)]"
      />
      <div className="relative mx-auto max-w-xl">
        <h2 className="text-[1.7rem] font-extrabold leading-tight tracking-tight sm:text-4xl">
          Your exam date is already set
        </h2>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
          Start with the free questions today. Upgrade only when you want the full bank and analytics.
        </p>
        <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row">
          <Link href="/register" className="btn bg-white px-6 text-brand-700 hover:bg-white/90">
            Create free account
            <IconArrowRight width={16} height={16} />
          </Link>
          <Link href="/exams" className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20">
            Browse exams
          </Link>
        </div>
      </div>
    </section>
  );
}
