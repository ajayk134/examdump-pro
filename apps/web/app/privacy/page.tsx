import { IconCheck } from '@/components/icons';

export const metadata = { title: 'Privacy policy' };

const SECTIONS = [
  { id: 'what-we-store', title: 'What we store' },
  { id: 'what-we-never-store', title: 'What we never store' },
  { id: 'your-rights', title: 'Your rights' },
  { id: 'third-parties', title: 'Third parties' },
];

const STORED = [
  'Account details: name, email, hashed password, avatar and preferences.',
  'Learning data: attempts, answers, bookmarks, notes, stars and analytics.',
  'Billing records for simulated and future subscriptions.',
  'Security logs: sign-in events, sessions, IP and user-agent.',
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-6xl py-2 sm:py-6">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border p-6 sm:p-9">
        <span aria-hidden="true" className="mesh absolute inset-0 -z-10 opacity-[0.13]" />
        <span aria-hidden="true" className="grid-fade absolute inset-0 -z-10 opacity-40" />
        <span aria-hidden="true" className="orb -right-10 -top-16 h-40 w-40 bg-aqua-400/20" />
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="display-2 text-balance">Privacy policy</h1>
        <p className="caption mt-3">Last updated: {new Date().getFullYear()}</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="On this page" className="panel p-4 lg:sticky lg:top-24 lg:self-start lg:p-5">
          <p className="eyebrow mb-3">On this page</p>
          <ol className="flex flex-col gap-0.5">
            {SECTIONS.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="group flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary"
                >
                  <span className="numeric text-[0.6875rem] font-bold text-accent/70 group-hover:text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 max-w-[70ch]">
          <p className="body-text text-pretty">
            We collect the minimum data needed to run your account and improve your study experience.
          </p>

          <div className="mt-8 flex flex-col">
            <section id="what-we-store" className="scroll-mt-24 border-t border-surface-border pt-7 first:border-t-0 first:pt-0">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  01
                </span>
                <h2 className="heading-1">What we store</h2>
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {STORED.map((item) => (
                  <li key={item} className="tile flex items-start gap-3 px-3.5 py-3 text-sm leading-relaxed text-content-secondary">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-positive/[0.12] text-positive">
                      <IconCheck width={13} height={13} />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section id="what-we-never-store" className="mt-7 scroll-mt-24 border-t border-surface-border pt-7">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  02
                </span>
                <h2 className="heading-1">What we never store</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                Exam questions are served from a private GitHub dataset at request time and are never copied into our
                application database.
              </p>
            </section>

            <section id="your-rights" className="mt-7 scroll-mt-24 border-t border-surface-border pt-7">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  03
                </span>
                <h2 className="heading-1">Your rights</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                You can export or delete your data at any time from Settings → Data &amp; account.
              </p>
            </section>

            <section id="third-parties" className="mt-7 scroll-mt-24 border-t border-surface-border pt-7">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  04
                </span>
                <h2 className="heading-1">Third parties</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                We use MongoDB Atlas for application data, GitHub for the question dataset, and an optional AI provider
                for explanations. Secrets are managed with Doppler and never committed to source control.
              </p>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
