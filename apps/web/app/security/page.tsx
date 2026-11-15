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
    <div className="mx-auto w-full max-w-5xl py-2 sm:py-6">
      <header className="border-b border-surface-border pb-5">
        <p className="eyebrow mb-2">Trust</p>
        <h1 className="display-2 text-balance">Security at ExamDump Pro</h1>
        <p className="body-text mt-3 max-w-[68ch] text-pretty">Security is designed in, not bolted on.</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="On this page" className="panel p-4 lg:sticky lg:top-24 lg:self-start lg:p-5">
          <p className="eyebrow mb-3">On this page</p>
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-brand-600 underline-offset-4 hover:bg-surface-overlay hover:underline dark:text-brand-300"
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-[70ch]">
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item, index) => (
              <li key={item.id} id={item.id} className="panel scroll-mt-24 p-5">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="numeric text-[0.6875rem] font-bold text-accent/70"
                  >
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
