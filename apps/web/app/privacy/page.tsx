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
    <div className="mx-auto w-full max-w-5xl py-2 sm:py-6">
      <header className="border-b border-surface-border pb-5">
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="display-2 text-balance">Privacy policy</h1>
        <p className="caption mt-2">Last updated: {new Date().getFullYear()}</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="On this page" className="panel p-4 lg:sticky lg:top-24 lg:self-start lg:p-5">
          <p className="eyebrow mb-3">On this page</p>
          <ul className="flex flex-col gap-1.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-brand-600 underline-offset-4 hover:bg-surface-overlay hover:underline dark:text-brand-300"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="max-w-[70ch]">
          <p className="body-text text-pretty">
            We collect the minimum data needed to run your account and improve your study experience.
          </p>

          <section id="what-we-store" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">What we store</h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {STORED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-content-secondary">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section id="what-we-never-store" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">What we never store</h2>
            <p className="body-text mt-3 text-pretty">
              Exam questions are served from a private GitHub dataset at request time and are never copied into our
              application database.
            </p>
          </section>

          <section id="your-rights" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">Your rights</h2>
            <p className="body-text mt-3 text-pretty">
              You can export or delete your data at any time from Settings → Data &amp; account.
            </p>
          </section>

          <section id="third-parties" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">Third parties</h2>
            <p className="body-text mt-3 text-pretty">
              We use MongoDB Atlas for application data, GitHub for the question dataset, and an optional AI provider
              for explanations. Secrets are managed with Doppler and never committed to source control.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
