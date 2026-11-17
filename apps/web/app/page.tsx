import Link from 'next/link';
import { LandingStats } from '@/components/landing-stats';
import { LandingDiscovery } from '@/components/landing-discovery';
import { LandingPricing } from '@/components/landing-pricing';
import { HeroCta } from '@/components/hero-cta';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/format';
import {
  IconArrowRight,
  IconBook,
  IconChart,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconLightning,
  IconMessage,
  IconPlay,
  IconShield,
  IconSparkles,
  IconTrophy,
} from '@/components/icons';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-20 pb-6 sm:gap-28 lg:gap-32">
      <Hero />
      <Reveal>
        <TrustStrip />
      </Reveal>
      <Reveal>
        <HowItWorks />
      </Reveal>
      <Reveal>
        <FeatureStory />
      </Reveal>
      <Reveal>
        <TutorBand />
      </Reveal>
      <Reveal>
        <PricingPreview />
      </Reveal>
      <Reveal>
        <ClosingCta />
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative isolate pt-2 sm:pt-6">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 -top-10 h-80" />
      <div aria-hidden="true" className="orb -left-16 top-10 h-64 w-64 bg-brand-500/25 animate-glow" />
      <div aria-hidden="true" className="orb right-0 top-40 h-72 w-72 bg-accent-2/20" />

      <div className="relative grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] px-3.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-accent">
            <IconSparkles width={13} height={13} />
            AI tutor on every plan
          </p>

          <h1 className="display-1 mt-5 text-balance">
            Pass your next certification with{' '}
            <span className="gradient-text animate-gradient">confidence</span>
          </h1>

          <p className="mt-6 max-w-lg text-pretty text-base leading-relaxed text-content-secondary sm:text-lg">
            Real exam questions, timed mock exams and an AI tutor that explains every answer — built for the way
            working professionals actually study.
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <HeroCta />
            <Link href="/exams" className="btn-secondary btn-lg">
              Browse exams
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-content-muted">
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

      <div className="relative mt-16 sm:mt-20">
        <LandingStats />
      </div>
    </section>
  );
}

/**
 * Illustrative product preview. Structural chrome only — no real question
 * content, scores or names — so the page never presents invented data as fact.
 */
function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:mx-0">
      <div aria-hidden="true" className="absolute -inset-x-3 -inset-y-8 -z-10 rounded-[2.5rem] bg-gradient-to-br from-brand-500/15 via-accent-2/10 to-aqua-400/10 blur-2xl sm:-inset-x-6" />

      <div className="ring-gradient overflow-hidden rounded-[1.85rem] bg-surface-raised shadow-lg animate-float">
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
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-600 to-accent-2" style={{ width: '20%' }} />
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
                  'flex items-center gap-3 rounded-[1rem] border px-3 py-2.5 text-sm',
                  index === 1
                    ? 'border-accent/50 bg-accent/[0.08] font-medium'
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

          <div className="mt-4 flex items-start gap-2.5 rounded-[1rem] border border-accent/25 bg-accent/[0.06] p-3">
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
/* Trust + discovery                                                   */
/* ------------------------------------------------------------------ */

function TrustStrip() {
  return (
    <section className="section" aria-labelledby="discovery-heading">
      <div className="section-head flex-col items-start gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-2">Find your exam</p>
          <h2 id="discovery-heading" className="display-2 text-balance">
            Start from the catalogue
          </h2>
          <p className="body-text mt-2 max-w-xl">
            Hundreds of certification providers and thousands of exams. Search by code or title, or jump straight
            into what is popular.
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
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow mb-2">How it works</p>
        <h2 id="steps-heading" className="display-2 text-balance">
          Three steps to exam-ready
        </h2>
      </div>

      <ol className="relative grid gap-5 sm:grid-cols-3 sm:gap-6">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.n}
              className="group relative flex flex-col gap-3 rounded-[1.5rem] border border-surface-border bg-surface-raised p-5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-2 text-white shadow-glow-sm">
                  <Icon width={22} height={22} />
                </span>
                <span className="numeric font-display text-4xl font-bold leading-none text-accent/25">{step.n}</span>
              </div>
              <h3 className="heading-1">{step.title}</h3>
              <p className="text-[0.8125rem] leading-relaxed text-content-muted">{step.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Feature storytelling — alternating rows, not a card wall            */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    eyebrow: 'Practice',
    title: 'A study interface built for focus',
    body: 'Comfortable reading width, keyboard shortcuts, instant grading and explanations that stay on screen while you think.',
    points: ['1–9 answer shortcuts', 'Bookmark and revisit', 'Explanation after every answer'],
    icon: IconBook,
  },
  {
    eyebrow: 'Mock exams',
    title: 'Sit the real thing before the real thing',
    body: 'Randomised 60-question mocks with a countdown timer, question navigator and a server-graded score report.',
    points: ['Countdown timer', 'Flag and review', 'Pass/fail readiness report'],
    icon: IconTrophy,
  },
  {
    eyebrow: 'Analytics',
    title: 'Know exactly what to fix next',
    body: 'Every answer is tracked, so your dashboard can point at the weak topics holding your score back.',
    points: ['Accuracy trend', 'Weak-topic breakdown', 'Recommendations that adapt'],
    icon: IconChart,
  },
];

