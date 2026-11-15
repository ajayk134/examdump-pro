export const metadata = { title: 'Terms of service' };

const SECTIONS = [
  { id: 'study-material', title: 'Study material' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'subscriptions', title: 'Subscriptions' },
  { id: 'acceptable-use', title: 'Acceptable use' },
];

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl py-2 sm:py-6">
      <header className="border-b border-surface-border pb-5">
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="display-2 text-balance">Terms of service</h1>
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
            By creating an account you agree to use ExamDump Pro for lawful personal study purposes only.
          </p>

          <section id="study-material" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">Study material</h2>
            <p className="body-text mt-3 text-pretty">
              Questions are provided for educational revision. Certification names and trademarks belong to their
              respective owners. We are not affiliated with or endorsed by any certification body.
            </p>
          </section>

          <section id="accounts" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">Accounts</h2>
            <p className="body-text mt-3 text-pretty">
              You are responsible for keeping your credentials secure. Do not share your account or attempt to
              scrape, redistribute or resell the question bank.
            </p>
          </section>

          <section id="subscriptions" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">Subscriptions</h2>
            <p className="body-text mt-3 text-pretty">
              Premium subscriptions renew for the selected period. You may cancel at any time; access continues
              until the end of the paid period. Payment processing is currently simulated while integration is
              completed.
            </p>
          </section>

          <section id="acceptable-use" className="mt-8 scroll-mt-24">
            <h2 className="heading-1">Acceptable use</h2>
            <p className="body-text mt-3 text-pretty">
              Abuse, automated scraping, reverse engineering protections or circumventing usage limits may result
              in suspension.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
