export const metadata = { title: 'Terms of service' };

const SECTIONS = [
  { id: 'study-material', title: 'Study material' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'subscriptions', title: 'Subscriptions' },
  { id: 'acceptable-use', title: 'Acceptable use' },
];

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl py-2 sm:py-6">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border p-6 sm:p-9">
        <span aria-hidden="true" className="mesh absolute inset-0 -z-10 opacity-[0.13]" />
        <span aria-hidden="true" className="grid-fade absolute inset-0 -z-10 opacity-40" />
        <span aria-hidden="true" className="orb -right-10 -top-16 h-40 w-40 bg-brand-500/20" />
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="display-2 text-balance">Terms of service</h1>
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
            By creating an account you agree to use ExamDump Pro for lawful personal study purposes only.
          </p>

          <div className="mt-8 flex flex-col">
            <section id="study-material" className="scroll-mt-24 border-t border-surface-border pt-7 first:border-t-0 first:pt-0">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  01
                </span>
                <h2 className="heading-1">Study material</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                Questions are provided for educational revision. Certification names and trademarks belong to their
                respective owners. We are not affiliated with or endorsed by any certification body.
              </p>
            </section>

            <section id="accounts" className="mt-7 scroll-mt-24 border-t border-surface-border pt-7">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  02
                </span>
                <h2 className="heading-1">Accounts</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                You are responsible for keeping your credentials secure. Do not share your account or attempt to
                scrape, redistribute or resell the question bank.
              </p>
            </section>

            <section id="subscriptions" className="mt-7 scroll-mt-24 border-t border-surface-border pt-7">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  03
                </span>
                <h2 className="heading-1">Subscriptions</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                Premium subscriptions renew for the selected period. You may cancel at any time; access continues
                until the end of the paid period. Payment processing is currently simulated while integration is
                completed.
              </p>
            </section>

            <section id="acceptable-use" className="mt-7 scroll-mt-24 border-t border-surface-border pt-7">
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="numeric text-xs font-bold text-accent/70">
                  04
                </span>
                <h2 className="heading-1">Acceptable use</h2>
              </div>
              <p className="body-text mt-3 text-pretty">
                Abuse, automated scraping, reverse engineering protections or circumventing usage limits may result
                in suspension.
              </p>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
