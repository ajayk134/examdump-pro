export const metadata = { title: 'Security' };

const items: Array<{ id: string; title: string; body: string }> = [
  {
    id: 'server-enforced-limits',
    title: 'Server-enforced limits',
    body: 'Free and premium entitlements are enforced on the API, never in the browser. Questions cannot be enumerated beyond your plan.',
  },
  {
    id: 'private-dataset',
    title: 'Private dataset',
    body: 'Question banks live in a private GitHub repository and are proxied through the API using a short-lived server-side token.',
  },
  {
    id: 'secrets-management',
    title: 'Secrets management',
    body: 'All credentials are injected at runtime by Doppler. Nothing sensitive is committed to version control.',
  },
  {
    id: 'secure-sessions',
    title: 'Secure sessions',
    body: 'Short-lived JWT access tokens plus rotating, hashed refresh tokens stored in HttpOnly cookies.',
  },
  {
    id: 'hardening',
    title: 'Hardening',
    body: 'Helmet security headers, strict CORS, request validation, rate limiting, audit logging and per-user quotas.',
  },
  {
    id: 'data-isolation',
    title: 'Data isolation',
    body: 'Application data lives in a dedicated MongoDB database with least-privilege credentials.',
  },
];

export default function SecurityPage() {
  return (
    <div className="mx-auto w-full max-w-6xl py-2 sm:py-6">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-surface-border bg-ink-950 p-6 text-white sm:p-9">
        <span aria-hidden="true" className="mesh absolute inset-0 -z-10 opacity-80" />
        <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-700/55 via-transparent to-accent-2/35" />
        <span aria-hidden="true" className="grid-fade absolute inset-0 -z-10 opacity-20" />
        <span aria-hidden="true" className="orb -right-10 -top-16 h-44 w-44 bg-aqua-400/25" />
        <p className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-white/75">Trust</p>
        <h1 className="display-2 text-balance">Security at ExamDump Pro</h1>
        <p className="mt-3 max-w-[68ch] text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
          Security is designed in, not bolted on.
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="On this page" className="panel p-4 lg:sticky lg:top-24 lg:self-start lg:p-5">
          <p className="eyebrow mb-3">On this page</p>
          <ol className="flex flex-col gap-0.5">
            {items.map((item, index) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="group flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-overlay hover:text-content-primary"
                >
                  <span className="numeric text-[0.6875rem] font-bold text-accent/70 group-hover:text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 max-w-[70ch]">
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item, index) => (
              <li key={item.id} id={item.id} className="tile scroll-mt-24 p-5">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="numeric text-[0.6875rem] font-bold text-accent/70">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 className="heading-2">{item.title}</h2>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-content-muted">{item.body}</p>
              </li>
            ))}
          </ul>

          <p className="body-text mt-6 text-pretty">
            To report a vulnerability, contact the maintainers privately. Please do not open a public issue for
            security reports.
          </p>
        </div>
      </div>
    </div>
  );
}
