export const metadata = { title: 'Security' };

const items = [
  ['Server-enforced limits', 'Free and premium entitlements are enforced on the API, never in the browser. Questions cannot be enumerated beyond your plan.'],
  ['Private dataset', 'Question banks live in a private GitHub repository and are proxied through the API using a short-lived server-side token.'],
  ['Secrets management', 'All credentials are injected at runtime by Doppler. Nothing sensitive is committed to version control.'],
  ['Secure sessions', 'Short-lived JWT access tokens plus rotating, hashed refresh tokens stored in HttpOnly cookies.'],
  ['Hardening', 'Helmet security headers, strict CORS, request validation, rate limiting, audit logging and per-user quotas.'],
  ['Data isolation', 'Application data lives in a dedicated MongoDB database with least-privilege credentials.'],
];

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 text-content-secondary">
      <h1 className="text-3xl font-bold tracking-tight text-content-primary">Security at ExamDump Pro</h1>
      <p>Security is designed in, not bolted on.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map(([title, body]) => (
          <div key={title} className="card p-5">
            <h2 className="font-semibold text-content-primary">{title}</h2>
            <p className="mt-1.5 text-sm text-content-muted">{body}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-content-muted">To report a vulnerability, contact the maintainers privately. Please do not open a public issue for security reports.</p>
    </div>
  );
}