function FeatureStory() {
  return (
    <section className="section" aria-labelledby="features-heading">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow mb-2">Why ExamDump Pro</p>
        <h2 id="features-heading" className="display-2 text-balance">
          One system, not a question dump
        </h2>
        <p className="body-text mt-3">Practice, simulation, analysis and tutoring share one coherent workflow.</p>
      </div>

      <div className="flex flex-col gap-12 sm:gap-16">
        {FEATURES.map((feature, index) => {
          const Icon = feature.icon;
          const flip = index % 2 === 1;
          return (
            <div
              key={feature.title}
              className={cn(
                'grid items-center gap-8 lg:grid-cols-2 lg:gap-14',
                flip && 'lg:[&>*:first-child]:order-2',
              )}
            >
              <div className="max-w-lg">
                <span className="inline-grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">
                  <Icon width={22} height={22} />
                </span>
                <p className="eyebrow mt-4">{feature.eyebrow}</p>
                <h3 className="display-2 mt-2 text-balance">{feature.title}</h3>
                <p className="body-text mt-3 text-base">{feature.body}</p>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {feature.points.map((point) => (
                    <li key={point} className="flex items-center gap-2.5 text-sm text-content-secondary">
                      <IconCheckCircle width={17} height={17} className="shrink-0 text-positive" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative">
                <div
                  aria-hidden="true"
                  className={cn(
                    'orb h-56 w-56',
                    flip ? 'left-0 bg-aqua-400/20' : 'right-0 bg-accent-2/20',
                  )}
                />
                <div className="ring-gradient relative overflow-hidden rounded-[1.75rem] bg-surface-raised p-6 shadow-md">
                  <FeatureArt kind={feature.eyebrow} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: IconLightning, title: 'Built for momentum', body: 'Streaks, session progress and leaderboards keep a daily habit going.' },
          { icon: IconCheckCircle, title: 'Excellent on a phone', body: 'Floating navigation, swipe between questions and thumb-sized controls.' },
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

/** Small abstract visuals, structurally illustrative (no real data). */
function FeatureArt({ kind }: { kind: string }) {
  if (kind === 'Practice') {
    return (
      <div className="flex flex-col gap-2.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2.5',
              i === 0 ? 'border-accent/45 bg-accent/[0.07]' : 'border-surface-border',
            )}
          >
            <span className={cn('h-5 w-5 shrink-0 rounded-md', i === 0 ? 'bg-accent' : 'bg-surface-inset')} />
            <span className="h-2 flex-1 rounded-full bg-surface-inset" />
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'Mock exams') {
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="flex items-center justify-center">
          <div className="grid h-24 w-24 place-items-center rounded-full border-4 border-accent/25 text-center">
            <span className="numeric font-display text-2xl font-bold text-accent">42:10</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className={cn('h-6 flex-1 rounded-md', i < 6 ? 'bg-brand-500/70' : 'bg-surface-inset')}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2" aria-hidden="true">
      {[38, 62, 50, 80, 70, 92].map((h, i) => (
        <span
          key={i}
          className="flex-1 rounded-lg bg-gradient-to-t from-brand-500/35 to-accent-2/80"
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI tutor band                                                       */
/* ------------------------------------------------------------------ */

function TutorBand() {
  return (
    <section aria-labelledby="tutor-heading" className="section">
      <div className="mesh relative overflow-hidden rounded-[2rem] border border-surface-border p-6 text-white sm:p-10">
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-brand-600/70 via-brand-700/60 to-accent-2/50" />
        <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
          <div className="max-w-lg">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-white/80">AI tutor</p>
            <h2 id="tutor-heading" className="display-2 mt-3 text-balance">
              Ask why, not just what
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/85 sm:text-base">
              Get a hint before you answer, a plain-language explanation after, or open a full conversation about
              the topic. Every plan includes it.
            </p>
            <Link href="/ask" className="btn mt-6 bg-white text-brand-700 hover:bg-white/90">
              Try the AI tutor
              <IconArrowRight width={16} height={16} />
            </Link>
          </div>

          <div className="flex flex-col gap-3">
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-white/15 px-4 py-2.5 text-sm backdrop-blur">
              Why is option B correct here?
            </div>
            <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-surface-raised/95 px-4 py-3 text-sm text-content-secondary shadow-lg">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-accent">
                <IconSparkles width={13} height={13} /> AI tutor
              </span>
              It meets the recovery objective because the design keeps a redundant path available across zones…
            </div>
            <div className="flex items-center gap-2 pl-1 text-xs text-white/70">
              <span className="dot-pulse" aria-hidden="true" />
              Composing an answer
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing + closing CTA                                               */
/* ------------------------------------------------------------------ */

function PricingPreview() {
  return (
    <section className="section" aria-labelledby="pricing-heading">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow mb-2">Pricing</p>
        <h2 id="pricing-heading" className="display-2 text-balance">
          Start free, upgrade when it counts
        </h2>
        <p className="body-text mt-3">
          Every plan includes the AI tutor and the full practice interface. Pricing is decided on our secure
          checkout.
        </p>
      </div>

      <LandingPricing />

      <div className="text-center">
        <Link href="/pricing" className="link">
          Compare every plan and what is included →
        </Link>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="mesh relative overflow-hidden rounded-[2.25rem] border border-surface-border">
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-600/90 to-accent-2" />
      <div aria-hidden="true" className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-aqua-400/30 blur-3xl" />
      <div className="relative px-5 py-14 text-center text-white sm:px-10 sm:py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="display-1 text-balance">Your exam date is already set</h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
            Start with the free questions today. Upgrade only when you want the full bank and analytics.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            <Link href="/register" className="btn bg-white px-7 text-brand-700 hover:bg-white/90">
              Create free account
              <IconArrowRight width={16} height={16} />
            </Link>
            <Link href="/exams" className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20">
              <IconPlay width={15} height={15} />
              Browse exams
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
